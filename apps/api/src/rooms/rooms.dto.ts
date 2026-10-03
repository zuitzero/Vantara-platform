import { IsEnum } from 'class-validator';
import { RoomOccupancyStatus, RoomReadinessStatus } from '@prisma/client';

export class UpdateRoomOccupancyDto {
  @IsEnum(RoomOccupancyStatus)
  occupancyStatus!: RoomOccupancyStatus;
}

export class UpdateRoomReadinessDto {
  @IsEnum(RoomReadinessStatus)
  readinessStatus!: RoomReadinessStatus;
}
