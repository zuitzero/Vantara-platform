import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HousekeepingStatus, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHousekeepingTaskDto, UpdateHousekeepingTaskDto } from './housekeeping.dto';

@Injectable()
export class HousekeepingService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.housekeepingTask.findMany({
      where: { tenantId },
      include: { room: { include: { roomType: true } }, property: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForTenant(tenantId: string, input: CreateHousekeepingTaskDto) {
    const room = await this.prisma.room.findFirst({
      where: { id: input.roomId, property: { tenantId } },
    });
    if (!room) throw new BadRequestException('Room does not belong to the active hotel.');

    const task = await this.prisma.housekeepingTask.create({
      data: {
        tenantId,
        propertyId: room.propertyId,
        roomId: room.id,
        title: input.title.trim(),
        notes: input.notes?.trim(),
        priority: input.priority,
        assignedTo: input.assignedTo?.trim(),
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      include: { room: { include: { roomType: true } }, property: true },
    });

    if (room.status !== RoomStatus.CLEANING) {
      await this.prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.CLEANING } });
    }
    return task;
  }

  async updateForTenant(tenantId: string, taskId: string, input: UpdateHousekeepingTaskDto) {
    const current = await this.prisma.housekeepingTask.findFirst({ where: { id: taskId, tenantId } });
    if (!current) throw new NotFoundException('Housekeeping task not found.');

    const nextStatus = input.status ?? current.status;
    const task = await this.prisma.housekeepingTask.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        priority: input.priority,
        assignedTo: input.assignedTo?.trim(),
        notes: input.notes?.trim(),
        startedAt: nextStatus === HousekeepingStatus.IN_PROGRESS && !current.startedAt ? new Date() : current.startedAt,
        completedAt: nextStatus === HousekeepingStatus.COMPLETED ? new Date() : current.completedAt,
      },
      include: { room: { include: { roomType: true } }, property: true },
    });

    if (nextStatus === HousekeepingStatus.COMPLETED) {
      await this.prisma.room.update({ where: { id: current.roomId }, data: { status: RoomStatus.AVAILABLE } });
    }
    return task;
  }
}