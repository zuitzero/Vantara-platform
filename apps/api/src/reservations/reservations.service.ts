import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './reservations.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.reservation.findMany({
      where: { tenantId },
      include: { guest: true, property: true, roomType: true, room: true },
      orderBy: { checkIn: 'asc' },
    });
  }

  async getForTenant(tenantId: string, reservationId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, tenantId },
      include: { guest: true, property: true, roomType: true, room: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    return reservation;
  }

  async createForTenant(tenantId: string, input: CreateReservationDto) {
    if (input.checkOut <= input.checkIn) {
      throw new BadRequestException('Check-out must be after check-in.');
    }

    const guest = await this.prisma.guest.findFirst({ where: { id: input.guestId, tenantId } });
    if (!guest) throw new BadRequestException('Guest does not belong to the active hotel.');

    const property = await this.prisma.property.findFirst({ where: { id: input.propertyId, tenantId } });
    if (!property) throw new BadRequestException('Property does not belong to the active hotel.');

    const roomType = await this.prisma.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId },
    });
    if (!roomType) throw new BadRequestException('Room type does not belong to the selected property.');

    if (input.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: input.roomId, propertyId: input.propertyId, roomTypeId: input.roomTypeId },
      });
      if (!room) throw new BadRequestException('Room does not match the selected property and room type.');

      const overlap = await this.prisma.reservation.findFirst({
        where: {
          tenantId,
          roomId: input.roomId,
          status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN] },
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
      });
      if (overlap) throw new BadRequestException('Room is already reserved for part of this stay.');
    }

    const confirmationCode = this.createConfirmationCode();
    return this.prisma.reservation.create({
      data: {
        tenantId,
        propertyId: input.propertyId,
        guestId: input.guestId,
        roomTypeId: input.roomTypeId,
        roomId: input.roomId,
        confirmationCode,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults ?? 1,
        children: input.children ?? 0,
        totalAmount: input.totalAmount,
        currency: input.currency?.toUpperCase() ?? 'MXN',
        notes: input.notes?.trim(),
      },
      include: { guest: true, property: true, roomType: true, room: true },
    });
  }

  private createConfirmationCode() {
    return `VNT-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
