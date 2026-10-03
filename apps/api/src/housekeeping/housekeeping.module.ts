import { StaffModule } from '../staff/staff.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HousekeepingController } from './housekeeping.controller';
import { HousekeepingService } from './housekeeping.service';

@Module({
  imports: [PrismaModule, AuthModule, StaffModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService],
})
export class HousekeepingModule {}
