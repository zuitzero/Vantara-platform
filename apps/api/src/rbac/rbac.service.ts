import { ForbiddenException, Injectable } from '@nestjs/common';
import { MembershipRole, TenantType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasPermission, Permission } from './rbac.types';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  assertPermission(role: MembershipRole, permission: Permission): void {
    if (!hasPermission(role, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  async assertTenantAccess(
    userId: string,
    tenantId: string,
    permission: Permission,
  ): Promise<{ role: MembershipRole; tenantType: TenantType }> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true, tenant: { select: { type: true } } },
    });

    if (!membership) {
      throw new ForbiddenException('Tenant access denied.');
    }

    this.assertPermission(membership.role, permission);
    return { role: membership.role, tenantType: membership.tenant.type };
  }

  async assertBillingWrite(userId: string, tenantId: string): Promise<void> {
    const platformOwner = await this.prisma.membership.findFirst({
      where: {
        userId,
        role: MembershipRole.OWNER,
        tenant: { type: TenantType.PLATFORM },
      },
      select: { id: true },
    });

    if (platformOwner) return;

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true },
    });

    if (membership?.role !== MembershipRole.OWNER) {
      throw new ForbiddenException('Billing changes require OWNER authorization.');
    }
  }
}
