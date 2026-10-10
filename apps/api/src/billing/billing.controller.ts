import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { PlanCode } from '@prisma/client';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { BillingService } from './billing.service';
import { SELF_SERVICE_PLANS } from './stripe.provider';
export class CheckoutDto { @IsIn(SELF_SERVICE_PLANS) plan!: PlanCode; }
export class PortalDto {}
@Controller('billing')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('subscription') @Permissions('billing.read')
  subscription(@Req() req: AuthenticatedRequest & TenantScopedRequest) { return this.billing.read(req.auth!.user.id, req.tenantContext!.tenantId); }
  @Post('checkout') @Permissions('billing.manage')
  checkout(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Body() body: CheckoutDto) { return this.billing.checkout(req.auth!.user.id, req.tenantContext!.tenantId, body.plan); }
  @Post('reconcile') @Permissions('billing.manage')
  reconcile(@Req() req: AuthenticatedRequest & TenantScopedRequest) { return this.billing.reconcile(req.auth!.user.id, req.tenantContext!.tenantId); }
  @Post('portal') @Permissions('billing.manage')
  portal(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Body() _body: PortalDto) { return this.billing.portal(req.auth!.user.id, req.tenantContext!.tenantId); }
}
