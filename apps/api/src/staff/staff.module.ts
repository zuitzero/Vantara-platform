import { EntitlementsModule } from '../entitlements/entitlements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({ imports: [EntitlementsModule, NotificationsModule, PrismaModule, AuthModule], controllers: [StaffController], providers: [StaffService], exports: [StaffService] })
export class StaffModule {}
