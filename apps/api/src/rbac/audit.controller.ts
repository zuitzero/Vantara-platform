import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { AuditAction } from '@prisma/client';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Permissions, PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantScopedRequest } from '../auth/tenant-context';
import { AuditService } from './audit.service';
export class AuditQuery {
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @ValidateIf((_object, value) => value !== undefined) @IsEnum(AuditAction) action?: AuditAction;
}
@Controller('audit')
@UseGuards(AuthGuard, TenantContextGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() @Permissions('security.read')
  list(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Query() query: AuditQuery) { return this.audit.listForHotel(req.tenantContext!.tenantId, query.offset, query.limit, query.action); }
}
