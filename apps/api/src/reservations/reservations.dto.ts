import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateReservationDto {
  @IsString()
  @MinLength(2)
  guestId!: string;

  @IsString()
  @MinLength(2)
  propertyId!: string;

  @IsString()
  @MinLength(2)
  roomTypeId!: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @Type(() => Date)
  @IsDate()
  checkIn!: Date;

  @Type(() => Date)
  @IsDate()
  checkOut!: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @IsOptional()
  @IsString()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
