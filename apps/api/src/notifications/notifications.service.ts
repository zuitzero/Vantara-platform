import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEvent } from './notifications.types';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway: NotificationsGateway,
  ) {}

  async listForHotel(tenantId: string, recipientId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, audience: 'HOTEL', OR: [{ recipientId }, { recipientId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(tenantId: string, notificationId: string, recipientId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, tenantId, audience: 'HOTEL', OR: [{ recipientId }, { recipientId: null }] },
      data: { readAt: new Date() },
    });
  }

  async publish(event: NotificationEvent) {
    const notification = await this.prisma.notification.create({
      data: {
        tenantId: event.tenantId!,
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
