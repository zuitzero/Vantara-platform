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
  it('rotating an access link replaces the stored token hash', async () => {
    const { service, db } = fixture();
    const first = await service.issue('hotel-a', 'res-a');
    const second = await service.issue('hotel-a', 'res-a');
    expect(first.token).not.toBe(second.token);
    const firstHash = db.guestConnectAccess.upsert.mock.calls[0][0].create.tokenHash;
    const secondWrite = db.guestConnectAccess.upsert.mock.calls[1][0];
    expect(secondWrite.update.tokenHash).not.toBe(firstHash);
    expect(secondWrite.update.revokedAt).toBeNull();
    expect(secondWrite.update.lastUsedAt).toBeNull();
  });

  it('rejects creating requests with revoked access', async () => {
    const { service, db, requests, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a', reservation,
      expiresAt: new Date(Date.now() + 3600000), revokedAt: new Date(),
    });
    await expect(service.createRequest('d'.repeat(43), {
      title: 'Extra towels', message: 'Please bring towels', category: 'HOUSEKEEPING' as any,
    })).rejects.toThrow('Connect access not found');
    expect(requests.createForReservationGuest).not.toHaveBeenCalled();
  });

  it('disables new requests once checkout passes even if the link still exists', async () => {
    const { service, db, requests, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a',
      reservation: { ...reservation, checkOut: new Date(Date.now() - 1000) },
      expiresAt: new Date(Date.now() + 3600000), revokedAt: null,
    });
    const token = 'e'.repeat(43);
    const stay = await service.stay(token);
    expect(stay.canRequest).toBe(false);
    await expect(service.createRequest(token, {
      title: 'Extra towels', message: 'Please bring towels', category: 'HOUSEKEEPING' as any,
    })).rejects.toThrow('This stay can no longer create requests');
    expect(requests.createForReservationGuest).not.toHaveBeenCalled();
  });

  it('allows revocation only for access owned by the specified hotel', async () => {
    const { service, db } = fixture();
    db.guestConnectAccess.findFirst.mockResolvedValue(null);
    await expect(service.revoke('hotel-b', 'res-a')).rejects.toThrow('Connect access not found');
    expect(db.guestConnectAccess.findFirst).toHaveBeenCalledWith({
      where: { reservationId: 'res-a', tenantId: 'hotel-b' },
    });
    expect(db.guestConnectAccess.update).not.toHaveBeenCalled();
  });

  it('round-trips a reservation-scoped request from guest submission to guest stay status', async () => {
    const { service, db, requests, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a', reservation, revokedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const token = 'f'.repeat(43);
    const input = { title: 'Extra towels', message: 'Please bring two towels', category: 'HOUSEKEEPING' as any };
    await service.createRequest(token, input);
    expect(requests.createForReservationGuest).toHaveBeenCalledWith(
      'hotel-a', 'res-a', expect.objectContaining(input),
    );
    db.guestRequest.findMany.mockResolvedValue([
      { id: 'req-a', ...input, status: 'IN_PROGRESS', completedAt: null },
    ]);
    const inProgress = await service.stay(token);
    expect(inProgress.requests).toEqual([expect.objectContaining({ id: 'req-a', status: 'IN_PROGRESS' })]);
    db.guestRequest.findMany.mockResolvedValue([
      { id: 'req-a', ...input, status: 'COMPLETED', completedAt: new Date() },
    ]);
    const completed = await service.stay(token);
    expect(completed.requests).toEqual([expect.objectContaining({ id: 'req-a', status: 'COMPLETED' })]);
    for (const call of db.guestRequest.findMany.mock.calls) {
      expect(call[0].where).toEqual({ tenantId: 'hotel-a', reservationId: 'res-a' });
    }
  });

  it('never returns requests belonging to another reservation in the stay query', async () => {
    const { service, db, reservation } = fixture();
    db.guestConnectAccess.findUnique.mockResolvedValue({
      id: 'access-a', tenantId: 'hotel-a', reservation, revokedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
    });
    await service.stay('g'.repeat(43));
    const query = db.guestRequest.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ tenantId: 'hotel-a', reservationId: 'res-a' });
    expect(query.take).toBeLessThanOrEqual(50);
  });

});
