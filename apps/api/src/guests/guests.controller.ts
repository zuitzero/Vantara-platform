import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateGuestDto, CreateGuestNoteDto, UpdateGuestCrmDto } from './guests.dto';

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

  @Get(':guestId/crm')
  @Permissions('guests.read')
  crm(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('guestId') guestId: string) {
    return this.guestsService.getCrmForTenant(request.tenantContext!.tenantId, guestId);
  }

  @Patch(':guestId/crm')
  @Permissions('guests.manage')
  updateCrm(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('guestId') guestId: string, @Body() input: UpdateGuestCrmDto) {
    return this.guestsService.updateCrmForTenant(request.tenantContext!.tenantId, guestId, input);
  }

  @Post(':guestId/crm/notes')
  @Permissions('guests.manage')
  addCrmNote(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('guestId') guestId: string, @Body() input: CreateGuestNoteDto) {
    return this.guestsService.addCrmNoteForTenant(request.tenantContext!.tenantId, guestId, request.auth!.user.id, input);
  }
}
