import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEvent } from './notifications.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    this.logger.log(`Notification persisted: ${notification.id} (${event.type})`);
    return notification;
  }
}
