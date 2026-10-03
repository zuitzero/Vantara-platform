import { ExecutionContext } from '@nestjs/common';
import { AuditAction, MembershipRole, TenantType } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as any;
  const rbac = {
    getTenantAccess: jest.fn(),
    hasPermission: jest.fn(),
  } as any;
  const audit = { record: jest.fn() } as any;

  const request = {
    auth: { user: { id: 'user-1' } },
    tenantContext: { tenantId: 'hotel-a' },
  };

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  let guard: PermissionsGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PermissionsGuard(reflector, rbac, audit);
    reflector.getAllAndOverride.mockReturnValue(['guests.read']);
  });

  it('allows a permitted user in the active tenant', async () => {
    rbac.getTenantAccess.mockResolvedValue({
      role: MembershipRole.HOTEL_ADMIN,
      tenantType: TenantType.HOTEL,
    });
    rbac.hasPermission.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rbac.getTenantAccess).toHaveBeenCalledWith('user-1', 'hotel-a');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('denies access when the user has no membership in the active tenant', async () => {
    rbac.getTenantAccess.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow('Tenant access denied.');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'hotel-a',
        actorUserId: 'user-1',
        action: AuditAction.PERMISSION_DENIED,
      }),
    );
  });

  it('denies access when the role lacks the required permission', async () => {
    rbac.getTenantAccess.mockResolvedValue({
      role: MembershipRole.HOTEL_STAFF,
      tenantType: TenantType.HOTEL,
    });
    rbac.hasPermission.mockReturnValue(false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'You do not have permission to perform this action.',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'hotel-a',
        actorUserId: 'user-1',
        action: AuditAction.PERMISSION_DENIED,
        metadata: expect.objectContaining({
          role: MembershipRole.HOTEL_STAFF,
          tenantType: TenantType.HOTEL,
        }),
      }),
    );
  });

  it('accepts access when any declared permission is satisfied', async () => {
    reflector.getAllAndOverride.mockReturnValue(['guests.manage', 'guests.read']);
    rbac.getTenantAccess.mockResolvedValue({
      role: MembershipRole.HOTEL_STAFF,
      tenantType: TenantType.HOTEL,
    });
    rbac.hasPermission.mockImplementation(
      (_role: MembershipRole, permission: string) => permission === 'guests.read',
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rbac.hasPermission).toHaveBeenCalledTimes(2);
  });
});
