import { EntitlementsModule } from './entitlements/entitlements.module';
import { BillingModule } from './billing/billing.module';
import { StaffModule } from './staff/staff.module';
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
import { RoomsModule } from './rooms/rooms.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [EntitlementsModule, BillingModule, StaffModule, PrismaModule, RbacModule, AuthModule, OnboardingModule, PropertiesModule, RoomsModule, HousekeepingModule, MaintenanceModule, GuestsModule, ReservationsModule, RequestsModule, NotificationsModule, OperationsModule],
  controllers: [HealthController],
})
export class AppModule {}

