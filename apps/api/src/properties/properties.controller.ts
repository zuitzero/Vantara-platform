import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreatePropertyDto } from './properties.dto';
import { PropertiesService } from './properties.service';

@Controller('properties')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  @Permissions('hotel.read')
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.propertiesService.listForTenant(request.tenantContext!.tenantId);
  }

  @Post()
  @Permissions('hotel.manage')
  create(@Req() request: AuthenticatedRequest & TenantScopedRequest, @Body() input: CreatePropertyDto) {
    return this.propertiesService.createForTenant(request.tenantContext!.tenantId, input.name);
  }
}
