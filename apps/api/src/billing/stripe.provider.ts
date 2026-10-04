import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PlanCode } from '@prisma/client';
import Stripe = require('stripe');

export const SELF_SERVICE_PLANS = [PlanCode.LOBBY, PlanCode.SUITE, PlanCode.GRAND] as const;
@Injectable()
export class StripeProvider {
  private client?: Stripe;
  sdk(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || !/^(sk|rk)_test_/.test(key)) throw new ServiceUnavailableException('Stripe test-mode configuration is required.');
    return this.client ??= new Stripe(key, { apiVersion: '2026-08-26.dahlia', timeout: 8000, maxNetworkRetries: 1 });
  }
  prices(): Record<typeof SELF_SERVICE_PLANS[number], string> {
    const entries = SELF_SERVICE_PLANS.map(plan => [plan, process.env[`STRIPE_PRICE_${plan}`]] as const);
    if (entries.some(([, price]) => !price || !/^price_[A-Za-z0-9]+$/.test(price)) || new Set(entries.map(([, price]) => price)).size !== 3) {
      throw new ServiceUnavailableException('Configure three distinct self-service Stripe prices.');
    }
    return Object.fromEntries(entries) as Record<typeof SELF_SERVICE_PLANS[number], string>;
  }
  url(key: string): string {
    const value = process.env[key];
    try {
      const url = new URL(value ?? '');
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
      return url.toString();
    } catch { throw new ServiceUnavailableException(`Configure a trusted ${key}.`); }
  }
  verify(rawBody: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!rawBody || !signature) throw new BadRequestException('Stripe signature and raw body are required.');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret?.startsWith('whsec_')) throw new ServiceUnavailableException('Stripe webhook configuration is required.');
    const sdk = this.sdk();
    let event: Stripe.Event;
    try { event = sdk.webhooks.constructEvent(rawBody, signature, secret); }
    catch { throw new BadRequestException('Invalid Stripe webhook signature or payload.'); }
    if (event.object !== 'event' || !/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') || typeof event.type !== 'string' || event.livemode !== false || !event.data?.object) {
      throw new BadRequestException('Invalid test-mode Stripe event.');
    }
    return event;
  }
}
