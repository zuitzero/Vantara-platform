import { ConnectService } from './connect.service';

function fixture() {
  const now = Date.now();
  const reservation = {
    id: 'res-a', tenantId: 'hotel-a', guestId: 'guest-a', propertyId: 'prop-a', roomId: 'room-a',
    confirmationCode: 'VNT-1234', status: 'CONFIRMED', checkIn: new Date(now - 3600000), checkOut: new Date(now + 86400000),
    guest: { id: 'guest-a', firstName: 'Ana', lastName: 'Lopez' },
    property: { id: 'prop-a', name: 'Hotel A' }, roomType: { id: 'type-a', name: 'King' }, room: { id: 'room-a', number: '101' },
  };
  const db:any = {
    reservation: { findFirst: jest.fn().mockResolvedValue(reservation) },
    guestConnectAccess: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    guestRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const requests:any = { createForReservationGuest: jest.fn().mockResolvedValue({ id: 'req-a' }) };
  return { db, requests, reservation, service: new ConnectService(db, requests) };
}

describe('Vantara Connect access boundary', () => {
  it('issues a raw token once but persists only its hash', async () => {
    const { service, db } = fixture();
    const result = await service.issue('hotel-a', 'res-a');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.path).toBe(`/connect/${result.token}`);
    const call = db.guestConnectAccess.upsert.mock.calls[0][0];
    expect(call.create.tokenHash).not.toBe(result.token);
    expect(call.create.reservationId).toBe('res-a');
    expect(call.create.tenantId).toBe('hotel-a');
  });

  it('reads only requests bound to the exact reservation', async () => {
    const { service, db, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a', expiresAt: new Date(Date.now() + 3600000), revokedAt: null,
      reservation,
    });
    await service.stay('a'.repeat(43));
    expect(db.guestRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'hotel-a', reservationId: 'res-a' },
    }));
  });

  it('creates a request from server-owned reservation identity', async () => {
    const { service, db, requests, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a', expiresAt: new Date(Date.now() + 3600000), revokedAt: null,
      reservation,
    });
    await service.createRequest('b'.repeat(43), { title: 'Towels', message: 'Two towels please', category: 'AMENITIES' as any });
    expect(requests.createForReservationGuest).toHaveBeenCalledWith('hotel-a', 'res-a', expect.objectContaining({ title: 'Towels' }));
  });


  it('does not issue a guest link for a reservation outside the hotel tenant', async () => {
    const { service, db } = fixture();
    db.reservation.findFirst.mockResolvedValue(null);
    await expect(service.issue('hotel-b', 'res-a')).rejects.toThrow('Reservation not found');
    expect(db.reservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'res-a', tenantId: 'hotel-b' },
    }));
    expect(db.guestConnectAccess.upsert).not.toHaveBeenCalled();
  });

  it('does not reveal revoked or expired guest access', async () => {
    const { service, db, reservation } = fixture();
    const token = 'c'.repeat(43);
    const access = {
      id: 'access-a', tenantId: 'hotel-a', reservation,
      expiresAt: new Date(Date.now() + 3600000), revokedAt: new Date(),
    };
    db.guestConnectAccess.findUnique.mockResolvedValue(access);
    await expect(service.stay(token)).rejects.toThrow('Connect access not found');
    db.guestConnectAccess.findUnique.mockResolvedValue({
      ...access, revokedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.stay(token)).rejects.toThrow('Connect access not found');
    expect(db.guestRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed public tokens before database lookup', async () => {
    const { service, db } = fixture();
    await expect(service.stay('short')).rejects.toThrow('not found');
    expect(db.guestConnectAccess.findUnique).not.toHaveBeenCalled();
  });
});
