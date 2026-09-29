import { Injectable } from '@nestjs/common';
import {
  NotificationAudience,
  NotificationChannel,
  NotificationEvent,
  NotificationSeverity,
} from './notification.types';

@Injectable()
export class NotificationService {
  async publish(input: Omit<NotificationEvent, 'id' | 'createdAt'>): Promise<NotificationEvent> {
    const event: NotificationEvent = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      channels: input.channels.length ? input.channels : [NotificationChannel.IN_APP],
    };

    // Foundation stage: domain events are normalized here first.
    // Persistence/realtime delivery will be connected before production use.
    return event;
  }

  guestRequestCreated(tenantId: string, guestId: string, requestId: string, title: string, message: string) {
    return this.publish({
      tenantId,
      recipientId: guestId,
      audience: NotificationAudience.GUEST,
      type: 'guest.request.created',
      title,
      message,
      severity: NotificationSeverity.INFO,
      channels: [NotificationChannel.IN_APP],
      metadata: { requestId },
    });
  }

  hotelRequestCreated(tenantId: string, requestId: string, roomNumber: string, title: string, message: string) {
    return this.publish({
      tenantId,
      audience: NotificationAudience.HOTEL,
      type: 'hotel.request.created',
      title,
      message,
      severity: NotificationSeverity.INFO,
      channels: [NotificationChannel.IN_APP],
      metadata: { requestId, roomNumber },
    });
  }

  zuitzeroIncident(incidentKey: string, severity: NotificationSeverity, title: string, message: string, metadata?: Record<string, unknown>) {
    return this.publish({
      audience: NotificationAudience.ZUITZERO,
      type: 'operations.incident',
      title,
      message,
      severity,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      metadata: { incidentKey, ...metadata },
    });
  }
}
