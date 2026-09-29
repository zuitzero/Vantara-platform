import { NotificationEvent } from '../notifications/notifications.types';

export function guestRequestCreatedEvent(input: {
  tenantId: string;
  guestId: string;
  requestId: string;
  roomId?: string | null;
  title: string;
  message: string;
  priority: string;
}): NotificationEvent[] {
  const baseMetadata = {
    requestId: input.requestId,
    guestId: input.guestId,
    roomId: input.roomId ?? null,
    priority: input.priority,
  };

  return [
    {
      audience: 'HOTEL',
      severity: input.priority === 'URGENT' ? 'CRITICAL' : input.priority === 'HIGH' ? 'HIGH' : 'INFO',
      channel: 'IN_APP',
      type: 'guest_request.created',
      title: 'New guest request',
      message: input.title,
      tenantId: input.tenantId,
      metadata: baseMetadata,
    },
    {
      audience: 'GUEST',
      severity: 'INFO',
      channel: 'IN_APP',
      type: 'guest_request.received',
      title: 'Request received',
      message: 'Your request has been sent to the hotel.',
      tenantId: input.tenantId,
      recipientId: input.guestId,
      metadata: baseMetadata,
    },
  ];
}

export function guestRequestStatusEvent(input: {
  tenantId: string;
  guestId: string;
  requestId: string;
  status: string;
  message: string;
}): NotificationEvent {
  return {
    audience: 'GUEST',
    severity: 'INFO',
    channel: 'IN_APP',
    type: `guest_request.${input.status.toLowerCase()}`,
    title: 'Request updated',
    message: input.message,
    tenantId: input.tenantId,
    recipientId: input.guestId,
    metadata: {
      requestId: input.requestId,
      status: input.status,
    },
  };
}
