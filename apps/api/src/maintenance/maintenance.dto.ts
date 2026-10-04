import { MaintenanceStatus, OperationsPriority } from '@prisma/client';
import { IsEnum, IsBoolean, ValidateIf, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMaintenanceTicketDto {
  @IsString() @MinLength(1) roomId!: string;
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(2000) description!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() blocksRoom?: boolean;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
}

export class UpdateMaintenanceTicketDto {
  @IsOptional() @IsEnum(MaintenanceStatus) status?: MaintenanceStatus;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() blocksRoom?: boolean;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) resolutionNote?: string;
}
