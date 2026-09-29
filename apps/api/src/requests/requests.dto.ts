import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { GuestRequestCategory, GuestRequestPriority, GuestRequestStatus } from '@prisma/client';

export class CreateGuestRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  message!: string;

  @IsEnum(GuestRequestCategory)
  category!: GuestRequestCategory;

  @IsOptional()
  @IsEnum(GuestRequestPriority)
  priority?: GuestRequestPriority;

  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}

export class UpdateGuestRequestDto {
  @IsOptional()
  @IsEnum(GuestRequestStatus)
  status?: GuestRequestStatus;

  @IsOptional()
  @IsEnum(GuestRequestPriority)
  priority?: GuestRequestPriority;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
