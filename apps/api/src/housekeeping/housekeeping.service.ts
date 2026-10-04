import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HousekeepingStatus, StaffDepartment } from '@prisma/client';
import { StaffService, staffIdentity } from '../staff/staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHousekeepingTaskDto, UpdateHousekeepingTaskDto } from './housekeeping.dto';

@Injectable()
export class HousekeepingService {
  constructor(private readonly prisma: PrismaService, private readonly staff: StaffService, private readonly readiness: RoomReadinessService) { }

  assigneesForTenant(tenantId: string) { return this.staff.assigneesForTenant(tenantId, StaffDepartment.HOUSEKEEPING); }

  listForTenant(tenantId: string) {
    return this.prisma.housekeepingTask.findMany({
      where: { tenantId },
      include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForTenant(tenantId: string, input: CreateHousekeepingTaskDto) {
    return this.staff.transaction(async tx => {
      await this.staff.assertHotel(tenantId, tx);
      const room = await tx.room.findFirst({ where: { id: input.roomId, property: { tenantId } } });
      if (!room) throw new BadRequestException('Room does not belong to the active hotel.');
      if (input.assignedStaffId) await this.staff.validateAssignee(tx, tenantId, input.assignedStaffId, room.propertyId, StaffDepartment.HOUSEKEEPING);
      const task = await tx.housekeepingTask.create({
        data: {
          tenantId,
          propertyId: room.propertyId,
          roomId: room.id,
          title: input.title.trim(),
          notes: input.notes?.trim(),
          priority: input.priority,
          blocksRoom: input.blocksRoom,
          assignedStaffId: input.assignedStaffId,
          status: input.assignedStaffId ? HousekeepingStatus.ASSIGNED : HousekeepingStatus.PENDING,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        },
        include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      });

      await this.readiness.recalculate(tx, tenantId, room.id);
      return task;
    });
  }

  async updateForTenant(tenantId: string, taskId: string, input: UpdateHousekeepingTaskDto) {
    return this.staff.transaction(async tx => {
      await this.staff.assertHotel(tenantId, tx);
      const current = await tx.housekeepingTask.findFirst({ where: { id: taskId, tenantId } });
      if (!current) throw new NotFoundException('Housekeeping task not found.');

      const terminal = (current.status === HousekeepingStatus.COMPLETED || current.status === HousekeepingStatus.CANCELLED);
      if (terminal && (input.blocksRoom !== undefined || input.assignedStaffId !== undefined || (input.status !== undefined && input.status !== current.status))) {
        throw new BadRequestException('Closed work cannot be assigned or reopened.');
      }
      const assignedStaffId = input.assignedStaffId !== undefined ? input.assignedStaffId : current.assignedStaffId;
      let nextStatus = input.status ?? current.status;
      if (input.assignedStaffId !== undefined) {
        if (assignedStaffId && current.status === HousekeepingStatus.PENDING) nextStatus = input.status ?? HousekeepingStatus.ASSIGNED;
        if (!assignedStaffId && current.status === HousekeepingStatus.ASSIGNED) nextStatus = input.status ?? HousekeepingStatus.PENDING;
      }
      if (nextStatus === HousekeepingStatus.ASSIGNED && !assignedStaffId) throw new BadRequestException('ASSIGNED work requires an operational staff profile.');
      if (assignedStaffId && (input.assignedStaffId !== undefined || nextStatus === HousekeepingStatus.ASSIGNED || nextStatus === HousekeepingStatus.IN_PROGRESS)) {
        await this.staff.validateAssignee(tx, tenantId, assignedStaffId, current.propertyId, StaffDepartment.HOUSEKEEPING);
      }
      const task = await tx.housekeepingTask.update({
        where: { id: current.id, tenantId },
        data: {
          status: nextStatus,
          priority: input.priority,
          blocksRoom: input.blocksRoom,
          assignedStaffId: input.assignedStaffId,
          assignedTo: input.assignedStaffId !== undefined ? null : undefined,
          notes: input.notes?.trim(),
          startedAt: nextStatus === HousekeepingStatus.IN_PROGRESS && !current.startedAt ? new Date() : current.startedAt,
          completedAt: nextStatus === HousekeepingStatus.COMPLETED && current.status !== nextStatus ? new Date() : current.completedAt,
        },
        include: { room: { include: { roomType: true } }, property: true, assignedStaff: { include: { membership: staffIdentity } } },
      });

      if (nextStatus !== current.status || input.blocksRoom !== undefined) {
        await this.readiness.recalculate(tx, tenantId, current.roomId);
      }
      return task;
    });
  }
}

