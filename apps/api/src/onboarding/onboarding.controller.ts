import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { CreateWorkspaceDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('status')
  @UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
  @Permissions('hotel.manage')
  status(@Req() request: AuthenticatedRequest & TenantScopedRequest) {
    return this.onboardingService.statusForTenant(request.tenantContext!.tenantId);
  }

  @Post('workspace')
  createWorkspace(@Body() input: CreateWorkspaceDto) {
    return this.onboardingService.createWorkspace(input);
  }
}

