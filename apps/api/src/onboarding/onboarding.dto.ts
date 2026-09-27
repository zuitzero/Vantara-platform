import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { PlanCode } from '@prisma/client';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  hotelName!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  propertyName!: string;

  @IsEnum(PlanCode)
  @IsOptional()
  plan?: PlanCode;
}

export interface WorkspaceCreatedResponse {
  userId: string;
  tenantId: string;
  propertyId: string;
  subscriptionId: string;
  plan: PlanCode;
}
