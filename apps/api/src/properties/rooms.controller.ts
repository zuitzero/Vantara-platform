import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateRoomDto, UpdateRoomStatusDto } from './rooms.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.roomsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Post('properties/:propertyId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER)
  create(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('propertyId') propertyId: string,
    @Body() input: CreateRoomDto,
  ) {
    return this.roomsService.createForTenant(
      request.tenantContext!.tenantId,
      propertyId,
      input,
    );
  }

  @Patch(':roomId/status')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER, MembershipRole.STAFF)
  updateStatus(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('roomId') roomId: string,
    @Body() input: UpdateRoomStatusDto,
  ) {
    return this.roomsService.updateStatusForTenant(
      request.tenantContext!.tenantId,
      roomId,
      input,
    );
  }
}
