import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateRoomTypeDto } from './room-types.dto';
import { RoomTypesService } from './room-types.service';

@Controller('room-types')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class RoomTypesController {
  constructor(private readonly roomTypesService: RoomTypesService) {}

  @Get()
  @Permissions('rooms.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.roomTypesService.listForTenant(request.tenantContext!.tenantId);
  }

  @Post('properties/:propertyId')
  @Permissions('rooms.manage')
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
