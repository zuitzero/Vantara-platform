import { guestRequestCreatedEvent } from '../requests/requests.notifications';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { ExecutionContext, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AuditAction, MembershipRole, Prisma, RoomReadinessStatus } from '@prisma/client';
import { firstValueFrom, from } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { AuditService, auditMutation } from '../rbac/audit.service';
import { AuditContextInterceptor, auditActor } from '../rbac/audit-context';
import { AuditController, AuditQuery } from '../rbac/audit.controller';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RbacService } from '../rbac/rbac.service';
import { StaffService } from '../staff/staff.service';
import { ReservationsService } from '../reservations/reservations.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const event = { tenantId: 'hotel-a', audience: 'HOTEL' as const, severity: 'INFO' as const, type: 'housekeeping.assigned', title: 'Assigned', message: 'New work' };
function fixture() {
  const rows: any[] = []; const receipts: any[] = [];
  function matches(row: any, where: any) { return row.tenantId === where.tenantId && row.audience === where.audience && (!where.id || row.id === where.id) && where.OR.some((clause: any) => row.recipientId === clause.recipientId); }
  const db = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ type: 'HOTEL' }) },
    membership: { findFirst: jest.fn(async ({ where }) => where.tenantId === 'hotel-a' && ['user-a', 'user-b'].includes(where.userId) ? { userId: where.userId, role: 'HOTEL_STAFF' } : null) },
    guest: { findFirst: jest.fn(async ({ where }) => where.id === 'guest-a' && where.tenantId === 'hotel-a' ? { id: 'guest-a' } : null) },
    operationalStaff: { findFirst: jest.fn().mockResolvedValue({ id: 'staff-a', membership: { userId: 'user-a' } }) },
    auditLog: { create: jest.fn(async ({ data }) => ({ id: 'audit-a', ...data })), findMany: jest.fn().mockResolvedValue([]) },
    notification: {
      create: jest.fn(async ({ data }) => { const row = { id: `n-${rows.length}`, readAt: null, ...data, recipientId: data.recipientId ?? null }; rows.push(row); return row; }),
      findFirst: jest.fn(async ({ where }) => rows.find(row => matches(row, where)) ?? null),
      findMany: jest.fn(async ({ where, include }) => rows.filter(row => matches(row, where) && (!where.reads || !receipts.some(r => r.notificationId === row.id && r.userId === where.reads.none.userId))).map(row => ({ ...row, reads: receipts.filter(r => r.notificationId === row.id && r.userId === include.reads.where.userId) }))),
    },
    notificationRead: { upsert: jest.fn(async ({ create }) => { if (!receipts.some(r => r.notificationId === create.notificationId && r.userId === create.userId)) receipts.push({ ...create, readAt: new Date() }); }) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async callback => callback(db));
  const gateway = { emit: jest.fn() }; const service = new NotificationsService(db as any, gateway as any);
  return { db, gateway, service, rows, receipts };
}

describe('Notification persistence and isolation', () => {
  it('persists before realtime and never emits on persistence failure', async () => {
    const f = fixture(); f.gateway.emit.mockImplementation(() => { expect(f.rows).toHaveLength(1); });
    await f.service.publish(event); expect(f.gateway.emit).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-0', tenantId: 'hotel-a' }));
    f.gateway.emit.mockClear(); f.db.notification.create.mockRejectedValue(new Error('database unavailable'));
    await expect(f.service.publish(event)).rejects.toThrow('database unavailable'); expect(f.gateway.emit).not.toHaveBeenCalled();
  });
  it('retains persisted notification if realtime delivery fails', async () => {
    const f = fixture(); f.gateway.emit.mockImplementation(() => { throw new Error('socket unavailable'); });
    await expect(f.service.publish(event)).resolves.toMatchObject({ id: 'n-0' }); expect(f.rows).toHaveLength(1);
  });
  it('requires a tenant and matching audience/tenant type', async () => {
    const f = fixture(); await expect(f.service.publish({ ...event, tenantId: undefined })).rejects.toThrow('tenantId');
    await expect(f.service.publish({ ...event, audience: 'ZUITZERO' })).rejects.toThrow(ForbiddenException);
    f.db.tenant.findUnique.mockResolvedValue({ type: 'PLATFORM' }); await expect(f.service.publish(event)).rejects.toThrow(ForbiddenException);
    expect(f.db.notification.create).not.toHaveBeenCalled();
  });
  it('rejects foreign/platform recipients and unsupported delivery', async () => {
    const f = fixture(); await expect(f.service.publish({ ...event, recipientId: 'foreign' })).rejects.toThrow(ForbiddenException);
    await expect(f.service.publish({ ...event, channel: 'EMAIL' })).rejects.toThrow(ForbiddenException);
    await expect(f.service.publish({ ...event, audience: 'GUEST', recipientId: 'foreign-guest' })).rejects.toThrow(ForbiddenException);
    expect(f.rows).toHaveLength(0);
  });
  it('scopes recipient lists and mark-read to the tenant and recipient', async () => {
    const f = fixture(); await f.service.publish({ ...event, recipientId: 'user-a' });
    expect(await f.service.listForHotel('hotel-a', 'user-b', MembershipRole.HOTEL_STAFF)).toEqual([]);
    await expect(f.service.markRead('hotel-a', 'n-0', 'user-b', MembershipRole.HOTEL_STAFF)).rejects.toThrow(NotFoundException);
    await expect(f.service.markRead('hotel-b', 'n-0', 'user-a', MembershipRole.HOTEL_STAFF)).rejects.toThrow(ForbiddenException);
    expect(f.receipts).toEqual([]);
  });
  it('keeps broadcast read state per user and supports independent unread filtering', async () => {
    const f = fixture(); await f.service.publish(event);
    await f.service.markRead('hotel-a', 'n-0', 'user-a', MembershipRole.HOTEL_STAFF);
    await f.service.markRead('hotel-a', 'n-0', 'user-a', MembershipRole.HOTEL_STAFF);
    expect(f.receipts).toHaveLength(1); expect(f.rows[0].readAt).toBeNull();
    expect(await f.service.listForHotel('hotel-a', 'user-a', MembershipRole.HOTEL_STAFF, true)).toEqual([]);
    expect(await f.service.listForHotel('hotel-a', 'user-b', MembershipRole.HOTEL_STAFF, true)).toHaveLength(1);
    expect((await f.service.listForHotel('hotel-a', 'user-a', MembershipRole.HOTEL_STAFF))[0].readAt).toBeInstanceOf(Date);
  });
  it.each([MembershipRole.OWNER, MembershipRole.ZUITZERO_ADMIN, MembershipRole.GUEST])('denies HOTEL notification reads for %s', async role => {
    const f = fixture(); await expect(f.service.listForHotel('hotel-a', 'user-a', role)).rejects.toThrow(ForbiddenException);
  });
  it('derives assignment recipient through the operational profile membership', async () => {
    const f = fixture(); const staff = new StaffService(f.db as any, f.service);
    await staff.transaction(async tx => {
      await staff.notifyWork(tx, 'hotel-a', { id: 'work-a', roomId: 'room-a', propertyId: 'property-a', assignedStaffId: 'staff-a', priority: 'NORMAL' }, 'housekeeping', true, false);
      expect(f.gateway.emit).not.toHaveBeenCalled();
    });
    expect(f.rows[0].recipientId).toBe('user-a'); expect(f.gateway.emit).toHaveBeenCalledTimes(1);
    expect(f.db.operationalStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'staff-a', tenantId: 'hotel-a' } }));
    f.db.operationalStaff.findFirst.mockResolvedValue({ id: 'staff-a', membership: { userId: 'platform-user' } });
    await expect(staff.transaction(tx => staff.notifyWork(tx, 'hotel-a', { id: 'work-a', roomId: 'room-a', propertyId: 'property-a', assignedStaffId: 'staff-a', priority: 'NORMAL' }, 'maintenance', true, false))).rejects.toThrow(ForbiddenException);
  });
  it('preserves urgent guest request attention with tenant-scoped recipients', () => {
    const events = guestRequestCreatedEvent({ tenantId: 'hotel-a', guestId: 'guest-a', requestId: 'request-a', title: 'Help', message: 'Help', priority: 'URGENT' });
    expect(events[0]).toMatchObject({ tenantId: 'hotel-a', audience: 'HOTEL', severity: 'CRITICAL' });
    expect(events[1]).toMatchObject({ tenantId: 'hotel-a', audience: 'GUEST', recipientId: 'guest-a' });
  });
  it('notifies high/urgent maintenance once, while ordinary changes are quiet', async () => {
    const f = fixture(); const staff = new StaffService(f.db as any, f.service);
    const work = { id: 'work-a', roomId: 'room-a', propertyId: 'property-a', assignedStaffId: null, priority: 'URGENT' };
    await staff.transaction(tx => staff.notifyWork(tx, 'hotel-a', work, 'maintenance', false, true));
    expect(f.rows[0].severity).toBe('CRITICAL');
    await staff.transaction(tx => staff.notifyWork(tx, 'hotel-a', work, 'maintenance', false, false)); expect(f.rows).toHaveLength(1);
  });
  it('discards realtime from rolled-back attempts and emits only the successful retry', async () => {
    const f = fixture(); const staff = new StaffService(f.db as any, f.service); let attempt = 0;
    f.db.$transaction.mockImplementation(async callback => {
      const count = f.rows.length; const result = await callback(f.db);
      if (++attempt === 1) { f.rows.splice(count); throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: '6' }); }
      return result;
    });
    await staff.transaction(tx => staff.notifyWork(tx, 'hotel-a', { id: 'work-a', roomId: 'r', propertyId: 'p', assignedStaffId: 'staff-a', priority: 'NORMAL' }, 'maintenance', true, false));
    expect(f.rows).toHaveLength(1); expect(f.gateway.emit).toHaveBeenCalledTimes(1); expect(attempt).toBe(2);
  });
});

describe('Central operational audit', () => {
  it('derives the actor from server auth and strips sensitive metadata', async () => {
    const f = fixture(); const req = { auth: { user: { id: 'user-a' }, tenant: { id: 'hotel-a' } }, body: { actorUserId: 'attacker', tenantId: 'hotel-b' } };
    const interceptor = new AuditContextInterceptor();
    await firstValueFrom(interceptor.intercept({ switchToHttp: () => ({ getRequest: () => req }) } as any, { handle: () => from(auditMutation(f.db as any, 'hotel-a', AuditAction.GUEST_CREATED, 'guest', 'g', { password: 'secret', token: 'secret', email: 'private', notes: 'private', status: 'ACTIVE', nested: { password: 'secret' } })) }));
    const data = f.db.auditLog.create.mock.calls[0][0].data;
    expect(data.actorUserId).toBe('user-a'); expect(data.tenantId).toBe('hotel-a'); expect(data.actorType).toBe('USER'); expect(data.metadata).toEqual({ status: 'ACTIVE' });
  });
  it('rejects cross-tenant writes and supplied actor mismatch', async () => {
    const f = fixture(); const audit = new AuditService(f.db as any);
    await auditActor.run({ userId: 'user-a', tenantId: 'hotel-a' }, async () => {
      await expect(auditMutation(f.db as any, 'hotel-b', AuditAction.GUEST_CREATED, 'guest', 'foreign')).rejects.toThrow(ForbiddenException);
      expect(() => audit.record({ actorUserId: 'attacker', tenantId: 'hotel-a', action: AuditAction.UPDATE, resourceType: 'guest' })).toThrow(ForbiddenException);
      await expect(audit.listForHotel('hotel-b', 0, 25)).rejects.toThrow(ForbiddenException);
    }); expect(f.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('scopes audit reads with limits, removes old sensitive metadata and rejects platform tenants', async () => {
    const f = fixture(); f.db.auditLog.findMany.mockResolvedValue([{ id: 'a', metadata: { password: 'old-secret', status: 'CHECKED_IN' } }] as any);
    const audit = new AuditService(f.db as any); const result = await audit.listForHotel('hotel-a', 0, 25);
    expect(result.items[0].metadata).toEqual({ status: 'CHECKED_IN' });
    expect(f.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'hotel-a' }, skip: 0, take: 26 }));
    f.db.tenant.findUnique.mockResolvedValue({ type: 'PLATFORM' }); await expect(audit.listForHotel('platform', 0, 25)).rejects.toThrow(ForbiddenException);
  });
  it.each([{ limit: 101 }, { offset: -1 }, { action: 'UNSAFE' }, { tenantId: 'hotel-b' }])('rejects unsafe audit query %j', async query => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }); await expect(pipe.transform(query, { type: 'query', metatype: AuditQuery })).rejects.toThrow();
  });
  it.each([MembershipRole.HOTEL_STAFF, MembershipRole.HOTEL_ADMIN])('enforces audit permission for %s', async role => {
    const f = fixture(); const req = { auth: { user: { id: 'user-a' }, membership: { role } }, tenantContext: { tenantId: 'hotel-a' } };
    const rbac = new RbacService({ membership: { findUnique: jest.fn().mockResolvedValue({ role, tenant: { type: 'HOTEL' } }) } } as any);
    const context = { getHandler: () => AuditController.prototype.list, getClass: () => AuditController, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    const guard = new PermissionsGuard(new Reflector(), rbac, new AuditService(f.db as any));
    if (role === MembershipRole.HOTEL_STAFF) { await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException); expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PERMISSION_DENIED', success: false }) })); }
    else await expect(guard.canActivate(context)).resolves.toBe(true);
  });
  it('audits reservation confirmation in its transaction and aborts on audit failure', async () => {
    const f = fixture(); const current = { id: 'res-a', tenantId: 'hotel-a', status: 'PENDING' };
    Object.assign(f.db, { reservation: { findFirst: jest.fn().mockResolvedValue(current), update: jest.fn() } });
    const service = new ReservationsService(f.db as any, new RoomReadinessService(f.db as any));
    await auditActor.run({ userId: 'user-a', tenantId: 'hotel-a' }, () => service.updateStatusForTenant('hotel-a', 'res-a', 'CONFIRMED'));
    expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RESERVATION_CONFIRMED', resourceId: 'res-a', actorUserId: 'user-a', metadata: { status: 'CONFIRMED', previousStatus: 'PENDING', roomId: null } }) }));
    f.db.auditLog.create.mockRejectedValue(new Error('audit unavailable')); await expect(service.updateStatusForTenant('hotel-a', 'res-a', 'CONFIRMED')).rejects.toThrow('audit unavailable');
  });
  it('audits OUT_OF_SERVICE lock using server actor in the same transaction', async () => {
    const f = fixture(); const room = { id: 'room-a', outOfServiceLocked: false };
    Object.assign(f.db, { room: { findFirst: jest.fn(async () => ({ ...room })), update: jest.fn(async ({ data }) => Object.assign(room, data)) }, housekeepingTask: { count: jest.fn().mockResolvedValue(0) }, maintenanceTicket: { count: jest.fn().mockResolvedValue(0) } });
    const rooms = new RoomsService(f.db as any, new RoomReadinessService(f.db as any));
    await auditActor.run({ userId: 'user-a', tenantId: 'hotel-a' }, () => rooms.updateReadinessForTenant('hotel-a', room.id, RoomReadinessStatus.OUT_OF_SERVICE));
    expect(f.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ROOM_OUT_OF_SERVICE_LOCKED', actorUserId: 'user-a', resourceId: room.id }) }));
  });
  it('audits operational assignment, status and staff profile changes with the authenticated actor', async () => {
    const f = fixture();
    const profile = { id: 'staff-a', department: 'HOUSEKEEPING', operationalStatus: 'ACTIVE', propertyId: 'property-a', membership: { userId: 'user-a', role: 'HOTEL_STAFF', tenant: { type: 'HOTEL' } } };
    const work = { id: 'work-a', tenantId: 'hotel-a', propertyId: 'property-a', roomId: 'room-a', status: 'PENDING', assignedStaffId: null };
    f.db.operationalStaff.findFirst.mockResolvedValue(profile);
    Object.assign(f.db.operationalStaff, { update: jest.fn(async ({ data }) => ({ ...profile, ...data })) });
    Object.assign(f.db, {
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-a' }), update: jest.fn() },
      housekeepingTask: { findFirst: jest.fn(async () => ({ ...work })), update: jest.fn(async ({ data }) => ({ ...work, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) })), count: jest.fn().mockResolvedValue(0) },
      maintenanceTicket: { count: jest.fn().mockResolvedValue(0) },
    });
    const staff = new StaffService(f.db as any, f.service); const housekeeping = new HousekeepingService(f.db as any, staff, new RoomReadinessService(f.db as any));
    await auditActor.run({ userId: 'user-a', tenantId: 'hotel-a' }, async () => {
      await housekeeping.updateForTenant('hotel-a', 'work-a', { assignedStaffId: 'staff-a' });
      await staff.updateForTenant('hotel-a', 'staff-a', { operationalStatus: 'INACTIVE' });
    });
    const audits = f.db.auditLog.create.mock.calls.map(([query]) => query.data);
    expect(audits.map(entry => entry.action)).toEqual(['HOUSEKEEPING_ASSIGNED', 'HOUSEKEEPING_STATUS_CHANGED', 'STAFF_PROFILE_CHANGED']);
    expect(audits.every(entry => entry.actorUserId === 'user-a' && entry.tenantId === 'hotel-a')).toBe(true); expect(f.rows[0].recipientId).toBe('user-a');
  });
  it('wires the actual Nest modules without introducing parallel audit/notification providers', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).compile();
    expect(module.get(AuditService)).toBeDefined(); expect(module.get(NotificationsService)).toBeDefined(); await module.close();
  });
  it.each(['OWNER', 'ZUITZERO_ADMIN', 'STAFF'])('disconnects realtime platform/legacy role %s', async role => {
    const gateway = new NotificationsGateway({ getWorkspace: jest.fn().mockResolvedValue({ user: { id: 'user-a' }, tenant: { id: 'hotel-a' }, membership: { role } }) } as any, {} as any);
    const socket = { handshake: { headers: { cookie: 'vantara_session=token' } }, join: jest.fn(), disconnect: jest.fn() };
    await gateway.handleConnection(socket as any); expect(socket.join).not.toHaveBeenCalled(); expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
