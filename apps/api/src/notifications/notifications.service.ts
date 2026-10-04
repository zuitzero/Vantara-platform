import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEvent } from './notifications.types';
import { NotificationsGateway } from './notifications.gateway';

const hotelRoles: MembershipRole[] = [MembershipRole.HOTEL_ADMIN, MembershipRole.HOTEL_STAFF];
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pending = new WeakMap<object, (NotificationEvent & { id: string })[]>();
  constructor(private readonly prisma: PrismaService, @Inject(forwardRef(() => NotificationsGateway)) private readonly gateway: NotificationsGateway) {}

  private async hotelReader(tenantId: string, userId: string, role: MembershipRole, db: Prisma.TransactionClient = this.prisma) {
    if (!hotelRoles.includes(role)) throw new ForbiddenException('Hotel staff access required.');
    const membership = await db.membership.findFirst({ where: { tenantId, userId, role: { in: hotelRoles }, tenant: { type: 'HOTEL' } } });
    if (!membership) throw new ForbiddenException('Hotel notification access denied.');
  }
  async listForHotel(tenantId: string, userId: string, role: MembershipRole, unreadOnly = false) {
    await this.hotelReader(tenantId, userId, role);
    const rows = await this.prisma.notification.findMany({ where: { tenantId, audience: 'HOTEL', OR: [{ recipientId: userId }, { recipientId: null }], ...(unreadOnly ? { reads: { none: { userId, tenantId } } } : {}) }, include: { reads: { where: { userId, tenantId }, select: { readAt: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map(({ reads, ...row }) => ({ ...row, readAt: reads[0]?.readAt ?? null }));
  }
  async markRead(tenantId: string, notificationId: string, userId: string, role: MembershipRole) {
    return this.prisma.$transaction(async tx => {
      await this.hotelReader(tenantId, userId, role, tx);
      const notification = await tx.notification.findFirst({ where: { id: notificationId, tenantId, audience: 'HOTEL', OR: [{ recipientId: userId }, { recipientId: null }] } });
      if (!notification) throw new NotFoundException('Notification not found.');
      await tx.notificationRead.upsert({ where: { notificationId_userId: { notificationId, userId } }, create: { notificationId, tenantId, userId }, update: {} });
      return { success: true };
    });
  }
  async persist(event: NotificationEvent, db: Prisma.TransactionClient = this.prisma) {
    if (!event.tenantId) throw new Error('Notification events require a tenantId.');
    const tenant = await db.tenant.findUnique({ where: { id: event.tenantId }, select: { type: true } });
    if (!tenant || tenant.type !== (event.audience === 'ZUITZERO' ? 'PLATFORM' : 'HOTEL')) throw new ForbiddenException('Notification audience does not match tenant type.');
    if (!['HOTEL', 'GUEST', 'ZUITZERO'].includes(event.audience)) throw new ForbiddenException('Invalid notification audience.');
    if (event.channel && event.channel !== 'IN_APP') throw new ForbiddenException('Only in-app notification delivery is supported.');
    if (event.audience === 'HOTEL' && event.recipientId) {
      const member = await db.membership.findFirst({ where: { tenantId: event.tenantId, userId: event.recipientId, role: { in: hotelRoles }, tenant: { type: 'HOTEL' } } });
      if (!member) throw new ForbiddenException('Notification recipient must be hotel staff in this tenant.');
    }
    if (event.audience === 'GUEST') {
      if (!event.recipientId || !await db.guest.findFirst({ where: { id: event.recipientId, tenantId: event.tenantId } })) throw new ForbiddenException('Guest notification recipient must belong to this tenant.');
    }
    if (event.audience === 'ZUITZERO' && event.recipientId) {
      if (!await db.membership.findFirst({ where: { tenantId: event.tenantId, userId: event.recipientId, role: { in: ['OWNER', 'ZUITZERO_ADMIN'] }, tenant: { type: 'PLATFORM' } } })) throw new ForbiddenException('Platform recipient required.');
    }
    return db.notification.create({ data: { tenantId: event.tenantId, audience: event.audience, recipientId: event.recipientId, severity: event.severity, channel: 'IN_APP', type: event.type, title: event.title, message: event.message, metadata: event.metadata as Prisma.InputJsonValue | undefined } });
  }
  private emit(event: NotificationEvent & { id: string }) {
    try { this.gateway.emit(event); } catch { this.logger.warn(`Realtime notification delivery failed: ${event.id}; persisted notification remains available.`); }
  }
  async publish(event: NotificationEvent) {
    const notification = await this.persist(event);
    this.emit({ ...event, id: notification.id });
    return notification;
  }
  async queue(tx: Prisma.TransactionClient, event: NotificationEvent) {
    const notification = await this.persist(event, tx);
    const events = this.pending.get(tx) ?? []; events.push({ ...event, id: notification.id }); this.pending.set(tx, events);
  }
  // The caller owns serialization retries. Each failed attempt discards its buffer.
  async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) {
    let committed: Prisma.TransactionClient | undefined;
    try {
      const result = await this.prisma.$transaction(async tx => { committed = tx; this.pending.set(tx, []); return operation(tx); }, options);
      for (const event of this.pending.get(committed!) ?? []) this.emit(event);
      return result;
    } finally { if (committed) this.pending.delete(committed); }
  }
}
