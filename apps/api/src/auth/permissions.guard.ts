import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { Permission } from '../rbac/rbac.types';
import { AuditService } from '../rbac/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthenticatedRequest } from './auth.guard';
import { TenantScopedRequest } from './tenant-context';

export const PERMISSIONS_KEY = 'vantara_permissions';
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & TenantScopedRequest>();
    const userId = request.auth?.user.id;
    const tenantId = request.tenantContext?.tenantId;

    if (!userId || !tenantId) {
      throw new ForbiddenException('Tenant authorization context required.');
    }

    const access = await this.rbac.getTenantAccess(userId, tenantId);

    if (!access) {
      await this.audit.record({
        tenantId,
        actorUserId: userId,
        action: AuditAction.PERMISSION_DENIED,
        resourceType: 'authorization',
        success: false,
        metadata: { requiredPermissions: required, reason: 'TENANT_ACCESS_DENIED' },
      });
      throw new ForbiddenException('Tenant access denied.');
    }

    const allowed = required.some((permission) => this.rbac.hasPermission(access.role, permission));

    if (allowed) return true;

    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AuditAction.PERMISSION_DENIED,
      resourceType: 'authorization',
      success: false,
      metadata: {
        requiredPermissions: required,
        role: access.role,
        tenantType: access.tenantType,
        reason: 'MISSING_PERMISSION',
      },
    });

    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
