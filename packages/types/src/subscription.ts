export const VANTARA_PLANS = ['LOBBY', 'SUITE', 'GRAND'] as const;
export type VantaraPlan = (typeof VANTARA_PLANS)[number];

export const VANTARA_FEATURES = [
  'CRM',
  'RESERVATIONS',
  'WHATSAPP',
  'GUEST_REQUESTS',
  'GUEST_CONNECT',
  'ROOM_DEVICES',
  'INTELLIGENCE',
  'ADVANCED_OPERATIONS',
] as const;
export type VantaraFeature = (typeof VANTARA_FEATURES)[number];

export const PLAN_FEATURES: Record<VantaraPlan, readonly VantaraFeature[]> = {
  LOBBY: ['CRM', 'RESERVATIONS'],
  SUITE: ['CRM', 'RESERVATIONS', 'WHATSAPP', 'GUEST_REQUESTS', 'GUEST_CONNECT', 'ADVANCED_OPERATIONS'],
  GRAND: [...VANTARA_FEATURES],
};

export function planIncludesFeature(plan: VantaraPlan, feature: VantaraFeature): boolean {
  return PLAN_FEATURES[plan].includes(feature);
}
