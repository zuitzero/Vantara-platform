import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEvent } from './notifications.types';
import { NotificationsGateway } from './notifications.gateway';

const HOTEL_STAFF_ROLES = new Set<MembershipRole>([MembershipRole.HOTEL_ADMIN, MembershipRole.HOTEL_STAFF, MembershipRole.ZUITZERO_ADMIN, MembershipRole.OWNER]);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
  ) {}

  private assertHotelStaff(role: MembershipRole) {
    if (!HOTEL_STAFF_ROLES.has(role)) {
      throw new ForbiddenException('Hotel staff access required.');
    }
  }

  async listForHotel(tenantId: string, recipientId: string, role: MembershipRole, unreadOnly = false) {
    this.assertHotelStaff(role);

    return this.prisma.notification.findMany({
      where: {
        tenantId,
        audience: 'HOTEL',
        ...(unreadOnly ? { readAt: null } : {}),
        OR: [{ recipientId }, { recipientId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(tenantId: string, notificationId: string, recipientId: string, role: MembershipRole) {
    this.assertHotelStaff(role);

    const result = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        tenantId,
        audience: 'HOTEL',
        OR: [{ recipientId }, { recipientId: null }],
      },
      data: { readAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification not found.');
    }

    return { success: true };
  }

  async publish(event: NotificationEvent) {
    if (!event.tenantId) {
      throw new Error('Notification events require a tenantId in the current hotel notification store.');
    }

    const notification = await this.prisma.notification.create({
      data: {
        tenantId: event.tenantId,
        audience: event.audience,
        recipientId: event.recipientId,
        severity: event.severity,
        channel: event.channel ?? 'IN_APP',
        type: event.type,
        title: event.title,
        message: event.message,
        metadata: event.metadata as object | undefined,
      },
    });

    this.gateway.emit({ ...event, id: notification.id });
    this.logger.log(`Notification persisted and emitted: ${notification.id} (${event.type})`);
    return notification;
  }
}
