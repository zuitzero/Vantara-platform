import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus, RoomReadinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaintenanceTicketDto, UpdateMaintenanceTicketDto } from './maintenance.dto';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.maintenanceTicket.findMany({
      where: { tenantId },
      include: { room: { include: { roomType: true } }, property: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForTenant(tenantId: string, input: CreateMaintenanceTicketDto) {
    const room = await this.prisma.room.findFirst({ where: { id: input.roomId, property: { tenantId } } });
    if (!room) throw new BadRequestException('Room does not belong to the active hotel.');

    const ticket = await this.prisma.maintenanceTicket.create({
      data: {
        tenantId,
        propertyId: room.propertyId,
        roomId: room.id,
        title: input.title.trim(),
        description: input.description.trim(),
        priority: input.priority,
        assignedTo: input.assignedTo?.trim(),
      },
      include: { room: { include: { roomType: true } }, property: true },
    });

    if (room.readinessStatus !== RoomReadinessStatus.MAINTENANCE) {
      await this.prisma.room.update({
        where: { id: room.id },
        data: { readinessStatus: RoomReadinessStatus.MAINTENANCE },
      });
    }
    return ticket;
  }

  async updateForTenant(tenantId: string, ticketId: string, input: UpdateMaintenanceTicketDto) {
    const current = await this.prisma.maintenanceTicket.findFirst({ where: { id: ticketId, tenantId } });
    if (!current) throw new NotFoundException('Maintenance ticket not found.');

    const nextStatus = input.status ?? current.status;
    const ticket = await this.prisma.maintenanceTicket.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        priority: input.priority,
        assignedTo: input.assignedTo?.trim(),
        resolutionNote: input.resolutionNote?.trim(),
        startedAt: nextStatus === MaintenanceStatus.IN_PROGRESS && !current.startedAt ? new Date() : current.startedAt,
        resolvedAt: nextStatus === MaintenanceStatus.RESOLVED ? new Date() : current.resolvedAt,
      },
      include: { room: { include: { roomType: true } }, property: true },
    });

    if (nextStatus === MaintenanceStatus.RESOLVED) {
      await this.prisma.room.update({
        where: { id: current.roomId },
        data: { readinessStatus: RoomReadinessStatus.READY },
      });
    }
    return ticket;
  }
}
