import { EntitlementsModule } from '../entitlements/entitlements.module';
import { RoomReadinessModule } from '../room-readiness/room-readiness.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [EntitlementsModule, RoomReadinessModule, PrismaModule, AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}

