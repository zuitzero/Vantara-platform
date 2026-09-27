import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, OnboardingModule],
  controllers: [HealthController],
})
export class AppModule {}
