import { auditMutation } from '../rbac/audit.service';
import { AuditAction, Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuestDto, CreateGuestNoteDto, UpdateGuestCrmDto } from './guests.dto';

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
    if (!input.firstName.trim() || !input.lastName.trim()) {
      throw new BadRequestException('First and last name are required.');
    }
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

    return this.prisma.$transaction(async tx => {
      const guest = await tx.guest.create({
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
      await auditMutation(tx, tenantId, AuditAction.GUEST_CREATED, 'guest', guest.id, { propertyId: guest.propertyId ?? null, roomId: guest.roomId ?? null });
      return guest;
    });
  }


  private async assertGuest(tenantId: string, guestId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const guest = await db.guest.findFirst({
      where: { id: guestId, tenantId },
      select: { id: true, tenantId: true, firstName: true, lastName: true, email: true, phone: true, status: true, createdAt: true, updatedAt: true },
    });
    if (!guest) throw new NotFoundException('Guest not found.');
    return guest;
  }

  async getCrmForTenant(tenantId: string, guestId: string) {
    const guest = await this.assertGuest(tenantId, guestId);
    const [preferences, tags, notes, reservations, requests] = await Promise.all([
      this.prisma.guestPreference.findMany({
        where: { tenantId, guestId },
        select: { id: true, key: true, value: true, updatedAt: true },
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.guestTag.findMany({
        where: { tenantId, guestId },
        select: { id: true, label: true, createdAt: true },
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.guestNote.findMany({
        where: { tenantId, guestId },
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      this.prisma.reservation.findMany({
        where: { tenantId, guestId },
        select: {
          id: true, confirmationCode: true, status: true, checkIn: true, checkOut: true,
          property: { select: { id: true, name: true } },
          room: { select: { id: true, number: true } },
          roomType: { select: { id: true, name: true } },
          createdAt: true,
        },
        orderBy: [{ checkIn: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      this.prisma.guestRequest.findMany({
        where: { tenantId, guestId },
        select: {
          id: true, title: true, category: true, priority: true, status: true,
          createdAt: true, completedAt: true,
          property: { select: { id: true, name: true } },
          room: { select: { id: true, number: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    ]);

    const timeline = [
      ...reservations.map(reservation => ({
        type: 'RESERVATION' as const,
        id: reservation.id,
        occurredAt: reservation.checkIn,
        title: `Reservation ${reservation.confirmationCode}`,
        status: reservation.status,
        detail: {
          checkIn: reservation.checkIn, checkOut: reservation.checkOut,
          property: reservation.property, room: reservation.room, roomType: reservation.roomType,
        },
      })),
      ...requests.map(request => ({
        type: 'REQUEST' as const,
        id: request.id,
        occurredAt: request.createdAt,
        title: request.title,
        status: request.status,
        detail: {
          category: request.category, priority: request.priority,
          property: request.property, room: request.room, completedAt: request.completedAt,
        },
      })),
      ...notes.map(note => ({
        type: 'NOTE' as const,
        id: note.id,
        occurredAt: note.createdAt,
        title: 'CRM note',
        status: 'RECORDED',
        detail: { body: note.body, authorName: note.author?.name ?? null },
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    return {
      guest,
      tags,
      preferences,
      notes,
      metrics: {
        reservations: reservations.length,
        completedStays: reservations.filter(reservation => reservation.status === 'CHECKED_OUT').length,
        requests: requests.length,
        completedRequests: requests.filter(request => request.status === 'COMPLETED').length,
      },
      timeline,
    };
  }

  async updateCrmForTenant(tenantId: string, guestId: string, input: UpdateGuestCrmDto) {
    const tags = [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
    const preferences = [...new Map((input.preferences ?? []).map(item => [item.key.trim().toLowerCase(), { key: item.key.trim().toLowerCase(), value: item.value.trim() }])).values()]
      .filter(item => item.key && item.value)
      .slice(0, 30);

    return this.prisma.$transaction(async tx => {
      await this.assertGuest(tenantId, guestId, tx);
      if (input.tags !== undefined) {
        await tx.guestTag.deleteMany({ where: { tenantId, guestId } });
        if (tags.length) await tx.guestTag.createMany({ data: tags.map(label => ({ tenantId, guestId, label })) });
      }
      if (input.preferences !== undefined) {
        await tx.guestPreference.deleteMany({ where: { tenantId, guestId } });
        if (preferences.length) await tx.guestPreference.createMany({ data: preferences.map(item => ({ tenantId, guestId, key: item.key, value: item.value })) });
      }
      await auditMutation(tx, tenantId, AuditAction.UPDATE, 'guest_crm', guestId, { reason: 'CRM_PROFILE_UPDATED' });
      return {
        tags: await tx.guestTag.findMany({ where: { tenantId, guestId }, select: { id: true, label: true, createdAt: true }, orderBy: [{ label: 'asc' }, { id: 'asc' }] }),
        preferences: await tx.guestPreference.findMany({ where: { tenantId, guestId }, select: { id: true, key: true, value: true, updatedAt: true }, orderBy: [{ key: 'asc' }, { id: 'asc' }] }),
      };
    });
  }

  async addCrmNoteForTenant(tenantId: string, guestId: string, authorUserId: string, input: CreateGuestNoteDto) {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('CRM note is required.');
    return this.prisma.$transaction(async tx => {
      await this.assertGuest(tenantId, guestId, tx);
      const note = await tx.guestNote.create({
        data: { tenantId, guestId, authorUserId, body },
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      });
      await auditMutation(tx, tenantId, AuditAction.CREATE, 'guest_crm_note', note.id, { reason: 'CRM_NOTE_CREATED' });
      return note;
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
