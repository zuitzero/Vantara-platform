import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateHousekeepingTaskDto, UpdateHousekeepingTaskDto } from './housekeeping.dto';
import { HousekeepingService } from './housekeeping.service';

@Controller('housekeeping')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class HousekeepingController {
  constructor(private readonly housekeeping: HousekeepingService) {}

  @Get()
  @Permissions('housekeeping.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.housekeeping.listForTenant(request.tenantContext!.tenantId);
  }

  @Get('assignees')
  @Permissions('housekeeping.manage')
  assignees(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.housekeeping.assigneesForTenant(request.tenantContext!.tenantId);
  }

  @Post()
  @Permissions('housekeeping.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateHousekeepingTaskDto) {
    return this.housekeeping.createForTenant(request.tenantContext!.tenantId, input);
  }

  @Patch(':taskId')
  @Permissions('housekeeping.manage')
  update(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('taskId') taskId: string, @Body() input: UpdateHousekeepingTaskDto) {
    return this.housekeeping.updateForTenant(request.tenantContext!.tenantId, taskId, input);
  }
}
