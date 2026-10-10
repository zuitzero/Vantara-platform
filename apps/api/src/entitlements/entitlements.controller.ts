import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { EntitlementsService } from './entitlements.service';

@Controller('entitlements')
@UseGuards(AuthGuard, TenantContextGuard)
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}
  @Get()
  get(@Req() req: AuthenticatedRequest & TenantScopedRequest) {
    return this.entitlements.summary(req.tenantContext!.tenantId);
  }
}
