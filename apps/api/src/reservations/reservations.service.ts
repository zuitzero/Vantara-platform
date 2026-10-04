import { auditMutation } from '../rbac/audit.service';
import { AuditAction } from '@prisma/client';
import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HousekeepingStatus, Prisma, ReservationStatus, RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService, private readonly readiness: RoomReadinessService) {}

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

    return this.serialized(async (tx) => {
      if (input.roomId) {
        await this.validateRoom(tx, tenantId, input.roomId, input.propertyId, input.roomTypeId);
        await this.assertNoOverlap(tx, tenantId, input.roomId, input.checkIn, input.checkOut);
      }
      const reservation = await tx.reservation.create({
        data: {
          tenantId, propertyId: input.propertyId, guestId: input.guestId,
          roomTypeId: input.roomTypeId, roomId: input.roomId,
          confirmationCode: this.createConfirmationCode(),
          checkIn: input.checkIn, checkOut: input.checkOut,
          adults: input.adults ?? 1, children: input.children ?? 0,
          totalAmount: input.totalAmount, currency: input.currency?.toUpperCase() ?? 'MXN',
          notes: input.notes?.trim(),
        },
        include: { guest: true, property: true, roomType: true, room: true },
      });
      await auditMutation(tx, tenantId, AuditAction.RESERVATION_CREATED, 'reservation', reservation.id, { propertyId: reservation.propertyId, roomId: reservation.roomId ?? null, status: reservation.status });
      return reservation;
    });
  }

  async assignRoomForTenant(tenantId: string, reservationId: string, roomId: string) {
    await this.serialized(async (tx) => {
      const reservation = await tx.reservation.findFirst({ where: { id: reservationId, tenantId } });
      if (!reservation) throw new NotFoundException('Reservation not found.');
      if (reservation.status !== ReservationStatus.PENDING && reservation.status !== ReservationStatus.CONFIRMED) {
        throw new BadRequestException('Rooms can only be assigned before check-in on pending or confirmed reservations.');
      }
      await this.validateRoom(tx, tenantId, roomId, reservation.propertyId, reservation.roomTypeId);
      await this.assertNoOverlap(tx, tenantId, roomId, reservation.checkIn, reservation.checkOut, reservation.id);
      await tx.reservation.update({ where: { id: reservation.id, tenantId }, data: { roomId } });
      if (reservation.roomId !== roomId) await auditMutation(tx, tenantId, AuditAction.RESERVATION_ROOM_ASSIGNED, 'reservation', reservation.id, { roomId, previousRoomId: reservation.roomId ?? null });
    });
    return this.getForTenant(tenantId, reservationId);
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

    await this.serialized(async (tx) => {
      const fresh = await tx.reservation.findFirst({ where: { id: reservationId, tenantId }, include: { room: true } });
      if (!fresh) throw new NotFoundException('Reservation not found.');
      if (fresh.status === nextStatus) return;
      if (!ALLOWED_TRANSITIONS[fresh.status].includes(nextStatus)) {
        throw new BadRequestException(`Cannot move reservation from ${fresh.status} to ${nextStatus}.`);
      }
      // All operational writes use the reservation read inside this transaction.
      const current = fresh;
      if (nextStatus === ReservationStatus.CHECKED_IN || nextStatus === ReservationStatus.CHECKED_OUT) {
        if (!current.roomId) throw new BadRequestException('A room must be assigned before check-in or check-out.');
        await this.validateRoom(tx, tenantId, current.roomId, current.propertyId, current.roomTypeId);
        const guest = await tx.guest.findFirst({ where: { id: current.guestId, tenantId } });
        if (!guest) throw new BadRequestException('Guest does not belong to the active hotel.');
      }
      await tx.reservation.update({ where: { id: current.id, tenantId }, data: { status: nextStatus } });

      if (nextStatus === ReservationStatus.CHECKED_IN && current.roomId) {
        await this.assertNoOverlap(tx, tenantId, current.roomId, current.checkIn, current.checkOut, current.id);
        const claimed = await tx.room.updateMany({
          where: {
            id: current.roomId, property: { tenantId },
            occupancyStatus: RoomOccupancyStatus.VACANT, readinessStatus: RoomReadinessStatus.READY,
          },
          data: { occupancyStatus: RoomOccupancyStatus.OCCUPIED },
        });
        if (claimed.count !== 1) throw new BadRequestException('Check-in requires a VACANT and READY room. Refresh room availability.');
        await tx.guest.update({
          where: { id: current.guestId, tenantId },
          data: { roomId: current.roomId, propertyId: current.propertyId },
        });
      }

      if (nextStatus === ReservationStatus.CHECKED_OUT && current.roomId) {
        await tx.room.update({
          where: { id: current.roomId, property: { tenantId } },
          data: {
            occupancyStatus: RoomOccupancyStatus.VACANT,
          },
        });
        await tx.guest.update({ where: { id: current.guestId, tenantId }, data: { roomId: null } });

        const existingTask = await tx.housekeepingTask.findFirst({
          where: {
            tenantId,
            roomId: current.roomId,
            blocksRoom: true,
            status: { in: [HousekeepingStatus.PENDING, HousekeepingStatus.ASSIGNED, HousekeepingStatus.IN_PROGRESS] },
          },
        });

        if (!existingTask) {
          const turnover = await tx.housekeepingTask.create({
            data: {
              tenantId,
              propertyId: current.propertyId,
              roomId: current.roomId,
              blocksRoom: true,
              title: `Post check-out cleaning · Room ${current.room?.number ?? ''}`.trim(),
              notes: `Automatically created after reservation ${current.confirmationCode} checked out.`,
            },
          });
          await auditMutation(tx, tenantId, AuditAction.HOUSEKEEPING_CREATED, 'housekeeping', turnover.id, { roomId: current.roomId, blocksRoom: true, reason: 'POST_CHECKOUT' });
        }
        await this.readiness.recalculate(tx, tenantId, current.roomId);
      }
      const actions: Partial<Record<ReservationStatus, AuditAction>> = { CONFIRMED: AuditAction.RESERVATION_CONFIRMED, CHECKED_IN: AuditAction.RESERVATION_CHECKED_IN, CHECKED_OUT: AuditAction.RESERVATION_CHECKED_OUT, CANCELED: AuditAction.RESERVATION_CANCELED, NO_SHOW: AuditAction.RESERVATION_NO_SHOW };
      await auditMutation(tx, tenantId, actions[nextStatus]!, 'reservation', current.id, { status: nextStatus, previousStatus: current.status, roomId: current.roomId ?? null });
    });

    return this.getForTenant(tenantId, reservationId);
  }

  private async validateRoom(tx: Prisma.TransactionClient, tenantId: string, roomId: string, propertyId: string, roomTypeId: string) {
    const room = await tx.room.findFirst({ where: { id: roomId, property: { tenantId } } });
    if (!room) throw new BadRequestException('Room does not belong to the active hotel or no longer exists.');
    if (room.propertyId !== propertyId || room.roomTypeId !== roomTypeId) {
      throw new BadRequestException('Room must match the reservation property and room type.');
    }
    return room;
  }

  private async assertNoOverlap(tx: Prisma.TransactionClient, tenantId: string, roomId: string, checkIn: Date, checkOut: Date, reservationId?: string) {
    const conflict = await tx.reservation.findFirst({
      where: {
        tenantId, roomId, ...(reservationId ? { id: { not: reservationId } } : {}),
        status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN] },
        checkIn: { lt: checkOut }, checkOut: { gt: checkIn },
      },
    });
    if (conflict) throw new BadRequestException('Room is already reserved for part of this stay.');
  }

  private async serialized<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new ConflictException('Reservation or room changed concurrently. Refresh and retry.');
      }
    }
    throw new ConflictException('Refresh and retry.');
  }

  private createConfirmationCode() {
    return `VNT-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}

