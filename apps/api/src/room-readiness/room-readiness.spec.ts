import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { GuestRequestCategory, HousekeepingStatus, MaintenanceStatus, Prisma, ReservationStatus, RoomReadinessStatus } from '@prisma/client';
import { RoomReadinessService } from './room-readiness.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { StaffService } from '../staff/staff.service';
import { RoomsService } from '../rooms/rooms.service';
import { ReservationsService } from '../reservations/reservations.service';
import { RequestsService } from '../requests/requests.service';
import { UpdateMaintenanceTicketDto } from '../maintenance/maintenance.dto';

function fixture() {
  const room = { id: 'room-a', propertyId: 'property-a', roomTypeId: 'type-a', outOfServiceLocked: false, readinessStatus: 'READY', occupancyStatus: 'OCCUPIED' };
  const guest = { id: 'guest-a', tenantId: 'hotel-a', roomId: room.id, propertyId: room.propertyId };
  const reservation = { id: 'res-a', tenantId: 'hotel-a', propertyId: room.propertyId, roomTypeId: room.roomTypeId, roomId: room.id, guestId: guest.id, room, confirmationCode: 'VNT-A', status: 'CHECKED_IN' };
  const hk: any[] = []; const mt: any[] = [];
  function queue(rows: any[], closed: string[]) {
    return {
      count: jest.fn(async ({ where }) => rows.filter(r => r.tenantId === where.tenantId && r.roomId === where.roomId && r.blocksRoom && !closed.includes(r.status)).length),
      findFirst: jest.fn(async ({ where }) => structuredClone(rows.find(r => r.tenantId === where.tenantId && (!where.id || r.id === where.id) && (!where.roomId || r.roomId === where.roomId) && (!where.blocksRoom || r.blocksRoom) && (!where.status || where.status.in.includes(r.status))) ?? null)),
      create: jest.fn(async ({ data }) => { const row = { id: `work-${rows.length}`, status: closed[0] === 'COMPLETED' ? 'PENDING' : 'OPEN', blocksRoom: true, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }; rows.push(row); return row; }),
      update: jest.fn(async ({ where, data }) => { const row = rows.find(r => r.id === where.id && r.tenantId === where.tenantId); Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))); return row; }),
    };
  }
  const db = {
    auditLog: { create: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({ id: 'notification-a' }) },
    room: { findFirst: jest.fn(async ({ where }) => where.id === room.id && where.property.tenantId === 'hotel-a' ? room : null), update: jest.fn(async ({ data }) => Object.assign(room, data)) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ type: 'HOTEL' }) },
    housekeepingTask: queue(hk, ['COMPLETED', 'CANCELLED']), maintenanceTicket: queue(mt, ['RESOLVED', 'CANCELLED']),
    guest: { findFirst: jest.fn().mockResolvedValue(guest), update: jest.fn() },
    guestRequest: { create: jest.fn(async ({ data }) => ({ id: 'request-a', ...data })) },
    reservation: { findFirst: jest.fn().mockImplementation(async () => reservation), update: jest.fn(async ({ data }) => Object.assign(reservation, data)) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async callback => callback(db));
  const readiness = new RoomReadinessService(db as any); const staff = new StaffService(db as any, new NotificationsService(db as any, { emit: jest.fn() } as any), { assertStaffCapacity: jest.fn().mockResolvedValue(undefined), assertRoomCapacity: jest.fn().mockResolvedValue(undefined) } as any);
  const housekeeping = new HousekeepingService(db as any, staff, readiness);
  const maintenance = new MaintenanceService(db as any, staff, readiness);
  const rooms = new RoomsService(db as any, readiness, { assertStaffCapacity: jest.fn().mockResolvedValue(undefined), assertRoomCapacity: jest.fn().mockResolvedValue(undefined) } as any);
  const add = (rows: any[], status: string, blocksRoom = true, tenantId = 'hotel-a') => { const row = { id: `${rows === hk ? 'hk' : 'mt'}-${rows.length}`, tenantId, roomId: room.id, propertyId: room.propertyId, status, blocksRoom, assignedStaffId: null }; rows.push(row); return row; };
  return { db, room, hk, mt, add, readiness, housekeeping, maintenance, rooms, reservation };
}

describe('Authoritative room readiness', () => {
  it('keeps MAINTENANCE when housekeeping completes with blocking maintenance active', async () => {
    const f = fixture(); const h = f.add(f.hk, 'IN_PROGRESS'); f.add(f.mt, 'OPEN');
    await f.housekeeping.updateForTenant('hotel-a', h.id, { status: HousekeepingStatus.COMPLETED });
    expect(f.room.readinessStatus).toBe('MAINTENANCE'); expect(f.room.occupancyStatus).toBe('OCCUPIED');
  });
  it('keeps CLEANING when maintenance resolves with blocking housekeeping active', async () => {
    const f = fixture(); const m = f.add(f.mt, 'IN_PROGRESS'); f.add(f.hk, 'PENDING');
    await f.maintenance.updateForTenant('hotel-a', m.id, { status: MaintenanceStatus.RESOLVED });
    expect(f.room.readinessStatus).toBe('CLEANING');
  });
  it('returns READY without blocking work, including active non-blocking work', async () => {
    const f = fixture(); f.add(f.mt, 'OPEN', false); f.add(f.hk, 'PENDING', false);
    await f.readiness.recalculate(f.db as any, 'hotel-a', f.room.id);
    expect(f.room.readinessStatus).toBe('READY');
  });
  it('preserves manual OUT_OF_SERVICE after completion and resolution', async () => {
    const f = fixture(); f.room.outOfServiceLocked = true;
    const h = f.add(f.hk, 'IN_PROGRESS'); const m = f.add(f.mt, 'IN_PROGRESS');
    await f.housekeeping.updateForTenant('hotel-a', h.id, { status: HousekeepingStatus.COMPLETED });
    await f.maintenance.updateForTenant('hotel-a', m.id, { status: MaintenanceStatus.RESOLVED });
    expect(f.room.readinessStatus).toBe('OUT_OF_SERVICE');
  });
  it('remains blocked until the final blocking maintenance ticket closes', async () => {
    const f = fixture(); const m = f.add(f.mt, 'OPEN'); const last = f.add(f.mt, 'IN_PROGRESS');
    await f.maintenance.updateForTenant('hotel-a', m.id, { status: MaintenanceStatus.CANCELLED });
    expect(f.room.readinessStatus).toBe('MAINTENANCE');
    await f.maintenance.updateForTenant('hotel-a', last.id, { status: MaintenanceStatus.RESOLVED });
    expect(f.room.readinessStatus).toBe('READY');
  });
  it('recalculates when the blocking flag changes', async () => {
    const f = fixture(); const m = f.add(f.mt, 'OPEN', false);
    await f.maintenance.updateForTenant('hotel-a', m.id, { blocksRoom: true }); expect(f.room.readinessStatus).toBe('MAINTENANCE');
    await f.maintenance.updateForTenant('hotel-a', m.id, { blocksRoom: false }); expect(f.room.readinessStatus).toBe('READY');
  });
  it('creates blocking work by default and honors explicit non-blocking creation', async () => {
    const f = fixture();
    await f.maintenance.createForTenant('hotel-a', { roomId: f.room.id, title: 'Remote', description: 'Replace remote', blocksRoom: false });
    expect(f.room.readinessStatus).toBe('READY');
    await f.housekeeping.createForTenant('hotel-a', { roomId: f.room.id, title: 'Clean room' }); expect(f.room.readinessStatus).toBe('CLEANING');
    await f.maintenance.createForTenant('hotel-a', { roomId: f.room.id, title: 'Leak', description: 'Inspect leak' }); expect(f.room.readinessStatus).toBe('MAINTENANCE');
  });
  it('releasing a manual lock does not bypass active work', async () => {
    const f = fixture(); f.add(f.mt, 'OPEN');
    await f.rooms.updateReadinessForTenant('hotel-a', f.room.id, RoomReadinessStatus.OUT_OF_SERVICE);
    expect(f.room.readinessStatus).toBe('OUT_OF_SERVICE');
    await f.rooms.updateReadinessForTenant('hotel-a', f.room.id, RoomReadinessStatus.READY);
    expect(f.room.readinessStatus).toBe('MAINTENANCE'); expect(f.room.outOfServiceLocked).toBe(false);
  });
  it('rejects direct CLEANING/MAINTENANCE overwrites', async () => {
    const f = fixture();
    await expect(f.rooms.updateReadinessForTenant('hotel-a', f.room.id, RoomReadinessStatus.CLEANING)).rejects.toThrow(BadRequestException);
    await expect(f.rooms.updateReadinessForTenant('hotel-a', f.room.id, RoomReadinessStatus.MAINTENANCE)).rejects.toThrow(BadRequestException);
    expect(f.db.room.update).not.toHaveBeenCalled();
  });
  it('rejects foreign rooms and excludes other tenants from blocker queries', async () => {
    const f = fixture(); f.add(f.mt, 'OPEN', true, 'hotel-b');
    await f.readiness.recalculate(f.db as any, 'hotel-a', f.room.id); expect(f.room.readinessStatus).toBe('READY');
    expect(f.db.maintenanceTicket.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'hotel-a', roomId: f.room.id, blocksRoom: true }) }));
    f.db.room.update.mockClear();
    await expect(f.rooms.updateReadinessForTenant('hotel-b', f.room.id, RoomReadinessStatus.OUT_OF_SERVICE)).rejects.toThrow(NotFoundException);
    expect(f.db.room.update).not.toHaveBeenCalled();
  });
  it.each(['COMPLETED', 'CANCELLED'])('prevents housekeeping reopening or blocking edits from %s', async status => {
    const f = fixture(); const h = f.add(f.hk, status);
    await expect(f.housekeeping.updateForTenant('hotel-a', h.id, { status: HousekeepingStatus.PENDING })).rejects.toThrow('Closed work');
    await expect(f.housekeeping.updateForTenant('hotel-a', h.id, { blocksRoom: false })).rejects.toThrow('Closed work');
  });
  it.each(['RESOLVED', 'CANCELLED'])('prevents maintenance reopening or blocking edits from %s', async status => {
    const f = fixture(); const m = f.add(f.mt, status);
    await expect(f.maintenance.updateForTenant('hotel-a', m.id, { status: MaintenanceStatus.OPEN })).rejects.toThrow('Closed work');
    await expect(f.maintenance.updateForTenant('hotel-a', m.id, { blocksRoom: false })).rejects.toThrow('Closed work');
  });
  it('checkout creates blocking turnover even if only non-blocking housekeeping exists', async () => {
    const f = fixture(); f.add(f.hk, 'PENDING', false);
    await new ReservationsService(f.db as any, f.readiness).updateStatusForTenant('hotel-a', f.reservation.id, ReservationStatus.CHECKED_OUT);
    expect(f.hk).toHaveLength(2); expect(f.hk[1].blocksRoom).toBe(true);
    expect(f.room.readinessStatus).toBe('CLEANING'); expect(f.room.occupancyStatus).toBe('VACANT');
  });
  it('checkout cannot overwrite an administrative lock or active maintenance', async () => {
    const f = fixture(); f.add(f.mt, 'OPEN'); f.room.outOfServiceLocked = true;
    await new ReservationsService(f.db as any, f.readiness).updateStatusForTenant('hotel-a', f.reservation.id, ReservationStatus.CHECKED_OUT);
    expect(f.room.readinessStatus).toBe('OUT_OF_SERVICE'); expect(f.hk[0].blocksRoom).toBe(true);
  });
  it.each([GuestRequestCategory.MAINTENANCE, GuestRequestCategory.HOUSEKEEPING])('keeps new in-stay guest %s requests non-blocking', async category => {
    const f = fixture(); const notifications = { publish: jest.fn() };
    await new RequestsService(f.db as any, notifications as any, f.readiness).createForTenant('hotel-a', 'guest-a', { category, title: 'Room issue', message: 'Please help' });
    expect(f.room.readinessStatus).toBe('READY'); expect(f.room.occupancyStatus).toBe('OCCUPIED');
    expect((category === 'MAINTENANCE' ? f.mt : f.hk)[0].blocksRoom).toBe(false);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('retries the whole transaction and reads concurrent blocking work again', async () => {
    const f = fixture(); const h = f.add(f.hk, 'IN_PROGRESS'); let attempt = 0;
    f.db.$transaction.mockImplementation(async callback => {
      if (++attempt === 1) { await callback(f.db); h.status = 'IN_PROGRESS'; f.add(f.mt, 'OPEN'); throw new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: '6' }); }
      return callback(f.db);
    });
    await f.housekeeping.updateForTenant('hotel-a', h.id, { status: HousekeepingStatus.COMPLETED });
    expect(attempt).toBe(2); expect(f.room.readinessStatus).toBe('MAINTENANCE');
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('retries maintenance resolution against newly committed housekeeping', async () => {
    const f = fixture(); const m = f.add(f.mt, 'IN_PROGRESS'); let attempt = 0;
    f.db.$transaction.mockImplementation(async callback => {
      if (++attempt === 1) { await callback(f.db); m.status = 'IN_PROGRESS'; f.add(f.hk, 'PENDING'); throw new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: '6' }); }
      return callback(f.db);
    });
    await f.maintenance.updateForTenant('hotel-a', m.id, { status: MaintenanceStatus.RESOLVED });
    expect(attempt).toBe(2); expect(f.room.readinessStatus).toBe('CLEANING');
  });
  it('closing the final blocking housekeeping task produces READY', async () => {
    const f = fixture(); const h = f.add(f.hk, 'IN_PROGRESS');
    await f.housekeeping.updateForTenant('hotel-a', h.id, { status: HousekeepingStatus.COMPLETED });
    expect(f.room.readinessStatus).toBe('READY');
  });
  it('rejects cross-tenant blocking edits before room recalculation', async () => {
    const f = fixture(); const m = f.add(f.mt, 'OPEN', true, 'hotel-b');
    await expect(f.maintenance.updateForTenant('hotel-a', m.id, { blocksRoom: false })).rejects.toThrow(NotFoundException);
    expect(f.db.maintenanceTicket.update).not.toHaveBeenCalled(); expect(f.db.room.update).not.toHaveBeenCalled();
  });
  it('checkout keeps MAINTENANCE while still queuing turnover cleaning', async () => {
    const f = fixture(); f.add(f.mt, 'OPEN');
    await new ReservationsService(f.db as any, f.readiness).updateStatusForTenant('hotel-a', f.reservation.id, ReservationStatus.CHECKED_OUT);
    expect(f.room.readinessStatus).toBe('MAINTENANCE'); expect(f.room.occupancyStatus).toBe('VACANT'); expect(f.hk[0].blocksRoom).toBe(true);
  });
  it('bounds serializable retries and reports contention', async () => {
    const f = fixture(); f.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: '6' }));
    await expect(f.rooms.updateReadinessForTenant('hotel-a', f.room.id, RoomReadinessStatus.READY)).rejects.toThrow(ConflictException);
    expect(f.db.$transaction).toHaveBeenCalledTimes(3);
  });
  it.each([null, 'true', 1])('rejects non-boolean blocking input %p', async blocksRoom => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({ blocksRoom }, { type: 'body', metatype: UpdateMaintenanceTicketDto })).rejects.toThrow(BadRequestException);
  });
});
