export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export type ReservationStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';

export type PlanCode = 'LOBBY' | 'SUITE' | 'GRAND';

export type FeatureCode =
  | 'CRM'
  | 'RESERVATIONS'
  | 'WHATSAPP'
  | 'GUEST_REQUESTS'
  | 'GUEST_CONNECT'
  | 'ADVANCED_OPERATIONS'
  | 'ROOM_DEVICES'
  | 'INTELLIGENCE';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'PAUSED';

export const PLAN_FEATURES: Record<PlanCode, readonly FeatureCode[]> = {
  LOBBY: ['CRM', 'RESERVATIONS'],
  SUITE: [
    'CRM',
    'RESERVATIONS',
    'WHATSAPP',
    'GUEST_REQUESTS',
    'GUEST_CONNECT',
    'ADVANCED_OPERATIONS',
  ],
  GRAND: [
    'CRM',
    'RESERVATIONS',
    'WHATSAPP',
    'GUEST_REQUESTS',
    'GUEST_CONNECT',
    'ADVANCED_OPERATIONS',
    'ROOM_DEVICES',
    'INTELLIGENCE',
  ],
};

export function planIncludesFeature(plan: PlanCode, feature: FeatureCode): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}
