import { Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { StripeProvider } from './stripe.provider';
@Controller('billing/webhooks')
export class StripeWebhookController {
  constructor(private readonly stripe: StripeProvider, private readonly billing: BillingService) {}
  @Post('stripe') @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) { return this.billing.handleEvent(this.stripe.verify(req.rawBody, signature)); }
}
