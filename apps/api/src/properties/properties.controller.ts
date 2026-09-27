import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { CreatePropertyDto } from './properties.dto';
import { PropertiesService } from './properties.service';

@Controller('properties')
@UseGuards(AuthGuard, TenantContextGuard, RolesGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.propertiesService.listForTenant(request.tenantContext!.tenantId);
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MANAGER)
  create(
    @Req() request: AuthenticatedRequest & TenantScopedRequest,
    @Body() input: CreatePropertyDto,
  ) {
    return this.propertiesService.createForTenant(
      request.tenantContext!.tenantId,
      input.name,
    );
  }
}
