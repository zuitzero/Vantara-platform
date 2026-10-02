import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateGuestDto } from './guests.dto';

import { GuestsService } from './guests.service';

@Controller('guests')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  @Permissions('guests.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.guestsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Get(':guestId')
  @Permissions('guests.read')
  get(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('guestId') guestId: string) {
    return this.guestsService.getForTenant(request.tenantContext!.tenantId, guestId);
  }

  @Post()
  @Permissions('guests.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateGuestDto) {
    return this.guestsService.createForTenant(request.tenantContext!.tenantId, input);
  }
}
