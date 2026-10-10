import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PlanCode, Prisma, SubscriptionStatus, TenantType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const TRIAL_DAYS = 14;
export const PLAN_LIMITS: Record<PlanCode, { rooms: number; staff: number }> = {
  LOBBY: { rooms: 40, staff: 10 },
  SUITE: { rooms: 150, staff: 40 },
  GRAND: { rooms: 500, staff: 150 },
};

type Db = Pick<Prisma.TransactionClient, 'subscription' | 'room' | 'operationalStaff' | 'tenant'>;

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async subscription(db: Db, tenantId: string) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { type: true } });
    if (tenant?.type !== TenantType.HOTEL) throw new ForbiddenException('Entitlements require a HOTEL tenant.');
    const subscription = await db.subscription.findUnique({ where: { tenantId } });
    if (!subscription) throw new NotFoundException('Hotel subscription not found.');
    return subscription;
  }

  private policy(subscription: { plan: PlanCode; status: SubscriptionStatus; trialEndsAt: Date }) {
    const now = new Date();
    const trialActive = subscription.status === SubscriptionStatus.TRIALING && subscription.trialEndsAt.getTime() > now.getTime();
    const paidActive = subscription.status === SubscriptionStatus.ACTIVE;
    const effectivePlan = trialActive ? PlanCode.GRAND : paidActive ? subscription.plan : null;
    return {
      trialActive,
      paidActive,
      effectivePlan,
      accessMode: effectivePlan ? 'FULL' as const : 'READ_ONLY' as const,
      limits: effectivePlan ? PLAN_LIMITS[effectivePlan] : { rooms: 0, staff: 0 },
    };
  }

  async summary(tenantId: string) {
    const subscription = await this.subscription(this.prisma, tenantId);
    const policy = this.policy(subscription);
    const [rooms, staff] = await Promise.all([
      this.prisma.room.count({ where: { property: { tenantId } } }),
      this.prisma.operationalStaff.count({ where: { tenantId } }),
    ]);
    return {
      plan: subscription.plan,
      status: subscription.status,
      trialStartedAt: subscription.trialStartedAt,
      trialEndsAt: subscription.trialEndsAt,
      trialActive: policy.trialActive,
      effectivePlan: policy.effectivePlan,
      accessMode: policy.accessMode,
      limits: policy.limits,
      usage: { rooms, staff },
    };
  }

  async assertRoomCapacity(db: Db, tenantId: string) {
    const subscription = await this.subscription(db, tenantId);
    const policy = this.policy(subscription);
    if (!policy.effectivePlan) throw new HttpException('Paid subscription required to add rooms after the trial ends.', HttpStatus.PAYMENT_REQUIRED);
    const count = await db.room.count({ where: { property: { tenantId } } });
    if (count >= policy.limits.rooms) throw new ForbiddenException(`Room limit reached for ${policy.effectivePlan}. Upgrade your plan to add more rooms.`);
  }

  async assertStaffCapacity(db: Db, tenantId: string) {
    const subscription = await this.subscription(db, tenantId);
    const policy = this.policy(subscription);
    if (!policy.effectivePlan) throw new HttpException('Paid subscription required to add staff after the trial ends.', HttpStatus.PAYMENT_REQUIRED);
    const count = await db.operationalStaff.count({ where: { tenantId } });
    if (count >= policy.limits.staff) throw new ForbiddenException(`Staff limit reached for ${policy.effectivePlan}. Upgrade your plan to add more staff.`);
  }
}
