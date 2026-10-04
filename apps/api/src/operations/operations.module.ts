import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { IncidentEngineService } from './incident-engine.service';

@Module({
  imports: [AuthModule, PrismaModule, NotificationsModule],
  controllers: [OperationsController],
  providers: [OperationsService, IncidentEngineService],
  exports: [OperationsService, IncidentEngineService],
})
export class OperationsModule {}

