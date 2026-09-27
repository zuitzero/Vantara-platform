import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from './auth.guard';
import { TenantScopedRequest } from './tenant-context';

@Injectable()
export class TenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & TenantScopedRequest>();

    if (!request.auth) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.tenantContext = {
      tenantId: request.auth.tenant.id,
      membershipId: request.auth.membership.id,
      role: request.auth.membership.role as TenantScopedRequest['tenantContext'] extends infer T
        ? T extends { role: infer R } ? R : never
        : never,
    };

    return true;
  }
}
