import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateRoomTypeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsInt()
  @Min(1)
  maxGuests!: number;
}
