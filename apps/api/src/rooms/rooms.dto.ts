import { IsEnum } from 'class-validator';
import { RoomStatus } from '@prisma/client';

export class UpdateRoomStatusDto {
  @IsEnum(RoomStatus)
  status!: RoomStatus;
}
