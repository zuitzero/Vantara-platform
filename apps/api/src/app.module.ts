import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { GuestsModule } from './guests/guests.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { PropertiesModule } from './properties/properties.module';
import { ReservationsModule } from './reservations/reservations.module';
import { RequestsModule } from './requests/requests.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperationsModule } from './operations/operations.module';
import { RbacModule } from './rbac/rbac.module';

@Module({
  imports: [PrismaModule, RbacModule, AuthModule, OnboardingModule, PropertiesModule, GuestsModule, ReservationsModule, RequestsModule, NotificationsModule, OperationsModule],
  controllers: [HealthController],
})
export class AppModule {}
