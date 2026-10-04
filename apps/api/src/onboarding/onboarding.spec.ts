import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { OnboardingService } from './onboarding.service';
import { CreateWorkspaceDto } from './onboarding.dto';
import { OnboardingController } from './onboarding.controller';
import { RoomsService } from '../rooms/rooms.service';
import { RoomTypesService } from '../properties/room-types.service';
import { CreateRoomTypeDto } from '../properties/room-types.dto';
import { CreateRoomDto } from '../rooms/rooms.dto';
import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { RoomsController } from '../rooms/rooms.controller';
import { RoomTypesController } from '../properties/room-types.controller';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RbacService } from '../rbac/rbac.service';

const input = { name: ' Admin ', email: ' ADMIN@Example.com ', password: 'safe-password', hotelName: ' Hotel A ', slug: ' HOTEL-A ', propertyName: ' Main property ', plan: 'LOBBY' };
function fixture() {
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'user-a' }) },
    tenant: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'hotel-a' }) },
    membership: { create: jest.fn().mockResolvedValue({}) },
    property: { create: jest.fn().mockResolvedValue({ id: 'property-a' }) },
    subscription: { create: jest.fn().mockResolvedValue({ id: 'subscription-a' }) },
  };
  const db = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
  return { db, tx, service: new OnboardingService(db as any) };
}
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

describe('Safe hotel bootstrap', () => {
  it('normalizes identity and slug, fixes HOTEL_ADMIN/HOTEL and preserves trial without creating sessions', async () => {
    const { service, tx, db } = fixture();
    const result = await service.createWorkspace(input as any);
    expect(tx.user.create).toHaveBeenCalledWith({ data: { email: 'admin@example.com', name: 'Admin', passwordHash: expect.stringMatching(/^scrypt:/) } });
    expect(tx.tenant.create).toHaveBeenCalledWith({ data: { name: 'Hotel A', slug: 'hotel-a', type: 'HOTEL' } });
    expect(tx.membership.create).toHaveBeenCalledWith({ data: { userId: 'user-a', tenantId: 'hotel-a', role: 'HOTEL_ADMIN' } });
    expect(tx.property.create).toHaveBeenCalledWith({ data: { tenantId: 'hotel-a', name: 'Main property' } });
    expect(tx.subscription.create).toHaveBeenCalledWith({ data: { tenantId: 'hotel-a', plan: 'LOBBY', status: 'TRIALING' } });
    expect(result).not.toHaveProperty('passwordHash'); expect(result).not.toHaveProperty('token');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('creates a password hash accepted by the existing normal login flow', async () => {
    const { service, tx } = fixture(); await service.createWorkspace(input as any);
    const passwordHash = tx.user.create.mock.calls[0][0].data.passwordHash;
    const session = { create: jest.fn() };
    const auth = new AuthService({ user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-a', passwordHash, memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_ADMIN', tenant: { type: 'HOTEL' } }] }) }, session } as any);
    const result = await auth.login({ email: 'admin@example.com', password: input.password });
    expect(result.token).toBeTruthy(); expect(session.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activeTenantId: 'hotel-a', userId: 'user-a' }) }));
  });
  it('uses the existing LOBBY trial default', async () => {
    const { service } = fixture(); expect((await service.createWorkspace({ ...input, plan: undefined } as any)).plan).toBe('LOBBY');
  });
  it('rejects an existing global email rather than adding a membership', async () => {
    const { service, tx } = fixture(); tx.user.findUnique.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createWorkspace(input as any)).rejects.toThrow('email already has an account');
    expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.com' }, select: { id: true } });
    expect(tx.user.create).not.toHaveBeenCalled(); expect(tx.membership.create).not.toHaveBeenCalled();
  });
  it('rejects a normalized duplicate slug', async () => {
    const { service, tx } = fixture(); tx.tenant.findUnique.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createWorkspace(input as any)).rejects.toThrow('slug is already in use');
    expect(tx.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'hotel-a' }, select: { id: true } });
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it('maps a racing uniqueness violation to a clear conflict', async () => {
    const { service, tx } = fixture(); tx.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6' }));
    await expect(service.createWorkspace(input as any)).rejects.toThrow(ConflictException);
  });
  it.each(['OWNER', 'ZUITZERO_ADMIN'])('rejects requested privileged role %s', async role => {
    const { service, tx } = fixture();
    await expect(service.createWorkspace({ ...input, role } as any)).rejects.toThrow(BadRequestException);
    expect(tx.membership.create).not.toHaveBeenCalled();
  });
  it.each(['tenantId', 'type', 'userId', 'membershipId', 'subscriptionStatus'])('rejects unexpected ownership %s', async key => {
    await expect(pipe.transform({ ...input, [key]: 'foreign' }, { type: 'body', metatype: CreateWorkspaceDto })).rejects.toThrow(BadRequestException);
  });
  it.each([{ plan: 'OWNER' }, { plan: null }, { name: '   ' }, { hotelName: '\t' }, { propertyName: '  ' }, { email: 'bad-email' }, { password: 'short' }, { password: 'a'.repeat(129) }, { slug: 'hotel with spaces' }, { slug: '-hotel-' }, { slug: 'hotel--a' }, { slug: 'hôtel' }, { slug: 'ab' }])('validates bootstrap payload %j on the server', async invalid => {
    const { service, db } = fixture();
    await expect(service.createWorkspace({ ...input, ...invalid } as any)).rejects.toThrow(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('aborts the transaction if trial creation fails; all writes remain in its callback', async () => {
    const { service, tx, db } = fixture(); let committed: string[] = [];
    db.$transaction.mockImplementation(async callback => {
      const pending: string[] = [];
      for (const key of ['user', 'tenant', 'membership', 'property']) (tx as any)[key].create.mockImplementation(async () => { pending.push(key); return { id: `${key}-a` }; });
      tx.subscription.create.mockRejectedValue(new Error('subscription unavailable'));
      const result = await callback(tx); committed = pending; return result;
    });
    await expect(service.createWorkspace(input as any)).rejects.toThrow('subscription unavailable');
    expect(committed).toEqual([]); expect(tx.property.create).toHaveBeenCalled();
  });
});

describe('Minimum operational setup status', () => {
  function setup(properties: any[]) {
    const db = { tenant: { findUnique: jest.fn().mockResolvedValue({ type: 'HOTEL' }) }, property: { findMany: jest.fn().mockResolvedValue(properties) } };
    return { db, service: new OnboardingService(db as any) };
  }
  it.each([
    { properties: [{ id: 'p', name: 'Main', roomTypes: [] }], roomTypes: false, ready: false },
    { properties: [{ id: 'p', name: 'Main', roomTypes: [{ id: 'rt', rooms: [] }] }], roomTypes: true, ready: false },
    { properties: [{ id: 'p', name: 'Main', roomTypes: [{ id: 'rt', rooms: [{ propertyId: 'p' }] }] }], roomTypes: true, ready: true },
  ])('derives setup from real inventory %j', async item => {
    const { service, db } = setup(item.properties); const status = await service.statusForTenant('hotel-a');
    expect(status).toMatchObject({ workspaceCreated: true, propertyConfigured: true, roomTypesConfigured: item.roomTypes, roomsConfigured: item.ready, operationallyReady: item.ready });
    expect(db.property.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'hotel-a' } }));
  });
  it('does not require future empty properties, or count mismatched room/type properties', async () => {
    const { service } = setup([{ id: 'p', name: 'Main', roomTypes: [{ id: 'rt', rooms: [{ propertyId: 'p' }] }] }, { id: 'future', name: 'Future', roomTypes: [] }]);
    expect((await service.statusForTenant('hotel-a')).operationallyReady).toBe(true);
    const bad = setup([{ id: 'p', name: 'Main', roomTypes: [{ id: 'rt', rooms: [{ propertyId: 'foreign' }] }] }]);
    expect((await bad.service.statusForTenant('hotel-a')).operationallyReady).toBe(false);
  });
  it('returns useful empty state and rejects platform tenants', async () => {
    const { service, db } = setup([]); expect(await service.statusForTenant('hotel-a')).toMatchObject({ propertyConfigured: false, operationallyReady: false });
    db.tenant.findUnique.mockResolvedValue({ type: 'PLATFORM' });
    await expect(service.statusForTenant('platform')).rejects.toThrow(ForbiddenException);
  });
  it('derives status tenant from authenticated context rather than supplied query', () => {
    const request = { auth: { tenant: { id: 'hotel-a' }, membership: { id: 'member-a', role: 'HOTEL_ADMIN' } }, query: { tenantId: 'hotel-b' }, tenantContext: { tenantId: 'hotel-b' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    new TenantContextGuard().canActivate(context); const statusForTenant = jest.fn();
    new OnboardingController({ statusForTenant } as any).status(request as any);
    expect(statusForTenant).toHaveBeenCalledWith('hotel-a');
  });
});

describe('Existing inventory API setup safety', () => {
  function inventory() {
    const db = { property: { findFirst: jest.fn().mockResolvedValue({ id: 'p' }) }, roomType: { findFirst: jest.fn().mockResolvedValue({ id: 'rt' }), create: jest.fn() }, room: { create: jest.fn() } };
    return { db, rooms: new RoomsService(db as any, new RoomReadinessService(db as any)), types: new RoomTypesService(db as any) };
  }
  it('rejects foreign properties for rooms and room types', async () => {
    const { db, rooms, types } = inventory(); db.property.findFirst.mockResolvedValue(null);
    await expect(rooms.createForTenant('hotel-a', 'foreign', { number: '101', roomTypeId: 'rt' })).rejects.toThrow(NotFoundException);
    await expect(types.createForTenant('hotel-a', 'foreign', { name: 'Double', code: 'DBL', maxGuests: 2 })).rejects.toThrow(NotFoundException);
    expect(db.property.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'hotel-a', tenant: { type: 'HOTEL' } } });
    expect(db.room.create).not.toHaveBeenCalled(); expect(db.roomType.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign or cross-property room type', async () => {
    const { db, rooms } = inventory(); db.roomType.findFirst.mockResolvedValue(null);
    await expect(rooms.createForTenant('hotel-a', 'p', { number: '101', roomTypeId: 'foreign' })).rejects.toThrow('Room type');
    expect(db.roomType.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', propertyId: 'p' } }); expect(db.room.create).not.toHaveBeenCalled();
  });
  it.each([CreateRoomTypeDto, CreateRoomDto])('rejects client tenant ownership and whitespace-only inventory names %p', async metatype => {
    const body = metatype === CreateRoomDto ? { number: '101', roomTypeId: 'rt' } : { name: 'Double', code: 'DBL', maxGuests: 2 };
    await expect(pipe.transform({ ...body, tenantId: 'foreign' }, { type: 'body', metatype })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...body, ...(metatype === CreateRoomDto ? { number: ' ' } : { name: ' ' }) }, { type: 'body', metatype })).rejects.toThrow(BadRequestException);
  });
  it.each([OnboardingController.prototype.status, RoomsController.prototype.create, RoomTypesController.prototype.create])('denies HOTEL_STAFF administration but permits HOTEL_ADMIN %p', async handler => {
    for (const role of [MembershipRole.HOTEL_STAFF, MembershipRole.HOTEL_ADMIN]) {
      const request = { auth: { user: { id: 'u' }, membership: { role }, tenant: { id: 'hotel-a' } }, tenantContext: { tenantId: 'hotel-a' } };
      const context = { getHandler: () => handler, getClass: () => OnboardingController, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      const rbac = new RbacService({ membership: { findUnique: jest.fn().mockResolvedValue({ role, tenant: { type: 'HOTEL' } }) } } as any);
      const guard = new PermissionsGuard(new Reflector(), rbac, { record: jest.fn() } as any);
      if (role === MembershipRole.HOTEL_STAFF) await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      else await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });
});
