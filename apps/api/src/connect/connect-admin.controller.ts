import { Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { ConnectService } from './connect.service';

@Controller('connect-admin')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class ConnectAdminController {
  constructor(private readonly connect: ConnectService) {}
  @Post('reservations/:reservationId/access') @Permissions('reservations.manage')
  issue(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Param('reservationId') reservationId: string) {
    return this.connect.issue(req.tenantContext!.tenantId, reservationId);
  }
  @Delete('reservations/:reservationId/access') @Permissions('reservations.manage')
  revoke(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Param('reservationId') reservationId: string) {
    return this.connect.revoke(req.tenantContext!.tenantId, reservationId);
  }
}
