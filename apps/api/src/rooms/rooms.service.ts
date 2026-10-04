import { auditMutation } from '../rbac/audit.service';
import { AuditAction } from '@prisma/client';
import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './rooms.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService, private readonly readiness: RoomReadinessService) {}

  listForTenant(tenantId: string) {
    return this.prisma.room.findMany({
      where: { property: { tenantId } },
      include: {
        property: true,
        roomType: true,
        guests: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 },
        reservations: {
          where: { status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
          orderBy: { checkIn: 'asc' },
          take: 1,
          include: { guest: true },
        },
      },
      orderBy: [{ property: { name: 'asc' } }, { number: 'asc' }],
    });
  }

  async createForTenant(tenantId: string, propertyId: string, input: CreateRoomDto) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, tenantId, tenant: { type: 'HOTEL' } } });
    if (!property) throw new NotFoundException('Property not found.');

    const roomType = await this.prisma.roomType.findFirst({ where: { id: input.roomTypeId, propertyId } });
    if (!roomType) throw new BadRequestException('Room type does not belong to this property.');

    if (!input.number.trim()) throw new BadRequestException('Room number is required.');
    try { return await this.prisma.room.create({
      data: {
        propertyId,
        roomTypeId: input.roomTypeId,
        number: input.number.trim(),
      },
      include: { property: true, roomType: true },
    }); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This room number already exists in this property.');
      throw error;
    }
  }

  async updateOccupancyForTenant(tenantId: string, roomId: string, occupancyStatus: RoomOccupancyStatus) {
    return this.readiness.transaction(async tx => {
      const room = await tx.room.findFirst({ where: { id: roomId, property: { tenantId } } });
      if (!room) throw new NotFoundException('Room not found.');
      const updated = await tx.room.update({ where: { id: roomId, property: { tenantId } }, data: { occupancyStatus }, include: { property: true, roomType: true } });
      if (room.occupancyStatus !== occupancyStatus) await auditMutation(tx, tenantId, AuditAction.ROOM_OCCUPANCY_OVERRIDDEN, 'room', roomId, { occupancyStatus, previousOccupancyStatus: room.occupancyStatus });
      return updated;
    });
  }

  async updateReadinessForTenant(tenantId: string, roomId: string, readinessStatus: RoomReadinessStatus) {
    if (readinessStatus !== RoomReadinessStatus.READY && readinessStatus !== RoomReadinessStatus.OUT_OF_SERVICE) {
      throw new BadRequestException('Cleaning and maintenance readiness are derived from blocking work.');
    }
    return this.readiness.transaction(async tx => {
      const room = await tx.room.findFirst({ where: { id: roomId, property: { tenantId } } });
      if (!room) throw new NotFoundException('Room not found.');
      await tx.room.update({ where: { id: roomId, property: { tenantId } },
        data: { outOfServiceLocked: readinessStatus === RoomReadinessStatus.OUT_OF_SERVICE } });
      if (room.outOfServiceLocked !== (readinessStatus === RoomReadinessStatus.OUT_OF_SERVICE)) {
        await auditMutation(tx, tenantId, readinessStatus === RoomReadinessStatus.OUT_OF_SERVICE ? AuditAction.ROOM_OUT_OF_SERVICE_LOCKED : AuditAction.ROOM_OUT_OF_SERVICE_UNLOCKED, 'room', roomId);
      }
      return this.readiness.recalculate(tx, tenantId, roomId);
    });
  }
}
