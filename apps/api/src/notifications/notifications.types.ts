export type NotificationAudience = 'GUEST' | 'HOTEL' | 'ZUITZERO';
export type NotificationSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type NotificationChannel = 'IN_APP' | 'PUSH' | 'WHATSAPP' | 'EMAIL';

export interface NotificationEvent {
  audience: NotificationAudience;
  severity: NotificationSeverity;
  channel?: NotificationChannel;
  type: string;
  title: string;
  message: string;
  tenantId?: string;
  recipientId?: string;
  metadata?: Record<string, unknown>;
}
