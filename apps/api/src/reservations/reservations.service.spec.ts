import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MembershipRole, ReservationStatus } from '@prisma/client';
import { hasPermission } from '../rbac/rbac.types';
import { ReservationsService } from './reservations.service';

describe('Command Center reservation lifecycle contract', () => {
  it('allows hotel staff to read and reserves mutations for hotel admins', () => {
    expect(hasPermission(MembershipRole.HOTEL_STAFF, 'reservations.read')).toBe(true);
    expect(hasPermission(MembershipRole.HOTEL_STAFF, 'reservations.manage')).toBe(false);
    expect(hasPermission(MembershipRole.HOTEL_ADMIN, 'reservations.manage')).toBe(true);
  });

  it('rejects cross-tenant status mutations before operational side effects', async () => {
    const prisma = { reservation: { findFirst: jest.fn().mockResolvedValue(null) }, $transaction: jest.fn() };
    await expect(new ReservationsService(prisma as any).updateStatusForTenant('hotel-a', 'foreign', ReservationStatus.CONFIRMED)).rejects.toThrow(NotFoundException);
    expect(prisma.reservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', tenantId: 'hotel-a' } }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([ReservationStatus.CHECKED_OUT, ReservationStatus.CANCELED, ReservationStatus.NO_SHOW])('rejects transitions from terminal state %s', async status => {
    const prisma = { reservation: { findFirst: jest.fn().mockResolvedValue({ id: 'res', status }) }, $transaction: jest.fn() };
    await expect(new ReservationsService(prisma as any).updateStatusForTenant('hotel-a', 'res', ReservationStatus.CHECKED_IN)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a room before check-in', async () => {
    const prisma = { reservation: { findFirst: jest.fn().mockResolvedValue({ id: 'res', status: ReservationStatus.CONFIRMED, roomId: null }) }, $transaction: jest.fn() };
    await expect(new ReservationsService(prisma as any).updateStatusForTenant('hotel-a', 'res', ReservationStatus.CHECKED_IN)).rejects.toThrow('A room must be assigned');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
