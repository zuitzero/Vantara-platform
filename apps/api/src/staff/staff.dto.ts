import { StaffDepartment, StaffOperationalStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateStaffDto {
  @IsString() @MinLength(1) membershipId!: string;
  @IsOptional() @IsString() @MinLength(1) propertyId?: string | null;
  @IsEnum(StaffDepartment) department!: StaffDepartment;
  @ValidateIf((_, value) => value !== undefined) @IsEnum(StaffOperationalStatus) operationalStatus?: StaffOperationalStatus;
}
export class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(1) propertyId?: string | null;
  @ValidateIf((_, value) => value !== undefined) @IsEnum(StaffDepartment) department?: StaffDepartment;
  @ValidateIf((_, value) => value !== undefined) @IsEnum(StaffOperationalStatus) operationalStatus?: StaffOperationalStatus;
}
