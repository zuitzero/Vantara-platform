import { IsEnum, IsString, MinLength } from 'class-validator';
import { RoomStatus } from '@prisma/client';

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  number!: string;

  @IsString()
  @MinLength(1)
  roomTypeId!: string;
}

export class UpdateRoomStatusDto {
  @IsEnum(RoomStatus)
  status!: RoomStatus;
}
