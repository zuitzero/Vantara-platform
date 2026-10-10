import { HttpException, ForbiddenException } from '@nestjs/common';
import { PlanCode, SubscriptionStatus, TenantType } from '@prisma/client';
import { EntitlementsService, PLAN_LIMITS } from './entitlements.service';

function dbFixture(overrides: Record<string, unknown> = {}) {
  const subscription = {
    id: 'sub-local',
    tenantId: 'hotel-a',
    plan: PlanCode.LOBBY,
    status: SubscriptionStatus.TRIALING,
    trialStartedAt: new Date(Date.now() - 60_000),
    trialEndsAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
  return {
    tenant: { findUnique: jest.fn().mockResolvedValue({ type: TenantType.HOTEL }) },
    subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
    room: { count: jest.fn().mockResolvedValue(0) },
    operationalStaff: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('Entitlements and trial policy', () => {
  it('grants GRAND capacity during an active trial', async () => {
    const db = dbFixture();
    const service = new EntitlementsService(db as any);
    const state = await service.summary('hotel-a');
    expect(state).toMatchObject({
      plan: 'LOBBY',
      status: 'TRIALING',
      trialActive: true,
      effectivePlan: 'GRAND',
      accessMode: 'FULL',
      limits: PLAN_LIMITS.GRAND,
    });
  });

  it('uses paid plan limits after activation', async () => {
    const db = dbFixture({ plan: PlanCode.SUITE, status: SubscriptionStatus.ACTIVE });
    const service = new EntitlementsService(db as any);
    const state = await service.summary('hotel-a');
    expect(state).toMatchObject({ effectivePlan: 'SUITE', accessMode: 'FULL', limits: PLAN_LIMITS.SUITE });
  });

  it('turns an expired unpaid trial into read-only state', async () => {
    const db = dbFixture({ trialEndsAt: new Date(Date.now() - 60_000) });
    const service = new EntitlementsService(db as any);
    const state = await service.summary('hotel-a');
    expect(state).toMatchObject({ trialActive: false, effectivePlan: null, accessMode: 'READ_ONLY', limits: { rooms: 0, staff: 0 } });
    await expect(service.assertRoomCapacity(db as any, 'hotel-a')).rejects.toBeInstanceOf(HttpException);
    await expect(service.assertStaffCapacity(db as any, 'hotel-a')).rejects.toBeInstanceOf(HttpException);
  });

  it('enforces paid room and staff capacity', async () => {
    const db = dbFixture({ plan: PlanCode.LOBBY, status: SubscriptionStatus.ACTIVE });
    db.room.count.mockResolvedValue(PLAN_LIMITS.LOBBY.rooms);
    db.operationalStaff.count.mockResolvedValue(PLAN_LIMITS.LOBBY.staff);
    const service = new EntitlementsService(db as any);
    await expect(service.assertRoomCapacity(db as any, 'hotel-a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertStaffCapacity(db as any, 'hotel-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects platform tenants', async () => {
    const db = dbFixture();
    db.tenant.findUnique.mockResolvedValue({ type: TenantType.PLATFORM });
    const service = new EntitlementsService(db as any);
    await expect(service.summary('platform')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
