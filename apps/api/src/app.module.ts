import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { GuestsModule } from './guests/guests.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { PropertiesModule } from './properties/properties.module';

@Module({
  imports: [PrismaModule, AuthModule, OnboardingModule, PropertiesModule, GuestsModule],
  controllers: [HealthController],
})
export class AppModule {}
