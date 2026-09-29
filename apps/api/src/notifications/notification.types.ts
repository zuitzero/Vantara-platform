export enum NotificationAudience {
  GUEST = 'GUEST',
  HOTEL = 'HOTEL',
  ZUITZERO = 'ZUITZERO',
}

export enum NotificationSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  PUSH = 'PUSH',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
}

export enum GuestRequestStatus {
  CREATED = 'CREATED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface NotificationEvent {
  id: string;
  tenantId?: string;
  audience: NotificationAudience;
  recipientId?: string;
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  channels: NotificationChannel[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
