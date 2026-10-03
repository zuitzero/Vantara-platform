import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateStaffDto, UpdateStaffDto } from './staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) { }
  @Get() @Permissions('staff.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) { return this.staff.listForTenant(request.tenantContext!.tenantId); }
  @Get('memberships') @Permissions('staff.manage')
  memberships(@Req() request: AuthenticatedRequest & TenantScopedRequest) { return this.staff.membershipsForTenant(request.tenantContext!.tenantId); }
  @Post() @Permissions('staff.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateStaffDto) { return this.staff.createForTenant(request.tenantContext!.tenantId, input); }
  @Patch(':staffId') @Permissions('staff.manage')
  update(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('staffId') staffId: string, @Body() input: UpdateStaffDto) { return this.staff.updateForTenant(request.tenantContext!.tenantId, staffId, input); }
}
