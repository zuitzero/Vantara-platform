import { MembershipRole, TenantType } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService workspace selection', () => {
  const prisma = {} as any;
  const service = new AuthService(prisma);

  it('prefers the platform OWNER workspace for the owner account', () => {
    const memberships = [
      { role: MembershipRole.HOTEL_ADMIN, tenantId: 'hotel-1', tenant: { type: TenantType.HOTEL } },
      { role: MembershipRole.OWNER, tenantId: 'platform-1', tenant: { type: TenantType.PLATFORM } },
    ];

    expect((service as any).selectInitialMembership(memberships).tenantId).toBe('platform-1');
  });

  it('does not select an OWNER membership on a hotel tenant', () => {
    const memberships = [
      { role: MembershipRole.OWNER, tenantId: 'hotel-1', tenant: { type: TenantType.HOTEL } },
      { role: MembershipRole.HOTEL_ADMIN, tenantId: 'hotel-2', tenant: { type: TenantType.HOTEL } },
    ];

    expect((service as any).selectInitialMembership(memberships).tenantId).toBe('hotel-2');
  });

  it('does not select a platform tenant for a hotel role', () => {
    const memberships = [
      { role: MembershipRole.HOTEL_ADMIN, tenantId: 'platform-1', tenant: { type: TenantType.PLATFORM } },
    ];

    expect((service as any).selectInitialMembership(memberships)).toBeUndefined();
  });
});
