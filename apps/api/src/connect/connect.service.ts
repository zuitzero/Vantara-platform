import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { GuestRequestPriority, ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestsService } from '../requests/requests.service';
import { CreateConnectRequestDto } from './connect.dto';

const REQUESTABLE: ReservationStatus[] = [ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN];

@Injectable()
export class ConnectService {
  constructor(private readonly prisma: PrismaService, private readonly requests: RequestsService) {}

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }

  async issue(tenantId: string, reservationId: string) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, tenantId },
      select: { id: true, status: true, checkOut: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    if (!REQUESTABLE.includes(reservation.status)) throw new BadRequestException('Connect access requires a confirmed or checked-in reservation.');
    if (reservation.checkOut.getTime() <= Date.now()) throw new BadRequestException('This stay has already ended.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(reservation.checkOut.getTime() + 24 * 60 * 60 * 1000);
    await this.prisma.guestConnectAccess.upsert({
      where: { reservationId },
      create: { tenantId, reservationId, tokenHash: this.hash(token), expiresAt },
      update: { tokenHash: this.hash(token), expiresAt, revokedAt: null, lastUsedAt: null },
    });
    return { token, path: `/connect/${token}`, expiresAt };
  }

  async revoke(tenantId: string, reservationId: string) {
    const access = await this.prisma.guestConnectAccess.findFirst({ where: { reservationId, tenantId } });
    if (!access) throw new NotFoundException('Connect access not found.');
    await this.prisma.guestConnectAccess.update({ where: { id: access.id }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  private async access(token: string) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new NotFoundException('Connect access not found.');
    const access = await this.prisma.guestConnectAccess.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        reservation: {
          include: {
            guest: { select: { id: true, firstName: true, lastName: true } },
            property: { select: { id: true, name: true } },
            roomType: { select: { id: true, name: true } },
            room: { select: { id: true, number: true } },
          },
        },
      },
    });
    if (!access || access.revokedAt || access.expiresAt.getTime() <= Date.now()) throw new NotFoundException('Connect access not found.');
    await this.prisma.guestConnectAccess.update({ where: { id: access.id }, data: { lastUsedAt: new Date() } });
    return access;
  }

  async stay(token: string) {
    const access = await this.access(token);
    const r = access.reservation;
    const requests = await this.prisma.guestRequest.findMany({
      where: { tenantId: access.tenantId, reservationId: r.id },
      select: { id: true, title: true, message: true, category: true, priority: true, status: true, createdAt: true, completedAt: true, resolutionNote: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      reservation: {
        id: r.id, confirmationCode: r.confirmationCode, status: r.status, checkIn: r.checkIn, checkOut: r.checkOut,
        guest: r.guest, property: r.property, roomType: r.roomType, room: r.room,
      },
      requests,
      canRequest: REQUESTABLE.includes(r.status) && r.checkOut.getTime() > Date.now(),
    };
  }

  async createRequest(token: string, input: CreateConnectRequestDto) {
    const access = await this.access(token);
    const reservation = access.reservation;
    if (!REQUESTABLE.includes(reservation.status) || reservation.checkOut.getTime() <= Date.now()) {
      throw new ForbiddenException('This stay can no longer create requests.');
    }
    return this.requests.createForReservationGuest(access.tenantId, reservation.id, {
      ...input,
      priority: input.priority ?? GuestRequestPriority.NORMAL,
    });
  }
}
