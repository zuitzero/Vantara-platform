import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus, StaffDepartment } from '@prisma/client';
import { StaffService, staffIdentity } from '../staff/staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceTicketDto, UpdateMaintenanceTicketDto } from './maintenance.dto';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService, private readonly staff: StaffService, private readonly readiness: RoomReadinessService) { }

  assigneesForTenant(tenantId: string) { return this.staff.assigneesForTenant(tenantId, StaffDepartment.MAINTENANCE); }

  listForTenant(tenantId: string) {
    return this.prisma.maintenanceTicket.findMany({
      where: { tenantId },
      include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForTenant(tenantId: string, input: CreateMaintenanceTicketDto) {
    return this.staff.transaction(async tx => {
      await this.staff.assertHotel(tenantId, tx);
      const room = await tx.room.findFirst({ where: { id: input.roomId, property: { tenantId } } });
      if (!room) throw new BadRequestException('Room does not belong to the active hotel.');
      if (input.assignedStaffId) await this.staff.validateAssignee(tx, tenantId, input.assignedStaffId, room.propertyId, StaffDepartment.MAINTENANCE);
      const ticket = await tx.maintenanceTicket.create({
        data: {
          tenantId,
          propertyId: room.propertyId,
          roomId: room.id,
          title: input.title.trim(),
          description: input.description.trim(),
          priority: input.priority,
          blocksRoom: input.blocksRoom,
          assignedStaffId: input.assignedStaffId,
          status: input.assignedStaffId ? MaintenanceStatus.ASSIGNED : MaintenanceStatus.OPEN,
        },
        include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      });

      await this.readiness.recalculate(tx, tenantId, room.id);
      return ticket;
    });
  }

  async updateForTenant(tenantId: string, ticketId: string, input: UpdateMaintenanceTicketDto) {
    return this.staff.transaction(async tx => {
      await this.staff.assertHotel(tenantId, tx);
      const current = await tx.maintenanceTicket.findFirst({ where: { id: ticketId, tenantId } });
      if (!current) throw new NotFoundException('Maintenance ticket not found.');

      const terminal = (current.status === MaintenanceStatus.RESOLVED || current.status === MaintenanceStatus.CANCELLED);
      if (terminal && (input.blocksRoom !== undefined || input.assignedStaffId !== undefined || (input.status !== undefined && input.status !== current.status))) {
        throw new BadRequestException('Closed work cannot be assigned or reopened.');
      }
      const assignedStaffId = input.assignedStaffId !== undefined ? input.assignedStaffId : current.assignedStaffId;
      let nextStatus = input.status ?? current.status;
      if (input.assignedStaffId !== undefined) {
        if (assignedStaffId && current.status === MaintenanceStatus.OPEN) nextStatus = input.status ?? MaintenanceStatus.ASSIGNED;
        if (!assignedStaffId && current.status === MaintenanceStatus.ASSIGNED) nextStatus = input.status ?? MaintenanceStatus.OPEN;
      }
      if (nextStatus === MaintenanceStatus.ASSIGNED && !assignedStaffId) throw new BadRequestException('ASSIGNED work requires an operational staff profile.');
      if (assignedStaffId && (input.assignedStaffId !== undefined || nextStatus === MaintenanceStatus.ASSIGNED || nextStatus === MaintenanceStatus.IN_PROGRESS)) {
        await this.staff.validateAssignee(tx, tenantId, assignedStaffId, current.propertyId, StaffDepartment.MAINTENANCE);
      }
      const ticket = await tx.maintenanceTicket.update({
        where: { id: current.id, tenantId },
        data: {
          status: nextStatus,
          priority: input.priority,
          blocksRoom: input.blocksRoom,
          assignedStaffId: input.assignedStaffId,
          assignedTo: input.assignedStaffId !== undefined ? null : undefined,
          resolutionNote: input.resolutionNote?.trim(),
          startedAt: nextStatus === MaintenanceStatus.IN_PROGRESS && !current.startedAt ? new Date() : current.startedAt,
          resolvedAt: nextStatus === MaintenanceStatus.RESOLVED && current.status !== nextStatus ? new Date() : current.resolvedAt,
        },
        include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      });

      if (nextStatus !== current.status || input.blocksRoom !== undefined) {
        await this.readiness.recalculate(tx, tenantId, current.roomId);
      }
      return ticket;
    });
  }
}

