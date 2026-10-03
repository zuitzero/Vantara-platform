import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { OperationsService } from './operations.service';

@Controller('operations')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('health')
  @Permissions('incidents.read')
  health(@Req() _request: TenantScopedRequest) {
    return this.operations.health();
  }
}
