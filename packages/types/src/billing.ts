export const VANTARA_PLANS = {
  LOBBY: {
    monthlyPriceMxn: 2999,
    features: ['CRM', 'RESERVATIONS'] as const,
  },
  SUITE: {
    monthlyPriceMxn: 5999,
    features: [
      'CRM',
      'RESERVATIONS',
      'WHATSAPP',
      'GUEST_REQUESTS',
      'GUEST_CONNECT',
      'ADVANCED_OPERATIONS',
    ] as const,
  },
  GRAND: {
    monthlyPriceMxn: 7999,
    features: [
      'CRM',
      'RESERVATIONS',
      'WHATSAPP',
      'GUEST_REQUESTS',
      'GUEST_CONNECT',
      'ADVANCED_OPERATIONS',
      'ROOM_DEVICES',
      'INTELLIGENCE',
    ] as const,
  },
} as const;

export type VantaraPlan = keyof typeof VANTARA_PLANS;
export type VantaraFeature =
  (typeof VANTARA_PLANS)[VantaraPlan]['features'][number];

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE';

export interface SubscriptionSummary {
  plan: VantaraPlan;
  status: SubscriptionStatus;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

export interface PaymentSummary {
  id: string;
  amountMinor: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  provider: 'STRIPE';
  providerPaymentId?: string;
}

export interface ReservationCharge {
  reservationId: string;
  amountMinor: number;
  currency: string;
  paymentId?: string;
}
