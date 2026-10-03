import { MaintenanceStatus, OperationsPriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMaintenanceTicketDto {
  @IsString() @MinLength(1) roomId!: string;
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(2000) description!: string;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MaxLength(120) assignedTo?: string;
}

export class UpdateMaintenanceTicketDto {
  @IsOptional() @IsEnum(MaintenanceStatus) status?: MaintenanceStatus;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MaxLength(120) assignedTo?: string;
  @IsOptional() @IsString() @MaxLength(2000) resolutionNote?: string;
}