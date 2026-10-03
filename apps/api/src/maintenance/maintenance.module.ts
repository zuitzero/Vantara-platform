import { RoomReadinessModule } from '../room-readiness/room-readiness.module';
import { StaffModule } from '../staff/staff.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [RoomReadinessModule, PrismaModule, AuthModule, StaffModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
