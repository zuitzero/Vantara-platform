import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { AuthGuard } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateGuestRequestDto, UpdateGuestRequestDto } from './requests.dto';
import { RequestsService } from './requests.service';

@Controller('requests')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @Permissions('requests.read')
  list(@Req() req: TenantScopedRequest) {
    return this.requests.listForTenant(req.tenantContext!.tenantId);
  }

  @Get(':requestId')
  @Permissions('requests.read')
  get(@Req() req: TenantScopedRequest, @Param('requestId') requestId: string) {
    return this.requests.getForTenant(req.tenantContext!.tenantId, requestId);
  }

  @Post('guests/:guestId')
  @Permissions('requests.manage')
  create(@Req() req: TenantScopedRequest, @Param('guestId') guestId: string, @Body() body: CreateGuestRequestDto) {
    return this.requests.createForTenant(req.tenantContext!.tenantId, guestId, body);
  }

  @Patch(':requestId')
  @Permissions('requests.manage')
  update(@Req() req: TenantScopedRequest, @Param('requestId') requestId: string, @Body() body: UpdateGuestRequestDto) {
    return this.requests.updateForTenant(req.tenantContext!.tenantId, requestId, body);
  }
}
