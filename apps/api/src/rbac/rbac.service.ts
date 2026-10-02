import { ForbiddenException, Injectable } from '@nestjs/common';
import { MembershipRole, TenantType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasPermission, Permission } from './rbac.types';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  hasPermission(role: MembershipRole, permission: Permission): boolean {
    return hasPermission(role, permission);
  }

  assertPermission(role: MembershipRole, permission: Permission): void {
    if (!hasPermission(role, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  async getTenantAccess(userId: string, tenantId: string): Promise<{ role: MembershipRole; tenantType: TenantType } | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true, tenant: { select: { type: true } } },
    });

    if (!membership) return null;

    if (membership.role === MembershipRole.OWNER && membership.tenant.type !== TenantType.PLATFORM) {
      return null;
    }

    if (
      [MembershipRole.ZUITZERO_ADMIN, MembershipRole.OWNER].includes(membership.role) &&
      membership.tenant.type !== TenantType.PLATFORM
    ) {
      return null;
    }

    if (
      [MembershipRole.GUEST, MembershipRole.HOTEL_STAFF, MembershipRole.HOTEL_ADMIN].includes(membership.role) &&
      membership.tenant.type !== TenantType.HOTEL
    ) {
      return null;
    }

    return { role: membership.role, tenantType: membership.tenant.type };
  }

  async assertTenantAccess(
    userId: string,
    tenantId: string,
    permission: Permission,
  ): Promise<{ role: MembershipRole; tenantType: TenantType }> {
    const access = await this.getTenantAccess(userId, tenantId);
    if (!access) throw new ForbiddenException('Tenant access denied.');
    this.assertPermission(access.role, permission);
    return access;
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
