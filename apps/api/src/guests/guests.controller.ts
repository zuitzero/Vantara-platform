import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateGuestDto } from './guests.dto';
import { GuestsService } from './guests.service';

@Controller('guests')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.guestsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Get(':guestId')
  get(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('guestId') guestId: string) {
    return this.guestsService.getForTenant(request.tenantContext!.tenantId, guestId);
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateGuestDto) {
    return this.guestsService.createForTenant(request.tenantContext!.tenantId, input);
  }
}
