import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  it('allows a route when the current membership has a required role', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([MembershipRole.HOTEL_ADMIN]);

    const guard = new RolesGuard(reflector);
    const request = {
      tenantContext: {
        tenantId: 'tenant-a',
        membershipId: 'member-a',
        role: MembershipRole.HOTEL_ADMIN,
      },
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a route when the current membership lacks the required role', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([MembershipRole.OWNER]);

    const guard = new RolesGuard(reflector);
    const request = {
      tenantContext: {
        tenantId: 'tenant-a',
        membershipId: 'member-a',
        role: MembershipRole.HOTEL_STAFF,
      },
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow('You do not have permission');
  });
});
