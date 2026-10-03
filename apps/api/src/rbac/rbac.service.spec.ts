import { ForbiddenException } from '@nestjs/common';
import { MembershipRole, TenantType } from '@prisma/client';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  const prisma = {
    membership: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;

  let service: RbacService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RbacService(prisma);
  });

  it('allows HOTEL_ADMIN hotel management', () => {
    expect(service.hasPermission(MembershipRole.HOTEL_ADMIN, 'hotel.manage')).toBe(true);
  });

  it('denies ZUITZERO_ADMIN billing mutations', () => {
    expect(service.hasPermission(MembershipRole.ZUITZERO_ADMIN, 'billing.manage')).toBe(false);
    expect(service.hasPermission(MembershipRole.ZUITZERO_ADMIN, 'billing.refund')).toBe(false);
  });

  it('allows OWNER billing mutations', () => {
    expect(service.hasPermission(MembershipRole.OWNER, 'billing.manage')).toBe(true);
    expect(service.hasPermission(MembershipRole.OWNER, 'billing.refund')).toBe(true);
  });

  it('rejects OWNER membership on a hotel tenant', async () => {
    prisma.membership.findUnique.mockResolvedValue({
      role: MembershipRole.OWNER,
      tenant: { type: TenantType.HOTEL },
    });

    await expect(service.getTenantAccess('owner-user', 'hotel-1')).resolves.toBeNull();
  });

  it('accepts HOTEL_ADMIN membership on a hotel tenant', async () => {
    prisma.membership.findUnique.mockResolvedValue({
      role: MembershipRole.HOTEL_ADMIN,
      tenant: { type: TenantType.HOTEL },
    });

    await expect(service.getTenantAccess('hotel-user', 'hotel-1')).resolves.toEqual({
      role: MembershipRole.HOTEL_ADMIN,
      tenantType: TenantType.HOTEL,
    });
  });

  it('requires OWNER for billing writes unless platform owner is present', async () => {
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.membership.findUnique.mockResolvedValue({
      role: MembershipRole.ZUITZERO_ADMIN,
    });

    await expect(service.assertBillingWrite('admin-user', 'hotel-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
