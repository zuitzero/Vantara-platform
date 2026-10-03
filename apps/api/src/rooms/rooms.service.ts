import { Injectable, NotFoundException } from '@nestjs/common';
import { RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  async updateStatusForTenant(tenantId: string, roomId: string, status: RoomStatus) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, property: { tenantId } },
    });

    if (!room) throw new NotFoundException('Room not found.');

    return this.prisma.room.update({
      where: { id: room.id },
      data: { status },
      include: { property: true, roomType: true },
    });
  }
}
