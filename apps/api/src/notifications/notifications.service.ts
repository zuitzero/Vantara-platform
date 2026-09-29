import { Injectable, Logger } from '@nestjs/common';
import { NotificationEvent } from './notifications.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  publish(event: NotificationEvent): NotificationEvent {
    // Transport and persistence are intentionally separated from event creation.
    // Realtime delivery will consume this contract in the next phase.
    this.logger.log(`Notification event: ${event.type} → ${event.audience}`);
    return event;
  }
}
