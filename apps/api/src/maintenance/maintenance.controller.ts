import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreateMaintenanceTicketDto, UpdateMaintenanceTicketDto } from './maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @Permissions('maintenance.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.maintenance.listForTenant(request.tenantContext!.tenantId);
  }

  @Get('assignees')
  @Permissions('maintenance.manage')
  assignees(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.maintenance.assigneesForTenant(request.tenantContext!.tenantId);
  }

  @Post()
  @Permissions('maintenance.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreateMaintenanceTicketDto) {
    return this.maintenance.createForTenant(request.tenantContext!.tenantId, input);
  }

  @Patch(':ticketId')
  @Permissions('maintenance.manage')
  update(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Param('ticketId') ticketId: string, @Body() input: UpdateMaintenanceTicketDto) {
    return this.maintenance.updateForTenant(request.tenantContext!.tenantId, ticketId, input);
  }
}
