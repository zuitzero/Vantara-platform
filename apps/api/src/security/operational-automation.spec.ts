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
      reservation: { update: jest.fn().mockResolvedValue(updated) },
      room: { update: jest.fn().mockResolvedValue({}) },
      guest: { update: jest.fn().mockResolvedValue({}) },
      housekeepingTask: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'hk-1' }),
      },
    };
    const prisma = {
      reservation: { findFirst: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any;

    const service = new ReservationsService(prisma);
    await service.updateStatusForTenant('tenant-1', 'res-1', ReservationStatus.CHECKED_OUT);

    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: {
        occupancyStatus: RoomOccupancyStatus.VACANT,
        readinessStatus: RoomReadinessStatus.CLEANING,
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
      guestRequest: { create: jest.fn().mockResolvedValue(createdRequest) },
      housekeepingTask: { create: jest.fn() },
      maintenanceTicket: { create: jest.fn().mockResolvedValue({ id: 'mt-1' }) },
    };
    const prisma = {
      guest: { findFirst: jest.fn().mockResolvedValue(guest) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any;
    const notifications = { publish: jest.fn().mockResolvedValue(undefined) } as any;

    const service = new RequestsService(prisma, notifications);
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
