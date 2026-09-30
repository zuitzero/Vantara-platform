import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GuestRequestsController } from './guest-requests.controller';
import { GuestRequestsService } from './guest-requests.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [GuestRequestsController],
  providers: [GuestRequestsService],
})
export class GuestRequestsModule {}
