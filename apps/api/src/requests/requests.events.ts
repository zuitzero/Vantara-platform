import { GuestRequestStatus } from '@prisma/client';
import { NotificationEvent } from '../notifications/notifications.types';

const statusMessages: Partial<Record<GuestRequestStatus, string>> = {
  ACKNOWLEDGED: 'The hotel has received your request.',
  IN_PROGRESS: 'The hotel is currently handling your request.',
  COMPLETED: 'Your request has been completed.',
  CANCELLED: 'Your request has been cancelled.',
};

export function guestRequestStatusNotification(input: {
  tenantId: string;
  guestId: string;
  requestId: string;
  status: GuestRequestStatus;
}): NotificationEvent | null {
  const message = statusMessages[input.status];
  if (!message) return null;

  return {
    audience: 'GUEST',
    severity: 'INFO',
    channel: 'IN_APP',
    type: `guest_request.${input.status.toLowerCase()}`,
    title: 'Request updated',
    message,
    tenantId: input.tenantId,
    recipientId: input.guestId,
    metadata: {
      requestId: input.requestId,
      status: input.status,
    },
  };
}
