import { MembershipRole } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
}

export interface TenantScopedRequest {
  tenantContext?: TenantContext;
}
