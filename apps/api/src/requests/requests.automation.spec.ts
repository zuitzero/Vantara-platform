import { GuestRequestCategory, GuestRequestPriority, RoomStatus } from '@prisma/client';
import { RequestsService } from './requests.service';

describe('RequestsService operational automation', () => {
  const prisma = {
    guest: { findFirst: jest.fn() },
    guestRequest: { create: jest.fn() },
    housekeepingTask: { upsert: jest.fn() },
    maintenanceTicket: { upsert: jest.fn() },
    room: { update: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const notifications = { publish: jest.fn() } as any;

  let service: RequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockResolvedValue([]);
    notifications.publish.mockResolvedValue(undefined);
    service = new RequestsService(prisma, notifications);
    prisma.guest.findFirst.mockResolvedValue({
      id: 'guest-1',
      propertyId: 'property-1',
      roomId: 'room-101',
      property: {},
      room: {},
    });
  });

  it('creates idempotent housekeeping work from a housekeeping request', async () => {
    const request = {
      id: 'request-1',
      tenantId: 'hotel-1',
      propertyId: 'property-1',
      guestId: 'guest-1',
      roomId: 'room-101',
      title: 'Fresh towels',
      message: 'Please refresh the room.',
      category: GuestRequestCategory.HOUSEKEEPING,
      priority: GuestRequestPriority.HIGH,
      guest: {},
      property: {},
      room: {},
    };
    prisma.guestRequest.create.mockResolvedValue(request);
    prisma.housekeepingTask.upsert.mockResolvedValue({});
    prisma.room.update.mockResolvedValue({});

    await service.createForTenant('hotel-1', 'guest-1', {
      title: request.title,
      message: request.message,
      category: GuestRequestCategory.HOUSEKEEPING,
      priority: GuestRequestPriority.HIGH,
    });

    expect(prisma.housekeepingTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceGuestRequestId: 'request-1' },
        create: expect.objectContaining({ sourceGuestRequestId: 'request-1', roomId: 'room-101' }),
      }),
    );
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room-101' },
      data: { status: RoomStatus.CLEANING },
    });
  });

  it('creates idempotent maintenance work from a maintenance request', async () => {
    const request = {
      id: 'request-2',
      tenantId: 'hotel-1',
      propertyId: 'property-1',
      guestId: 'guest-1',
      roomId: 'room-101',
      title: 'AC issue',
      message: 'Air conditioning is not cooling.',
      category: GuestRequestCategory.MAINTENANCE,
      priority: GuestRequestPriority.URGENT,
      guest: {},
      property: {},
      room: {},
    };
    prisma.guestRequest.create.mockResolvedValue(request);
    prisma.maintenanceTicket.upsert.mockResolvedValue({});
    prisma.room.update.mockResolvedValue({});

    await service.createForTenant('hotel-1', 'guest-1', {
      title: request.title,
      message: request.message,
      category: GuestRequestCategory.MAINTENANCE,
      priority: GuestRequestPriority.URGENT,
    });

    expect(prisma.maintenanceTicket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceGuestRequestId: 'request-2' },
        create: expect.objectContaining({ sourceGuestRequestId: 'request-2', roomId: 'room-101' }),
      }),
    );
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room-101' },
      data: { status: RoomStatus.MAINTENANCE },
    });
  });
});
