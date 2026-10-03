import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, ConflictException, ExecutionContext, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, Prisma, ReservationStatus, TenantType } from '@prisma/client';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CreateGuestDto } from '../guests/guests.dto';
import { GuestsService } from '../guests/guests.service';
import { RbacService } from '../rbac/rbac.service';
import { AssignReservationRoomDto, CreateReservationDto } from './reservations.dto';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

function fixture(status: ReservationStatus = ReservationStatus.CONFIRMED) {
  const current = { id: 'reservation-a', tenantId: 'hotel-a', guestId: 'guest-a', propertyId: 'property-a', roomTypeId: 'type-a', roomId: 'room-a', status, confirmationCode: 'VNT-TEST', checkIn: new Date('2026-10-10'), checkOut: new Date('2026-10-12'), room: { number: '101' } };
  const tx = {
    reservation: {
      findFirst: jest.fn().mockImplementation(async query => typeof query.where.id === 'string' ? current : null),
      update: jest.fn().mockResolvedValue(current),
      create: jest.fn().mockImplementation(async query => ({ id: current.id, ...query.data })),
    },
    room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-a', propertyId: 'property-a', roomTypeId: 'type-a' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    guest: { findFirst: jest.fn().mockResolvedValue({ id: 'guest-a' }), update: jest.fn().mockResolvedValue({}) },
    maintenanceTicket: { count: jest.fn().mockResolvedValue(0) },
    housekeepingTask: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'property-a' }) },
    roomType: { findFirst: jest.fn().mockResolvedValue({ id: 'type-a' }) },
    $transaction: jest.fn(async callback => callback(tx)),
  };
  return { current, tx, prisma, service: new ReservationsService(prisma as any, new RoomReadinessService(prisma as any)) };
}

describe('Front Desk reservation assignment and safe lifecycle', () => {
  it('assigns a matching room with overlap exclusion inside a serializable transaction', async () => {
    const { service, tx, prisma, current } = fixture();
    await service.assignRoomForTenant('hotel-a', current.id, 'room-a');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(tx.room.findFirst).toHaveBeenCalledWith({ where: { id: 'room-a', property: { tenantId: 'hotel-a' } } });
    expect(tx.reservation.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'hotel-a', roomId: 'room-a', id: { not: current.id }, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }, checkIn: { lt: current.checkOut }, checkOut: { gt: current.checkIn } },
    });
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: current.id, tenantId: 'hotel-a' }, data: { roomId: 'room-a' } });
  });

  it('rejects cross-tenant reservation assignment before writes', async () => {
    const { service, tx } = fixture();
    tx.reservation.findFirst.mockResolvedValue(null);
    await expect(service.assignRoomForTenant('hotel-a', 'foreign', 'room-a')).rejects.toThrow(NotFoundException);
    expect(tx.reservation.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'hotel-a' } });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant room assignment before writes', async () => {
    const { service, tx, current } = fixture();
    tx.room.findFirst.mockResolvedValue(null);
    await expect(service.assignRoomForTenant('hotel-a', current.id, 'foreign-room')).rejects.toThrow('active hotel');
    expect(tx.room.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-room', property: { tenantId: 'hotel-a' } } });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it.each([{ propertyId: 'other-property', roomTypeId: 'type-a' }, { propertyId: 'property-a', roomTypeId: 'other-type' }])('rejects incompatible room %j', async room => {
    const { service, tx, current } = fixture();
    tx.room.findFirst.mockResolvedValue(room as any);
    await expect(service.assignRoomForTenant('hotel-a', current.id, 'room-a')).rejects.toThrow('property and room type');
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('rejects overlapping reassignment', async () => {
    const { service, tx, current } = fixture();
    tx.reservation.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce({ id: 'conflict' } as any);
    await expect(service.assignRoomForTenant('hotel-a', current.id, 'room-a')).rejects.toThrow('already reserved');
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it.each([ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT, ReservationStatus.CANCELED, ReservationStatus.NO_SHOW])('rejects reassignment from %s', async status => {
    const { service, tx, current } = fixture(status);
    await expect(service.assignRoomForTenant('hotel-a', current.id, 'room-a')).rejects.toThrow('before check-in');
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('claims only a VACANT + READY tenant-owned room during check-in', async () => {
    const { service, tx, current } = fixture();
    await service.updateStatusForTenant('hotel-a', current.id, ReservationStatus.CHECKED_IN);
    expect(tx.room.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-a', property: { tenantId: 'hotel-a' }, occupancyStatus: 'VACANT', readinessStatus: 'READY' },
      data: { occupancyStatus: 'OCCUPIED' },
    });
    expect(tx.guest.update).toHaveBeenCalledWith({ where: { id: 'guest-a', tenantId: 'hotel-a' }, data: { roomId: 'room-a', propertyId: 'property-a' } });
  });

  it.each(['OCCUPIED', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE'])('rejects check-in when conditional claim fails (%s)', async state => {
    const { service, tx, current } = fixture();
    const actual = { occupancyStatus: state === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT', readinessStatus: state === 'OCCUPIED' ? 'READY' : state };
    tx.room.updateMany.mockImplementation(async query => ({ count: actual.occupancyStatus === query.where.occupancyStatus && actual.readinessStatus === query.where.readinessStatus ? 1 : 0 }));
    await expect(service.updateStatusForTenant('hotel-a', current.id, ReservationStatus.CHECKED_IN)).rejects.toThrow('VACANT and READY');
    expect(tx.guest.update).not.toHaveBeenCalled();
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
  });

  it('cannot mutate a foreign room during check-in even if the reservation references it', async () => {
    const { service, tx, current } = fixture();
    tx.room.findFirst.mockResolvedValue(null);
    await expect(service.updateStatusForTenant('hotel-a', current.id, ReservationStatus.CHECKED_IN)).rejects.toThrow('active hotel');
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.room.updateMany).not.toHaveBeenCalled();
    expect(tx.guest.update).not.toHaveBeenCalled();
  });

  it('rejects a foreign guest linked to a check-in', async () => {
    const { service, tx, current } = fixture();
    tx.guest.findFirst.mockResolvedValue(null);
    await expect(service.updateStatusForTenant('hotel-a', current.id, ReservationStatus.CHECKED_IN)).rejects.toThrow('Guest does not belong');
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.room.updateMany).not.toHaveBeenCalled();
  });

  it('preserves creation overlap checks and server-generated codes', async () => {
    const { service, tx, current } = fixture();
    const input = { guestId: 'guest-a', propertyId: 'property-a', roomTypeId: 'type-a', roomId: 'room-a', checkIn: current.checkIn, checkOut: current.checkOut };
    const created = await service.createForTenant('hotel-a', input);
    expect(created.confirmationCode).toMatch(/^VNT-[A-F0-9]{8}$/);
    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'hotel-a', adults: 1, children: 0 }) }));
    tx.reservation.findFirst.mockResolvedValue({ id: 'overlap' } as any);
    tx.reservation.create.mockClear();
    await expect(service.createForTenant('hotel-a', input)).rejects.toThrow('already reserved');
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it('retains one housekeeping task when checking out an already queued room', async () => {
    const { service, tx, current } = fixture(ReservationStatus.CHECKED_IN);
    tx.housekeepingTask.findFirst.mockResolvedValue({ id: 'existing-task' } as any);
    await service.updateStatusForTenant('hotel-a', current.id, ReservationStatus.CHECKED_OUT);
    expect(tx.room.update).toHaveBeenCalledWith({ where: { id: 'room-a', property: { tenantId: 'hotel-a' } }, data: { occupancyStatus: 'VACANT' } });
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
    expect(tx.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: { readinessStatus: 'CLEANING' } }));
  });

  it('retries serialization conflicts and returns a useful error when contention persists', async () => {
    const { service, prisma, current } = fixture();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6' }));
    await expect(service.assignRoomForTenant('hotel-a', current.id, 'room-a')).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe('Front Desk authorization and input ownership', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it.each([CreateGuestDto, CreateReservationDto, AssignReservationRoomDto])('rejects client-provided tenant ownership in %p', async metatype => {
    const payload = metatype === CreateGuestDto ? { firstName: 'Test', lastName: 'Guest' } : metatype === AssignReservationRoomDto ? { roomId: 'room-a' } : { guestId: 'guest-a', propertyId: 'property-a', roomTypeId: 'type-a', checkIn: '2026-10-10', checkOut: '2026-10-12' };
    try {
      await pipe.transform({ ...payload, tenantId: 'foreign' }, { type: 'body', metatype } as any);
      throw new Error('Unexpected acceptance of client tenant ownership');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(expect.objectContaining({ message: expect.arrayContaining(['property tenantId should not exist']) }));
    }
  });
  it('validates dates and guest counts server-side', async () => {
    await expect(pipe.transform({ guestId: 'guest-a', propertyId: 'property-a', roomTypeId: 'type-a', checkIn: 'invalid', checkOut: '2026-10-12', adults: 0, children: -1 }, { type: 'body', metatype: CreateReservationDto })).rejects.toThrow(BadRequestException);
    const { service, current } = fixture();
    await expect(service.createForTenant('hotel-a', { guestId: 'guest-a', propertyId: 'property-a', roomTypeId: 'type-a', checkIn: current.checkOut, checkOut: current.checkIn })).rejects.toThrow('after check-in');
  });
  it('creates a guest with authenticated tenant ownership and optional contacts', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'guest-a' });
    const service = new GuestsService({ guest: { create }, property: { findFirst: jest.fn().mockResolvedValue({ id: 'property-a' }) } } as any);
    await service.createForTenant('hotel-a', { firstName: ' Test ', lastName: ' Guest ', email: 'TEST@example.com', phone: '5551234', propertyId: 'property-a' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'hotel-a', firstName: 'Test', lastName: 'Guest', email: 'test@example.com', phone: '5551234', propertyId: 'property-a' }) }));
  });
  it('rejects whitespace-only guest names', async () => {
    await expect(new GuestsService({} as any).createForTenant('hotel-a', { firstName: ' ', lastName: 'Guest' })).rejects.toThrow('First and last name');
  });
  it.each([MembershipRole.HOTEL_ADMIN, MembershipRole.HOTEL_STAFF])('enforces assignment permission for %s and derives tenant from authentication', async role => {
    const request = { auth: { user: { id: 'user-a' }, tenant: { id: 'hotel-a' }, membership: { id: 'member-a', role } }, body: { tenantId: 'hotel-b' }, tenantContext: { tenantId: 'hotel-b' } };
    const context = { getHandler: () => ReservationsController.prototype.assignRoom, getClass: () => ReservationsController, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    new TenantContextGuard().canActivate(context);
    const rbac = new RbacService({ membership: { findUnique: jest.fn().mockResolvedValue({ role, tenant: { type: TenantType.HOTEL } }) } } as any);
    const guard = new PermissionsGuard(new Reflector(), rbac, { record: jest.fn() } as any);
    if (role === MembershipRole.HOTEL_STAFF) {
      await expect(guard.canActivate(context)).rejects.toThrow('permission');
    } else {
      await expect(guard.canActivate(context)).resolves.toBe(true);
      const assignRoomForTenant = jest.fn();
      new ReservationsController({ assignRoomForTenant } as any).assignRoom(request as any, 'reservation-a', { roomId: 'room-a' });
      expect(assignRoomForTenant).toHaveBeenCalledWith('hotel-a', 'reservation-a', 'room-a');
    }
  });
});
