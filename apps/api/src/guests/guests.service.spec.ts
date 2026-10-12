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


describe('Guest CRM foundation', () => {
  function crmDb() {
    const guest = { id: 'guest-a', tenantId: 'hotel-a', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', phone: null, status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') };
    const db: any = {
      guest: { findFirst: jest.fn().mockResolvedValue(guest) },
      guestPreference: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pref-a', key: 'pillow', value: 'firm', updatedAt: new Date('2026-10-01T00:00:00Z') }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      guestTag: {
        findMany: jest.fn().mockResolvedValue([{ id: 'tag-a', label: 'VIP', createdAt: new Date('2026-10-01T00:00:00Z') }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      guestNote: {
        findMany: jest.fn().mockResolvedValue([{ id: 'note-a', body: 'Prefers quiet floors.', createdAt: new Date('2026-10-05T00:00:00Z'), author: { name: 'Manager' } }]),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'note-b', body: data.body, createdAt: new Date('2026-10-06T00:00:00Z'), author: { name: 'Manager' } })),
      },
      reservation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'res-a', confirmationCode: 'VAN-100', status: 'CHECKED_OUT', checkIn: new Date('2026-09-01T00:00:00Z'), checkOut: new Date('2026-09-03T00:00:00Z'), property: { id: 'prop-a', name: 'Hotel A' }, room: { id: 'room-a', number: '101' }, roomType: { id: 'type-a', name: 'King' }, createdAt: new Date('2026-08-01T00:00:00Z') }]),
      },
      guestRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: 'req-a', title: 'Extra towels', category: 'AMENITIES', priority: 'NORMAL', status: 'COMPLETED', createdAt: new Date('2026-09-02T00:00:00Z'), completedAt: new Date('2026-09-02T01:00:00Z'), property: { id: 'prop-a', name: 'Hotel A' }, room: { id: 'room-a', number: '101' } }]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (callback: any) => callback(db)),
    };
    return { db, guest };
  }

  it('returns tenant-scoped guest memory and consolidated timeline', async () => {
    const { db } = crmDb();
    const service = new GuestsService(db);
    const result = await service.getCrmForTenant('hotel-a', 'guest-a');
    expect(result.metrics).toEqual({ reservations: 1, completedStays: 1, requests: 1, completedRequests: 1 });
    expect(result.timeline.map(item => item.type)).toEqual(['NOTE', 'REQUEST', 'RESERVATION']);
    expect(db.guestPreference.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'hotel-a', guestId: 'guest-a' } }));
    expect(db.guestRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'hotel-a', guestId: 'guest-a' } }));
  });

  it('replaces only CRM tags/preferences and audits the mutation', async () => {
    const { db } = crmDb();
    const service = new GuestsService(db);
    await service.updateCrmForTenant('hotel-a', 'guest-a', {
      tags: [' VIP ', 'VIP', 'Repeat guest'],
      preferences: [{ key: ' Pillow ', value: ' Firm ' }, { key: 'pillow', value: 'Soft' }],
    });
    expect(db.guestTag.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'hotel-a', guestId: 'guest-a' } });
    expect(db.guestTag.createMany).toHaveBeenCalledWith({ data: [
      { tenantId: 'hotel-a', guestId: 'guest-a', label: 'VIP' },
      { tenantId: 'hotel-a', guestId: 'guest-a', label: 'Repeat guest' },
    ] });
    expect(db.guestPreference.createMany).toHaveBeenCalledWith({ data: [
      { tenantId: 'hotel-a', guestId: 'guest-a', key: 'pillow', value: 'Soft' },
    ] });
  });

  it('rejects cross-tenant CRM mutation before writes', async () => {
    const { db } = crmDb();
    db.guest.findFirst.mockResolvedValue(null);
    const service = new GuestsService(db);
    await expect(service.updateCrmForTenant('hotel-a', 'guest-b', { tags: ['VIP'] })).rejects.toThrow(NotFoundException);
    expect(db.guestTag.deleteMany).not.toHaveBeenCalled();
    expect(db.guestPreference.deleteMany).not.toHaveBeenCalled();
  });

  it('adds an immutable tenant-scoped CRM note with the authenticated author', async () => {
    const { db } = crmDb();
    const service = new GuestsService(db);
    const note = await service.addCrmNoteForTenant('hotel-a', 'guest-a', 'user-a', { body: '  Arrives late.  ' });
    expect(note.body).toBe('Arrives late.');
    expect(db.guestNote.create).toHaveBeenCalledWith(expect.objectContaining({ data: { tenantId: 'hotel-a', guestId: 'guest-a', authorUserId: 'user-a', body: 'Arrives late.' } }));
  });

  it('keeps CRM read/manage permissions explicit on controller routes', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.crm)).toEqual(['guests.read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.updateCrm)).toEqual(['guests.manage']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GuestsController.prototype.addCrmNote)).toEqual(['guests.manage']);
  });
});
