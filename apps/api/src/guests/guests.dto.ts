import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CreateGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class GuestPreferenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  value!: string;
}

export class UpdateGuestCrmDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuestPreferenceDto)
  preferences?: GuestPreferenceDto[];
}

export class CreateGuestNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
