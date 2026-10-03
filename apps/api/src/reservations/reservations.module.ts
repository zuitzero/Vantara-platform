import { RoomReadinessModule } from '../room-readiness/room-readiness.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [RoomReadinessModule, AuthModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}

