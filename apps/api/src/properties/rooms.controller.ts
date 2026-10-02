import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateRoomDto, UpdateRoomStatusDto } from './rooms.dto';

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

  @Post('properties/:propertyId')
  @Permissions('rooms.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('propertyId') propertyId: string, @Body() input: CreateRoomDto) {
    return this.roomsService.createForTenant(request.tenantContext!.tenantId, propertyId, input);
  }

  @Patch(':roomId/status')
  @Permissions('rooms.manage')
  updateStatus(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('roomId') roomId: string, @Body() input: UpdateRoomStatusDto) {
    return this.roomsService.updateStatusForTenant(request.tenantContext!.tenantId, roomId, input);
  }
}
