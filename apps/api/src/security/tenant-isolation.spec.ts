import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GuestsService } from '../guests/guests.service';
import { PropertiesService } from '../properties/properties.service';
import { ReservationsService } from '../reservations/reservations.service';
import { RequestsService } from '../requests/requests.service';

describe('Tenant isolation boundaries', () => {
  const prisma = {
    guest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    property: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    room: {
      findFirst: jest.fn(),
    },
    roomType: {
      findFirst: jest.fn(),
    },
    reservation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    guestRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const notifications = { publish: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes guest listing to the active tenant', async () => {
    prisma.guest.findMany.mockResolvedValue([]);

    await new GuestsService(prisma).listForTenant('hotel-a');

    expect(prisma.guest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'hotel-a' } }),
    );
  });

  it('scopes property listing to the active tenant', async () => {
    prisma.property.findMany.mockResolvedValue([]);

    await new PropertiesService(prisma).listForTenant('hotel-a');

    expect(prisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'hotel-a' } }),
    );
  });

  it('scopes reservation listing to the active tenant', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);

    await new ReservationsService(prisma).listForTenant('hotel-a');

    expect(prisma.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'hotel-a' } }),
    );
  });

  it('scopes request listing to the active tenant', async () => {
    prisma.guestRequest.findMany.mockResolvedValue([]);

    await new RequestsService(prisma, notifications).listForTenant('hotel-a');

    expect(prisma.guestRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'hotel-a' } }),
    );
  });

  it('rejects a guest lookup from another tenant', async () => {
    prisma.guest.findFirst.mockResolvedValue(null);

    await expect(new GuestsService(prisma).getForTenant('hotel-a', 'guest-from-hotel-b'))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.guest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'guest-from-hotel-b', tenantId: 'hotel-a' } }),
    );
  });

  it('rejects a reservation lookup from another tenant', async () => {
    prisma.reservation.findFirst.mockResolvedValue(null);

    await expect(
      new ReservationsService(prisma).getForTenant('hotel-a', 'reservation-from-hotel-b'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reservation-from-hotel-b', tenantId: 'hotel-a' },
      }),
    );
  });

  it('rejects a request lookup from another tenant', async () => {
    prisma.guestRequest.findFirst.mockResolvedValue(null);

    await expect(
      new RequestsService(prisma, notifications).getForTenant('hotel-a', 'request-from-hotel-b'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.guestRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-from-hotel-b', tenantId: 'hotel-a' },
      }),
    );
  });

  it('rejects creating a reservation for a guest from another tenant', async () => {
    prisma.guest.findFirst.mockResolvedValue(null);

    await expect(
      new ReservationsService(prisma).createForTenant('hotel-a', {
        guestId: 'guest-from-hotel-b',
        propertyId: 'property-a',
        roomTypeId: 'room-type-a',
        checkIn: new Date('2026-10-10'),
        checkOut: new Date('2026-10-12'),
        totalAmount: '1000',
        currency: 'MXN',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.guest.findFirst).toHaveBeenCalledWith({
      where: { id: 'guest-from-hotel-b', tenantId: 'hotel-a' },
    });
  });

  it('rejects creating a guest with a room from another tenant', async () => {
    prisma.room.findFirst.mockResolvedValue(null);

    await expect(
      new GuestsService(prisma).createForTenant('hotel-a', {
        firstName: 'Guest',
        lastName: 'Test',
        roomId: 'room-from-hotel-b',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.room.findFirst).toHaveBeenCalledWith({
      where: { id: 'room-from-hotel-b', property: { tenantId: 'hotel-a' } },
    });
  });
});
