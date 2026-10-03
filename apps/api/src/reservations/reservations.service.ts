import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationsPriority, ReservationStatus, RoomStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto, UpdateReservationStatusDto } from './reservations.dto';

const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: [ReservationStatus.CONFIRMED, ReservationStatus.CANCELED, ReservationStatus.NO_SHOW],
  CONFIRMED: [ReservationStatus.CHECKED_IN, ReservationStatus.CANCELED, ReservationStatus.NO_SHOW],
  CHECKED_IN: [ReservationStatus.CHECKED_OUT],
  CHECKED_OUT: [],
  CANCELED: [],
  NO_SHOW: [],
};

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

  async updateStatusForTenant(tenantId: string, reservationId: string, input: UpdateReservationStatusDto) {
    const current = await this.prisma.reservation.findFirst({ where: { id: reservationId, tenantId } });
    if (!current) throw new NotFoundException('Reservation not found.');
    if (input.status === current.status) return this.getForTenant(tenantId, reservationId);
    if (!ALLOWED_TRANSITIONS[current.status].includes(input.status)) {
      throw new BadRequestException(`Invalid reservation transition: ${current.status} -> ${input.status}.`);
    }

    if ((input.status === ReservationStatus.CHECKED_IN || input.status === ReservationStatus.CHECKED_OUT) && !current.roomId) {
      throw new BadRequestException('A room must be assigned before check-in or check-out.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: current.id }, data: { status: input.status } });

      if (input.status === ReservationStatus.CHECKED_IN && current.roomId) {
        await tx.room.update({ where: { id: current.roomId }, data: { status: RoomStatus.OCCUPIED } });
        await tx.guest.update({
          where: { id: current.guestId },
          data: { propertyId: current.propertyId, roomId: current.roomId },
        });
      }

      if (input.status === ReservationStatus.CHECKED_OUT && current.roomId) {
        await tx.room.update({ where: { id: current.roomId }, data: { status: RoomStatus.CLEANING } });
        await tx.guest.update({ where: { id: current.guestId }, data: { roomId: null } });
        await tx.housekeepingTask.upsert({
          where: { sourceReservationId: current.id },
          update: {},
          create: {
            tenantId,
            propertyId: current.propertyId,
            roomId: current.roomId,
            sourceReservationId: current.id,
            title: 'Turnover cleaning',
            notes: `Automatic turnover after reservation ${current.confirmationCode} check-out.`,
            priority: OperationsPriority.NORMAL,
          },
        });
      }
    });

    return this.getForTenant(tenantId, reservationId);
  }

  private createConfirmationCode() {
    return `VNT-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
