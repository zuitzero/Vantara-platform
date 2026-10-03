import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { UpdateRoomOccupancyDto, UpdateRoomReadinessDto } from './rooms.dto';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @Permissions('rooms.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.roomsService.listForTenant(request.tenantContext!.tenantId);
  }

  @Patch(':roomId/occupancy')
  @Permissions('rooms.manage')
  updateOccupancy(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('roomId') roomId: string,
    @Body() input: UpdateRoomOccupancyDto,
  ) {
    return this.roomsService.updateOccupancyForTenant(request.tenantContext!.tenantId, roomId, input.occupancyStatus);
  }

  @Patch(':roomId/readiness')
  @Permissions('rooms.manage')
  updateReadiness(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Param('roomId') roomId: string,
    @Body() input: UpdateRoomReadinessDto,
  ) {
    return this.roomsService.updateReadinessForTenant(request.tenantContext!.tenantId, roomId, input.readinessStatus);
  }
}
