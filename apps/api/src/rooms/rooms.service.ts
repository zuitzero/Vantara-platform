import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './rooms.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, tenantId } });
    if (!property) throw new NotFoundException('Property not found.');

    const roomType = await this.prisma.roomType.findFirst({ where: { id: input.roomTypeId, propertyId } });
    if (!roomType) throw new BadRequestException('Room type does not belong to this property.');

    return this.prisma.room.create({
      data: {
        propertyId,
        roomTypeId: input.roomTypeId,
        number: input.number.trim(),
      },
      include: { property: true, roomType: true },
    });
  }

  async updateOccupancyForTenant(tenantId: string, roomId: string, occupancyStatus: RoomOccupancyStatus) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, property: { tenantId } } });
    if (!room) throw new NotFoundException('Room not found.');

    return this.prisma.room.update({
      where: { id: room.id },
      data: { occupancyStatus },
      include: { property: true, roomType: true },
    });
  }

  async updateReadinessForTenant(tenantId: string, roomId: string, readinessStatus: RoomReadinessStatus) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, property: { tenantId } } });
    if (!room) throw new NotFoundException('Room not found.');

    return this.prisma.room.update({
      where: { id: room.id },
      data: { readinessStatus },
      include: { property: true, roomType: true },
    });
  }
}
