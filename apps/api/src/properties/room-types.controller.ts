import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateRoomTypeDto } from './room-types.dto';
import { RoomTypesService } from './room-types.service';

@Controller('room-types')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class RoomTypesController {
  constructor(private readonly roomTypesService: RoomTypesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.roomTypesService.listForTenant(request.tenantContext!.tenantId);
  }

  @Post('properties/:propertyId')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER)
  create(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('propertyId') propertyId: string,
    @Body() input: CreateRoomTypeDto,
  ) {
    return this.roomTypesService.createForTenant(
      request.tenantContext!.tenantId,
      propertyId,
      input,
    );
  }
}
