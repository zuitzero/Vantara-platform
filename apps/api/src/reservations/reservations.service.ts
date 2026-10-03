import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HousekeepingStatus, ReservationStatus, RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './reservations.dto';

const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: [ReservationStatus.CONFIRMED, ReservationStatus.CANCELED],
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

  async updateStatusForTenant(tenantId: string, reservationId: string, nextStatus: ReservationStatus) {
    const current = await this.prisma.reservation.findFirst({
      where: { id: reservationId, tenantId },
      include: { room: true },
    });
    if (!current) throw new NotFoundException('Reservation not found.');
    if (current.status === nextStatus) return this.getForTenant(tenantId, reservationId);
    if (!ALLOWED_TRANSITIONS[current.status].includes(nextStatus)) {
      throw new BadRequestException(`Cannot move reservation from ${current.status} to ${nextStatus}.`);
    }

    if ((nextStatus === ReservationStatus.CHECKED_IN || nextStatus === ReservationStatus.CHECKED_OUT) && !current.roomId) {
      throw new BadRequestException('A room must be assigned before check-in or check-out.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: current.id }, data: { status: nextStatus } });

      if (nextStatus === ReservationStatus.CHECKED_IN && current.roomId) {
        await tx.room.update({
          where: { id: current.roomId },
          data: { occupancyStatus: RoomOccupancyStatus.OCCUPIED },
        });
        await tx.guest.update({
          where: { id: current.guestId },
          data: { roomId: current.roomId, propertyId: current.propertyId },
        });
      }

      if (nextStatus === ReservationStatus.CHECKED_OUT && current.roomId) {
        await tx.room.update({
          where: { id: current.roomId },
          data: {
            occupancyStatus: RoomOccupancyStatus.VACANT,
            readinessStatus: RoomReadinessStatus.CLEANING,
          },
        });
        await tx.guest.update({ where: { id: current.guestId }, data: { roomId: null } });

        const existingTask = await tx.housekeepingTask.findFirst({
          where: {
            tenantId,
            roomId: current.roomId,
            status: { in: [HousekeepingStatus.PENDING, HousekeepingStatus.ASSIGNED, HousekeepingStatus.IN_PROGRESS] },
          },
        });

        if (!existingTask) {
          await tx.housekeepingTask.create({
            data: {
              tenantId,
              propertyId: current.propertyId,
              roomId: current.roomId,
              title: `Post check-out cleaning · Room ${current.room?.number ?? ''}`.trim(),
              notes: `Automatically created after reservation ${current.confirmationCode} checked out.`,
            },
          });
        }
      }
    });

    return this.getForTenant(tenantId, reservationId);
  }

  private createConfirmationCode() {
    return `VNT-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
