import { IsEnum, IsString, MinLength } from 'class-validator';
import { RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  number!: string;

  @IsString()
  @MinLength(1)
  roomTypeId!: string;
}

export class UpdateRoomOccupancyDto {
  @IsEnum(RoomOccupancyStatus)
  occupancyStatus!: RoomOccupancyStatus;
}

export class UpdateRoomReadinessDto {
  @IsEnum(RoomReadinessStatus)
  readinessStatus!: RoomReadinessStatus;
}
