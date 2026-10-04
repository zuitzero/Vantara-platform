import { PlanCode } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateWorkspaceDto {
  @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @Transform(lower) @IsEmail() @Length(3, 254) email!: string;
  @IsString() @Length(8, 128) password!: string;
  @Transform(trim) @IsString() @Length(1, 120) hotelName!: string;
  @Transform(lower) @IsString() @Length(3, 63) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must contain lowercase letters, numbers and single separating hyphens' }) slug!: string;
  @Transform(trim) @IsString() @Length(1, 120) propertyName!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsEnum(PlanCode) plan?: PlanCode;
}

export interface WorkspaceCreatedResponse {
  userId: string;
  tenantId: string;
  propertyId: string;
  subscriptionId: string;
  plan: PlanCode;
}
