import { MembershipRole } from '@prisma/client';

export const PERMISSIONS = {
  HOTEL_READ: 'hotel.read',
  HOTEL_MANAGE: 'hotel.manage',
  GUESTS_READ: 'guests.read',
  GUESTS_MANAGE: 'guests.manage',
  ROOMS_READ: 'rooms.read',
  ROOMS_MANAGE: 'rooms.manage',
  RESERVATIONS_READ: 'reservations.read',
  RESERVATIONS_MANAGE: 'reservations.manage',
  REQUESTS_READ: 'requests.read',
  REQUESTS_MANAGE: 'requests.manage',
  STAFF_READ: 'staff.read',
  STAFF_MANAGE: 'staff.manage',
  CRM_READ: 'crm.read',
  CRM_MANAGE: 'crm.manage',
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',
  BILLING_REFUND: 'billing.refund',
  SUPPORT_MANAGE: 'support.manage',
  INCIDENTS_READ: 'incidents.read',
  INCIDENTS_MANAGE: 'incidents.manage',
  ANALYTICS_GLOBAL: 'analytics.global',
  INFRASTRUCTURE_READ: 'infrastructure.read',
  SECURITY_READ: 'security.read',
  SECURITY_MANAGE: 'security.manage',
  NETWORK_READ: 'network.read',
  SYSTEM_MANAGE: 'system.manage',
  ROLES_MANAGE: 'roles.manage',
  OWNER_ALL: 'owner.*',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const HOTEL_STAFF = new Set<Permission>([
  PERMISSIONS.HOTEL_READ,
  PERMISSIONS.GUESTS_READ,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.RESERVATIONS_READ,
  PERMISSIONS.REQUESTS_READ,
  PERMISSIONS.REQUESTS_MANAGE,
  PERMISSIONS.CRM_READ,
]);

const HOTEL_ADMIN = new Set<Permission>([
  ...HOTEL_STAFF,
  PERMISSIONS.HOTEL_MANAGE,
  PERMISSIONS.GUESTS_MANAGE,
  PERMISSIONS.ROOMS_MANAGE,
  PERMISSIONS.RESERVATIONS_MANAGE,
  PERMISSIONS.STAFF_READ,
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.CRM_MANAGE,
  PERMISSIONS.BILLING_READ,
]);

const ZUITZERO_ADMIN = new Set<Permission>([
  PERMISSIONS.HOTEL_READ,
  PERMISSIONS.HOTEL_MANAGE,
  PERMISSIONS.GUESTS_READ,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.RESERVATIONS_READ,
  PERMISSIONS.REQUESTS_READ,
  PERMISSIONS.REQUESTS_MANAGE,
  PERMISSIONS.SUPPORT_MANAGE,
  PERMISSIONS.INCIDENTS_READ,
  PERMISSIONS.INCIDENTS_MANAGE,
  PERMISSIONS.BILLING_READ,
  PERMISSIONS.ANALYTICS_GLOBAL,
  PERMISSIONS.NETWORK_READ,
]);

const ROLE_PERMISSIONS: Record<MembershipRole, Set<Permission>> = {
  GUEST: new Set(),
  HOTEL_STAFF,
  HOTEL_ADMIN,
  ZUITZERO_ADMIN,
  OWNER: new Set(Object.values(PERMISSIONS)),
};

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: MembershipRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
