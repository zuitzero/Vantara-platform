import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { BillingService } from './billing.service';
import { StripeProvider } from './stripe.provider';
@Module({ imports: [PrismaModule, AuthModule], controllers: [BillingController, StripeWebhookController], providers: [BillingService, StripeProvider] })
export class BillingModule {}
