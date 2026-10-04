import { HousekeepingStatus, OperationsPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsBoolean, ValidateIf, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateHousekeepingTaskDto {
  @IsString() @MinLength(1) roomId!: string;
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() blocksRoom?: boolean;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
  @IsOptional() @IsDateString() dueAt?: string;
}

export class UpdateHousekeepingTaskDto {
  @IsOptional() @IsEnum(HousekeepingStatus) status?: HousekeepingStatus;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() blocksRoom?: boolean;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
