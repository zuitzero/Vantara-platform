import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateReservationDto, UpdateReservationStatusDto } from './reservations.dto';

import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get()
  @Permissions('reservations.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.reservationsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Get(':reservationId')
  @Permissions('reservations.read')
  get(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('reservationId') reservationId: string) {
    return this.reservationsService.getForTenant(request.tenantContext!.tenantId, reservationId);
  }

  @Post()
  @Permissions('reservations.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateReservationDto) {
    return this.reservationsService.createForTenant(request.tenantContext!.tenantId, input);
  }

  @Patch(':reservationId/status')
  @Permissions('reservations.manage')
  updateStatus(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('reservationId') reservationId: string,
    @Body() input: UpdateReservationStatusDto,
  ) {
    return this.reservationsService.updateStatusForTenant(request.tenantContext!.tenantId, reservationId, input.status);
  }
}
