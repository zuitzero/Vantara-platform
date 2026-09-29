import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateGuestRequestDto, UpdateGuestRequestDto } from './requests.dto';
import { RequestsService } from './requests.service';

@Controller('requests')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  list(@Req() req: TenantScopedRequest) {
    return this.requests.listForTenant(req.tenantContext!.tenantId);
  }

  @Get(':requestId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  get(@Req() req: TenantScopedRequest, @Param('requestId') requestId: string) {
    return this.requests.getForTenant(req.tenantContext!.tenantId, requestId);
  }

  @Post('guests/:guestId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  create(@Req() req: TenantScopedRequest, @Param('guestId') guestId: string, @Body() body: CreateGuestRequestDto) {
    return this.requests.createForTenant(req.tenantContext!.tenantId, guestId, body);
  }

  @Patch(':requestId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  update(@Req() req: TenantScopedRequest, @Param('requestId') requestId: string, @Body() body: UpdateGuestRequestDto) {
    return this.requests.updateForTenant(req.tenantContext!.tenantId, requestId, body);
  }
}
