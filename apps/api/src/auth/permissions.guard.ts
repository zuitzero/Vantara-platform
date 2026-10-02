import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../rbac/rbac.types';
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
      throw new ForbiddenException('Tenant access denied.');
    }

    for (const permission of required) {
      if (this.rbac.hasPermission(access.role, permission)) return true;
    }

    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
