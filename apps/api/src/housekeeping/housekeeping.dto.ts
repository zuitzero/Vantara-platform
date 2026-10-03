import { HousekeepingStatus, OperationsPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateHousekeepingTaskDto {
  @IsString() @MinLength(1) roomId!: string;
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
  @IsOptional() @IsDateString() dueAt?: string;
}

export class UpdateHousekeepingTaskDto {
  @IsOptional() @IsEnum(HousekeepingStatus) status?: HousekeepingStatus;
  @IsOptional() @IsEnum(OperationsPriority) priority?: OperationsPriority;
  @IsOptional() @IsString() @MinLength(1) assignedStaffId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
