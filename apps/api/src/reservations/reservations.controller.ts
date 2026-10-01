import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateReservationDto } from './reservations.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.reservationsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Get(':reservationId')
  get(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('reservationId') reservationId: string,
  ) {
    return this.reservationsService.getForTenant(request.tenantContext!.tenantId, reservationId);
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  create(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Body() input: CreateReservationDto,
  ) {
    return this.reservationsService.createForTenant(request.tenantContext!.tenantId, input);
  }
}
