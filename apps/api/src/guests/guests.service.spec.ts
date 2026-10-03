import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MembershipRole, ReservationStatus, TenantType } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { PERMISSIONS_KEY, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RbacService } from '../rbac/rbac.service';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

describe('Guests / Front Desk read contract', () => {
  afterEach(() => jest.useRealTimers());

  it('scopes guests and nested reservation context to the same tenant and preserves existing fields', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T20:30:00Z'));
    const records = [{ id: 'guest-a', email: null, phone: null, property: null, room: null, reservations: [] }];
    const findMany = jest.fn().mockResolvedValue(records);
    const service = new GuestsService({ guest: { findMany } } as any);
    await expect(service.listForTenant('hotel-a')).resolves.toEqual(records);
    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({ tenantId: 'hotel-a' });
    expect(query.include.property).toBe(true);
    expect(query.include.room).toEqual({ include: { roomType: true } });
    expect(query.include.reservations.where).toEqual({
      tenantId: 'hotel-a',
      OR: [
        { status: ReservationStatus.CHECKED_IN },
        { status: { in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED] }, checkOut: { gte: new Date('2026-10-03T00:00:00Z') } },
      ],
    });
    // Explicit projection prevents guests.read from exposing reservation billing or private notes.
    expect(Object.keys(query.include.reservations.select).sort()).toEqual([
      'checkIn', 'checkOut', 'confirmationCode', 'id', 'property', 'room', 'roomType', 'status',
    ]);
    expect(query.orderBy).toEqual([{ lastName: 'asc' }, { firstName: 'asc' }]);
  });

  it('rejects cross-tenant guest lookup', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new GuestsService({ guest: { findFirst } } as any);
    await expect(service.getForTenant('hotel-a', 'guest-from-hotel-b')).rejects.toThrow(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'guest-from-hotel-b', tenantId: 'hotel-a' } }));
  });

  it('keeps authenticated tenant and guests.read guards on the existing routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GuestsController)).toEqual([AuthGuard, TenantContextGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.list)).toEqual(['guests.read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.get)).toEqual(['guests.read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.create)).toEqual(['guests.manage']);
  });

  it.each([MembershipRole.HOTEL_STAFF, MembershipRole.HOTEL_ADMIN])('allows %s through real RBAC and ignores client tenant ownership', async role => {
    const request = {
      auth: { user: { id: 'user-a' }, tenant: { id: 'hotel-a' }, membership: { id: 'member-a', role } },
      query: { tenantId: 'hotel-b' }, body: { tenantId: 'hotel-b' }, tenantContext: { tenantId: 'hotel-b' },
    };
    const context = {
      getHandler: () => GuestsController.prototype.list,
      getClass: () => GuestsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const findUnique = jest.fn().mockResolvedValue({ role, tenant: { type: TenantType.HOTEL } });
    const rbac = new RbacService({ membership: { findUnique } } as any);
    new TenantContextGuard().canActivate(context);
    await expect(new PermissionsGuard(new Reflector(), rbac, { record: jest.fn() } as any).canActivate(context)).resolves.toBe(true);
    const listForTenant = jest.fn().mockResolvedValue([]);
    await new GuestsController({ listForTenant } as any).list(request as any);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_tenantId: { userId: 'user-a', tenantId: 'hotel-a' } } }));
    expect(listForTenant).toHaveBeenCalledWith('hotel-a');
  });

  it('denies reading guests when the authenticated user has no membership in the active tenant', async () => {
    const request = { auth: { user: { id: 'outsider' } }, tenantContext: { tenantId: 'hotel-a' } };
    const context = {
      getHandler: () => GuestsController.prototype.list,
      getClass: () => GuestsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const rbac = new RbacService({ membership: { findUnique: jest.fn().mockResolvedValue(null) } } as any);
    await expect(new PermissionsGuard(new Reflector(), rbac, { record: jest.fn() } as any).canActivate(context)).rejects.toThrow('Tenant access denied');
  });
});
