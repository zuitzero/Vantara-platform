import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditAction, Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import Stripe = require('stripe');
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { auditMutation } from '../rbac/audit.service';
import { SELF_SERVICE_PLANS, StripeProvider } from './stripe.provider';

export function stripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing': return 'TRIALING';
    case 'active': return 'ACTIVE';
    case 'past_due': case 'unpaid': return 'PAST_DUE';
    case 'incomplete': return 'INCOMPLETE';
    case 'incomplete_expired': case 'canceled': return 'CANCELED';
    case 'paused': return 'PAUSED';
    default: throw new BadRequestException('Unsupported Stripe subscription status.');
  }
}
function idOf(value: string | { id: string } | null | undefined): string | null { return typeof value === 'string' ? value : value?.id ?? null; }
function stripeUrl(value: string | null, host: string): string {
  try { const url = new URL(value ?? ''); if (url.protocol === 'https:' && url.hostname === host && !url.username && !url.password) return url.toString(); } catch { /* safe domain error below */ }
  throw new ServiceUnavailableException('Stripe did not return a valid hosted session URL.');
}
const supportedEvents = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly stripe: StripeProvider, private readonly rbac: RbacService) {}
  private async authorize(userId: string, tenantId: string, manage = false) {
    const access = await this.rbac.assertTenantAccess(userId, tenantId, manage ? 'billing.manage' : 'billing.read');
    if (access.tenantType !== 'HOTEL' || access.role !== 'HOTEL_ADMIN') throw new ForbiddenException('Hotel billing requires a HOTEL_ADMIN membership.');
  }
  private async local(db: Pick<Prisma.TransactionClient, 'subscription'>, tenantId: string) {
    const local = await db.subscription.findUnique({ where: { tenantId } });
    if (!local) throw new NotFoundException('Hotel subscription not found.');
    return local;
  }
  private transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(operation, { maxWait: 10000, timeout: 60000 });
  }
  // Transaction-scoped PostgreSQL lock serializes all billing changes for one subscription,
  // including the Stripe read. Snapshot retrieval cannot race a newer local update.
  private async lock(tx: Prisma.TransactionClient, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${key}`}, 0))`; }
  async read(userId: string, tenantId: string) {
    await this.authorize(userId, tenantId);
    return this.transaction(async tx => {
      const local = await this.local(tx, tenantId);
      await auditMutation(tx, tenantId, AuditAction.BILLING_VIEW, 'subscription', local.id);
      return { plan: local.plan, status: local.status, currentPeriodStart: local.currentPeriodStart, currentPeriodEnd: local.currentPeriodEnd, cancelAtPeriodEnd: local.cancelAtPeriodEnd,
        hasStripeCustomer: !!local.stripeCustomerId, hasStripeSubscription: !!local.stripeSubscriptionId };
    });
  }
  private metadata(local: Subscription) { return { vantaraTenantId: local.tenantId, vantaraSubscriptionId: local.id }; }
  private async customer(local: Subscription) {
    if (!local.stripeCustomerId) throw new ConflictException('Hotel has no Stripe customer. Choose a paid plan first.');
    const customer = await this.stripe.sdk().customers.retrieve(local.stripeCustomerId);
    if (customer.deleted || customer.livemode || customer.metadata.vantaraTenantId !== local.tenantId || customer.metadata.vantaraSubscriptionId !== local.id) {
      throw new ConflictException('Stripe customer mapping requires administrator reconciliation.');
    }
    return customer;
  }
  async checkout(userId: string, tenantId: string, plan: Subscription['plan']) {
    try { return await this.createCheckout(userId, tenantId, plan); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      // Do not let Nest's default error logger print Stripe error objects.
      throw new ServiceUnavailableException('Unable to open Stripe Checkout. Retry safely or contact your administrator.');
    }
  }
  private async createCheckout(userId: string, tenantId: string, plan: Subscription['plan']) {
    await this.authorize(userId, tenantId, true);
    if (!SELF_SERVICE_PLANS.includes(plan as typeof SELF_SERVICE_PLANS[number])) throw new BadRequestException('Choose LOBBY, SUITE or GRAND.');
    const prices = this.stripe.prices(); const sdk = this.stripe.sdk();
    const successUrl = this.stripe.url('BILLING_SUCCESS_URL'); const cancelUrl = this.stripe.url('BILLING_CANCEL_URL');
    // Persist the customer request BEFORE network access. Unknown outcomes are retried
    // with the same key, never with a fresh key after Stripe's 24h retention window.
    const localId = await this.transaction(async tx => {
      const initial = await this.local(tx, tenantId); await this.lock(tx, initial.id);
      const local = await this.local(tx, tenantId);
      if (local.stripeSubscriptionId) throw new ConflictException('A Stripe subscription is already linked. Use Manage Billing.');
      if (!local.stripeCustomerId && !local.stripeCustomerRequestedAt) await tx.subscription.update({ where: { id: local.id }, data: { stripeCustomerRequestedAt: new Date() } });
      return local.id;
    });
    await this.transaction(async tx => {
      await this.lock(tx, localId); const local = await this.local(tx, tenantId);
      if (local.stripeCustomerId) { await this.customer(local); return; }
      if (!local.stripeCustomerRequestedAt || Date.now() - local.stripeCustomerRequestedAt.getTime() > 23 * 3600000) throw new ConflictException('Unresolved Stripe customer request requires reconciliation.');
      const customer = await sdk.customers.create({ metadata: this.metadata(local) }, { idempotencyKey: `vantara-customer-${local.id}` });
      if (customer.livemode || customer.metadata.vantaraTenantId !== tenantId || customer.metadata.vantaraSubscriptionId !== local.id) throw new ConflictException('Invalid Stripe customer identity.');
      await tx.subscription.update({ where: { id: local.id }, data: { stripeCustomerId: customer.id } });
    });
    // Freeze Checkout parameters and key before external creation. Concurrent requests
    // reuse the attempt; an open attempt for another plan must expire first.
    await this.transaction(async tx => {
      await this.lock(tx, localId); const local = await this.local(tx, tenantId);
      if (local.stripeSubscriptionId) throw new ConflictException('A subscription is linked. Use Manage Billing.');
      const attempt = await tx.stripeCheckoutAttempt.findUnique({ where: { subscriptionId: local.id } });
      if (attempt) {
        if (!attempt.sessionId) return; // Recover ambiguous network outcome with original parameters.
        const session = await sdk.checkout.sessions.retrieve(attempt.sessionId);
        if (session.livemode || idOf(session.customer) !== local.stripeCustomerId || session.metadata?.vantaraSubscriptionId !== local.id || session.metadata?.vantaraTenantId !== tenantId) throw new ConflictException('Invalid Checkout identity.');
        if (session.status === 'complete') throw new ConflictException('Checkout completed. Refresh while verified billing state synchronizes.');
        if (session.status !== 'expired') return;
        await tx.stripeCheckoutAttempt.delete({ where: { id: attempt.id } });
      }
      await tx.stripeCheckoutAttempt.create({ data: { subscriptionId: local.id, plan, priceId: prices[plan as typeof SELF_SERVICE_PLANS[number]], successUrl, cancelUrl, expiresAt: new Date(Date.now() + 3600000) } });
    });
    return this.transaction(async tx => {
      await this.lock(tx, localId); const local = await this.local(tx, tenantId);
      if (local.stripeSubscriptionId) throw new ConflictException('A subscription is linked. Use Manage Billing.');
      const attempt = await tx.stripeCheckoutAttempt.findUniqueOrThrow({ where: { subscriptionId: local.id } });
      if (attempt.plan !== plan) throw new ConflictException(`An unfinished ${attempt.plan} Checkout exists. Select ${attempt.plan} to continue, or wait until ${attempt.expiresAt.toISOString()} for it to expire.`);
      await this.customer(local);
      const existing = await sdk.subscriptions.list({ customer: local.stripeCustomerId!, status: 'all', limit: 100 });
      if (existing.has_more || existing.data.some(subscription => !['canceled', 'incomplete_expired'].includes(subscription.status))) throw new ConflictException('Stripe already has a subscription for this customer. Refresh or reconcile billing before starting another Checkout.');
      if (!attempt.sessionId && Date.now() - attempt.createdAt.getTime() > 23 * 3600000) throw new ConflictException('Unresolved Checkout request requires reconciliation.');
      const metadata = { ...this.metadata(local), vantaraPlan: attempt.plan };
      const session = attempt.sessionId ? await sdk.checkout.sessions.retrieve(attempt.sessionId) : await sdk.checkout.sessions.create({
        mode: 'subscription', customer: local.stripeCustomerId!, line_items: [{ price: attempt.priceId, quantity: 1 }], metadata, subscription_data: { metadata },
        success_url: attempt.successUrl, cancel_url: attempt.cancelUrl, expires_at: Math.floor(attempt.expiresAt.getTime() / 1000), integration_identifier: `vantara-billing-${[...createHash('sha256').update(attempt.id).digest().subarray(0, 8)].map(byte => String.fromCharCode(97 + byte % 26)).join('')}`,
      }, { idempotencyKey: `vantara-checkout-${attempt.id}` });
      if (session.livemode || session.mode !== 'subscription' || idOf(session.customer) !== local.stripeCustomerId || session.metadata?.vantaraTenantId !== tenantId || session.metadata?.vantaraSubscriptionId !== local.id) throw new ConflictException('Invalid Checkout identity.');
      if (session.status !== 'open') throw new ConflictException('Checkout is no longer open. Refresh billing and retry.');
      const url = stripeUrl(session.url, 'checkout.stripe.com');
      if (!attempt.sessionId) {
        await tx.stripeCheckoutAttempt.update({ where: { id: attempt.id }, data: { sessionId: session.id } });
        await auditMutation(tx, tenantId, AuditAction.BILLING_CHANGE, 'subscription', local.id, { plan, reason: 'CHECKOUT_CREATED' });
      }
      return { url };
    });
  }
  async portal(userId: string, tenantId: string) {
    try { return await this.createPortal(userId, tenantId); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Unable to open Stripe billing management. Retry safely.');
    }
  }
  private async createPortal(userId: string, tenantId: string) {
    await this.authorize(userId, tenantId, true);
    const sdk = this.stripe.sdk(); const returnUrl = this.stripe.url('BILLING_PORTAL_RETURN_URL');
    return this.transaction(async tx => {
      const local = await this.local(tx, tenantId); await this.lock(tx, local.id);
      const customer = await this.customer(local);
      const session = await sdk.billingPortal.sessions.create({ customer: customer.id, return_url: returnUrl });
      const url = stripeUrl(session.url, 'billing.stripe.com');
      await auditMutation(tx, tenantId, AuditAction.BILLING_CHANGE, 'subscription', local.id, { reason: 'PORTAL_CREATED' });
      return { url };
    });
  }
  private eventSubscription(event: Stripe.Event): { subscriptionId: string | null; customerId: string | null; metadata?: Stripe.Metadata | null } {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') throw new BadRequestException('Unsupported Checkout mode.');
      return { subscriptionId: idOf(session.subscription), customerId: idOf(session.customer), metadata: session.metadata };
    }
    if (event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object as Stripe.Subscription;
      return { subscriptionId: subscription.id, customerId: idOf(subscription.customer), metadata: subscription.metadata };
    }
    const invoice = event.data.object as Stripe.Invoice;
    return { subscriptionId: idOf(invoice.parent?.subscription_details?.subscription), customerId: idOf(invoice.customer) };
  }
  async handleEvent(event: Stripe.Event) {
    // Only verified events enter from the public controller. Defense in depth for callers.
    if (event.livemode !== false || !/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') || typeof event.type !== 'string' || !event.data?.object) throw new BadRequestException('Invalid test-mode Stripe event.');
    await this.prisma.stripeWebhookEvent.upsert({ where: { stripeEventId: event.id }, create: { stripeEventId: event.id, type: event.type }, update: {} });
    try {
      return await this.transaction(async tx => {
        await this.lock(tx, `event:${event.id}`);
        const record = await tx.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
        if (record.type !== event.type) throw new BadRequestException('Stripe event identity mismatch.');
        if (record.status === 'PROCESSED' || record.status === 'IGNORED') return { received: true };
        if (!supportedEvents.has(event.type)) {
          await tx.stripeWebhookEvent.update({ where: { id: record.id }, data: { status: 'IGNORED', processedAt: new Date(), lastError: null } });
          return { received: true };
        }
        const identity = this.eventSubscription(event);
        if (!identity.subscriptionId || !identity.customerId) throw new BadRequestException('Missing Stripe subscription identity.');
        const mapped = await tx.subscription.findUnique({ where: { stripeCustomerId: identity.customerId }, include: { tenant: { select: { type: true } } } });
        if (!mapped || mapped.tenant.type !== 'HOTEL') throw new BadRequestException('Unrecognized hotel customer mapping.');
        await this.lock(tx, mapped.id);
        const local = await this.local(tx, mapped.tenantId);
        if (local.stripeCustomerId !== identity.customerId) throw new BadRequestException('Stripe customer mapping changed.');
        const current = await this.stripe.sdk().subscriptions.retrieve(identity.subscriptionId);
        if (current.livemode || current.id !== identity.subscriptionId || idOf(current.customer) !== local.stripeCustomerId || current.metadata.vantaraTenantId !== local.tenantId || current.metadata.vantaraSubscriptionId !== local.id) throw new BadRequestException('Foreign Stripe subscription mapping.');
        if (identity.metadata && (identity.metadata.vantaraTenantId !== local.tenantId || identity.metadata.vantaraSubscriptionId !== local.id)) throw new BadRequestException('Foreign Stripe event mapping.');
        await this.customer(local);
        if (local.stripeSubscriptionId && local.stripeSubscriptionId !== current.id) throw new BadRequestException('Another Stripe subscription is already linked.');
        const items = current.items.data;
        if (current.items.has_more || items.length !== 1 || items[0].quantity !== 1 || items[0].price.livemode) throw new BadRequestException('Unsupported Stripe subscription items.');
        const prices = this.stripe.prices();
        const plan = SELF_SERVICE_PLANS.find(plan => prices[plan] === items[0].price.id);
        if (!plan) throw new BadRequestException('Unknown Stripe subscription price.');
        const status = stripeStatus(current.status);
        const start = items[0].current_period_start; const end = items[0].current_period_end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) throw new BadRequestException('Invalid Stripe billing period.');
        const data = { stripeSubscriptionId: current.id, plan, status, currentPeriodStart: new Date(start * 1000), currentPeriodEnd: new Date(end * 1000), cancelAtPeriodEnd: current.cancel_at_period_end };
        const changed = local.stripeSubscriptionId !== current.id || local.plan !== plan || local.status !== status || local.cancelAtPeriodEnd !== data.cancelAtPeriodEnd || local.currentPeriodStart?.getTime() !== data.currentPeriodStart.getTime() || local.currentPeriodEnd?.getTime() !== data.currentPeriodEnd.getTime();
        if (changed) {
          await tx.subscription.update({ where: { id: local.id }, data });
          await auditMutation(tx, local.tenantId, AuditAction.BILLING_CHANGE, 'subscription', local.id, { plan, previousStatus: local.status, status, cancelAtPeriodEnd: data.cancelAtPeriodEnd });
        }
        await tx.stripeWebhookEvent.update({ where: { id: record.id }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
        return { received: true };
      });
    } catch (error) {
      // Never persist provider error text, stack, payload or payment information.
      await this.prisma.stripeWebhookEvent.updateMany({ where: { stripeEventId: event.id, status: { notIn: ['PROCESSED', 'IGNORED'] } }, data: { status: 'FAILED', lastError: error instanceof BadRequestException ? 'BILLING_IDENTITY_OR_STATE_REJECTED' : 'BILLING_PROCESSING_FAILED' } });
      throw new ServiceUnavailableException('Stripe event processing failed. Safe retry is available.');
    }
  }
}
