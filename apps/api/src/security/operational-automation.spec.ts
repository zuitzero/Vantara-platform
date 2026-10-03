import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { GuestRequestCategory, GuestRequestPriority, ReservationStatus, RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';
import { ReservationsService } from '../reservations/reservations.service';
import { RequestsService } from '../requests/requests.service';

describe('Operational automation', () => {
  it('creates housekeeping work and marks the room vacant + cleaning after check-out', async () => {
    const current = {
      id: 'res-1', tenantId: 'tenant-1', propertyId: 'property-1', guestId: 'guest-1', roomTypeId: 'rt-1',
      roomId: 'room-1', confirmationCode: 'VNT-ABC', status: ReservationStatus.CHECKED_IN,
      room: { id: 'room-1', number: '101' },
    };
    const updated = { ...current, status: ReservationStatus.CHECKED_OUT, guest: {}, property: {}, roomType: {} };

    const tx = {
      reservation: { findFirst: jest.fn().mockResolvedValue(current), update: jest.fn().mockResolvedValue(updated) },
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1', propertyId: 'property-1', roomTypeId: 'rt-1' }), update: jest.fn().mockResolvedValue({}) },
      guest: { findFirst: jest.fn().mockResolvedValue({ id: 'guest-1', tenantId: 'tenant-1' }), update: jest.fn().mockResolvedValue({}) },
      maintenanceTicket: { count: jest.fn().mockResolvedValue(0) },
      housekeepingTask: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'hk-1' }),
      },
    };
    const prisma = {
      reservation: { findFirst: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any;

    const service = new ReservationsService(prisma, new RoomReadinessService(prisma));
    await service.updateStatusForTenant('tenant-1', 'res-1', ReservationStatus.CHECKED_OUT);

    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1', property: { tenantId: 'tenant-1' } },
      data: {
        occupancyStatus: RoomOccupancyStatus.VACANT,
      },
    });
    expect(tx.housekeepingTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-1', propertyId: 'property-1', roomId: 'room-1' }),
    }));
  });

  it('routes a maintenance guest request into the maintenance queue', async () => {
    const guest = { id: 'guest-1', tenantId: 'tenant-1', propertyId: 'property-1', roomId: 'room-1', property: {}, room: {} };
    const createdRequest = {
      id: 'request-1', tenantId: 'tenant-1', propertyId: 'property-1', guestId: 'guest-1', roomId: 'room-1',
      title: 'AC not cooling', message: 'Room is too warm', category: GuestRequestCategory.MAINTENANCE,
      priority: GuestRequestPriority.HIGH, status: 'CREATED', guest: {}, property: {}, room: {},
    };
    const tx = {
      guest: { findFirst: jest.fn().mockResolvedValue(guest) },
      guestRequest: { create: jest.fn().mockResolvedValue(createdRequest) },
      room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }), update: jest.fn() },
      housekeepingTask: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      maintenanceTicket: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'mt-1' }) },
    };
    const prisma = {
      guest: { findFirst: jest.fn().mockResolvedValue(guest) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any;
    const notifications = { publish: jest.fn().mockResolvedValue(undefined) } as any;

    const service = new RequestsService(prisma, notifications, new RoomReadinessService(prisma));
    await service.createForTenant('tenant-1', 'guest-1', {
      title: 'AC not cooling',
      message: 'Room is too warm',
      category: GuestRequestCategory.MAINTENANCE,
      priority: GuestRequestPriority.HIGH,
    });

    expect(tx.maintenanceTicket.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-1', propertyId: 'property-1', roomId: 'room-1', title: 'AC not cooling' }),
    }));
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
  });
});

