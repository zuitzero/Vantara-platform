import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuestDto } from './guests.dto';

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.prisma.guest.findMany({
      where: { tenantId },
      include: {
        property: true,
        room: { include: { roomType: true } },
        // An additive, read-only operational projection. No billing, notes, or lifecycle mutations.
        reservations: {
          where: {
            tenantId,
            OR: [
              { status: ReservationStatus.CHECKED_IN },
              {
                status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] },
                checkOut: { gte: today },
              },
            ],
          },
          select: {
            id: true,
            status: true,
            confirmationCode: true,
            checkIn: true,
            checkOut: true,
            property: { select: { id: true, name: true } },
            room: { select: { id: true, number: true } },
            roomType: { select: { id: true, name: true } },
          },
          orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async createForTenant(tenantId: string, input: CreateGuestDto) {
    if (input.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: input.roomId, property: { tenantId } },
      });
      if (!room) throw new BadRequestException('Room does not belong to the active hotel.');
      if (input.propertyId && room.propertyId !== input.propertyId) {
        throw new BadRequestException('Room does not belong to the selected property.');
      }
    }

    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({ where: { id: input.propertyId, tenantId } });
      if (!property) throw new BadRequestException('Property does not belong to the active hotel.');
    }

    return this.prisma.guest.create({
      data: {
        tenantId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email: input.email?.trim().toLowerCase(),
        phone: input.phone?.trim(),
        notes: input.notes?.trim(),
      },
      include: { property: true, room: { include: { roomType: true } } },
    });
  }

  async getForTenant(tenantId: string, guestId: string) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, tenantId },
      include: { property: true, room: { include: { roomType: true } } },
    });
    if (!guest) throw new NotFoundException('Guest not found.');
    return guest;
  }
}
