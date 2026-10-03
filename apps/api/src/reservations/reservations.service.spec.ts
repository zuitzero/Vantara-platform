import { ReservationStatus, RoomStatus } from '@prisma/client';
import { ReservationsService } from './reservations.service';

describe('ReservationsService operational automation', () => {
  const prisma = {
    reservation: { findFirst: jest.fn(), update: jest.fn() },
    room: { update: jest.fn() },
    guest: { update: jest.fn() },
    housekeepingTask: { upsert: jest.fn() },
    $transaction: jest.fn(),
  } as any;

  let service: ReservationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    service = new ReservationsService(prisma);
  });

  it('checks out once and creates one idempotent turnover task', async () => {
    const current = {
      id: 'res-1',
      tenantId: 'hotel-1',
      propertyId: 'property-1',
      guestId: 'guest-1',
      roomId: 'room-101',
      confirmationCode: 'VNT-TEST',
      status: ReservationStatus.CHECKED_IN,
    };
    const updated = { ...current, status: ReservationStatus.CHECKED_OUT, guest: {}, property: {}, roomType: {}, room: {} };

    prisma.reservation.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(updated);
    prisma.reservation.update.mockResolvedValue(updated);
    prisma.room.update.mockResolvedValue({});
    prisma.guest.update.mockResolvedValue({});
    prisma.housekeepingTask.upsert.mockResolvedValue({});

    await expect(
      service.updateStatusForTenant('hotel-1', 'res-1', { status: ReservationStatus.CHECKED_OUT }),
    ).resolves.toEqual(updated);

    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room-101' },
      data: { status: RoomStatus.CLEANING },
    });
    expect(prisma.guest.update).toHaveBeenCalledWith({
      where: { id: 'guest-1' },
      data: { roomId: null },
    });
    expect(prisma.housekeepingTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceReservationId: 'res-1' },
        create: expect.objectContaining({ sourceReservationId: 'res-1', roomId: 'room-101' }),
      }),
    );
  });
});
