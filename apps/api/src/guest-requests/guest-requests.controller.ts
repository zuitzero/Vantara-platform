import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { GuestRequestCategory, GuestRequestPriority, GuestRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { GuestRequestsService } from './guest-requests.service';

class CreateGuestRequestDto {
  @IsString() @MinLength(2) propertyId!: string;
  @IsString() @MinLength(2) guestId!: string;
  @IsOptional() @IsString() roomId?: string;
  @IsString() @MinLength(2) title!: string;
  @IsString() @MinLength(2) message!: string;
  @IsEnum(GuestRequestCategory) category!: GuestRequestCategory;
  @IsOptional() @IsEnum(GuestRequestPriority) priority?: GuestRequestPriority;
}

class UpdateGuestRequestDto {
  @IsEnum(GuestRequestStatus) status!: GuestRequestStatus;
  @IsOptional() @IsString() resolutionNote?: string;
}

@Controller('guest-requests')
@UseGuards(AuthGuard, TenantContextGuard)
export class GuestRequestsController {
  constructor(private readonly service: GuestRequestsService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(req.tenantContext.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() body: CreateGuestRequestDto) {
    return this.service.create({ ...body, tenantId: req.tenantContext.tenantId });
  }

  @Patch(':id/status')
  updateStatus(@Req() req: any, @Param('id') id: string, @Body() body: UpdateGuestRequestDto) {
    return this.service.updateStatus(req.tenantContext.tenantId, id, body.status, body.resolutionNote);
  }
}
