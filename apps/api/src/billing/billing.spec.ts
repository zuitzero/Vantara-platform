import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Stripe = require('stripe');
import { BillingModule } from './billing.module';
import { BillingService, stripeStatus } from './billing.service';
import { StripeProvider } from './stripe.provider';
import { PrismaService } from '../prisma/prisma.service';
import { RbacModule } from '../rbac/rbac.module';
import { AuthService } from '../auth/auth.service';
import { safeAuditMetadata } from '../rbac/audit.service';

const realStripe = new Stripe('sk_test_mock_only');
const environment = { STRIPE_SECRET_KEY: 'sk_test_mock_only', STRIPE_WEBHOOK_SECRET: 'whsec_mock_only', STRIPE_PRICE_LOBBY: 'price_lobby', STRIPE_PRICE_SUITE: 'price_suite', STRIPE_PRICE_GRAND: 'price_grand', BILLING_SUCCESS_URL: 'http://localhost:3000/?billing=returned', BILLING_CANCEL_URL: 'http://localhost:3000/?billing=canceled', BILLING_PORTAL_RETURN_URL: 'http://localhost:3000/?billing=returned' };
const metadata = (tenant = 'hotel-a') => ({ vantaraTenantId: tenant, vantaraSubscriptionId: `local-${tenant}` });
const customer = (tenant = 'hotel-a') => ({ id: `cus_${tenant}`, object: 'customer', livemode: false, metadata: metadata(tenant) });
function currentSubscription(tenant = 'hotel-a', status = 'active') {
  return { id: `sub_${tenant}`, object: 'subscription', customer: `cus_${tenant}`, livemode: false, metadata: metadata(tenant), status, cancel_at_period_end: false,
    items: { has_more: false, data: [{ quantity: 1, current_period_start: 1791000000, current_period_end: 1793600000, price: { id: 'price_suite', livemode: false } }] } };
}
function subscriptionEvent(type = 'customer.subscription.updated', id = 'evt_test', tenant = 'hotel-a') {
  return { id, object: 'event', type, livemode: false, data: { object: currentSubscription(tenant) } } as unknown as Stripe.Event;
}
function invoiceEvent(type: string, id: string) {
  return { id, object: 'event', type, livemode: false, data: { object: { object: 'invoice', customer: 'cus_hotel-a', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_hotel-a' } } } } } as unknown as Stripe.Event;
}

// Transactional in-memory DB restores writes on rollback; a queue represents the
// database locks. Real PostgreSQL lock behavior still needs a deployment smoke test.
function database() {
  const local = (tenantId: string) => ({ id: `local-${tenantId}`, tenantId, plan: 'LOBBY', status: 'TRIALING', stripeCustomerId: null, stripeSubscriptionId: null, stripeCustomerRequestedAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, createdAt: new Date(), updatedAt: new Date() });
  let state: any = { subscriptions: [local('hotel-a'), local('hotel-b')], attempts: [], events: [], audits: [] };
  let queue: Promise<unknown> = Promise.resolve();
  const db: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    membership: { findUnique: jest.fn(async ({ where }: any) => {
      const { userId, tenantId } = where.userId_tenantId;
      if (userId === 'staff' && tenantId === 'hotel-a') return { role: 'HOTEL_STAFF', tenant: { type: 'HOTEL' } };
      if (userId === 'platform' && tenantId === 'platform') return { role: 'ZUITZERO_ADMIN', tenant: { type: 'PLATFORM' } };
      if (userId === 'owner' && tenantId === 'platform') return { role: 'OWNER', tenant: { type: 'PLATFORM' } };
      if (userId === `admin-${tenantId}`) return { role: 'HOTEL_ADMIN', tenant: { type: 'HOTEL' } };
      return null;
    }) },
    subscription: {
      findUnique: jest.fn(async ({ where, include }: any) => { const row = state.subscriptions.find((row: any) => Object.entries(where).every(([key, val]) => row[key] === val)); return row ? { ...row, ...(include ? { tenant: { type: 'HOTEL' } } : {}) } : null; }),
      update: jest.fn(async ({ where, data }: any) => { const row = state.subscriptions.find((row: any) => row.id === where.id); Object.assign(row, data); return { ...row }; }),
    },
    stripeCheckoutAttempt: {
      findUnique: jest.fn(async ({ where }: any) => state.attempts.find((row: any) => row.subscriptionId === where.subscriptionId) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const row = state.attempts.find((row: any) => row.subscriptionId === where.subscriptionId); if (!row) throw new Error('Missing attempt'); return row; }),
      create: jest.fn(async ({ data }: any) => { const row = { ...data, id: `attempt-${state.attempts.length}`, createdAt: new Date(), sessionId: null }; state.attempts.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = state.attempts.find((row: any) => row.id === where.id); Object.assign(row, data); return row; }),
      delete: jest.fn(async ({ where }: any) => { state.attempts = state.attempts.filter((row: any) => row.id !== where.id); }),
    },
    stripeWebhookEvent: {
      upsert: jest.fn(async ({ where, create }: any) => { let row = state.events.find((row: any) => row.stripeEventId === where.stripeEventId); if (!row) { row = { ...create, id: `record-${state.events.length}`, status: 'RECEIVED', processedAt: null, lastError: null }; state.events.push(row); } return row; }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => state.events.find((row: any) => row.stripeEventId === where.stripeEventId)),
      update: jest.fn(async ({ where, data }: any) => { const row = state.events.find((row: any) => row.id === where.id); Object.assign(row, data); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = state.events.find((row: any) => row.stripeEventId === where.stripeEventId && !where.status.notIn.includes(row.status)); if (row) Object.assign(row, data); return { count: row ? 1 : 0 }; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { state.audits.push(data); return data; }) },
    $transaction: jest.fn((operation: any) => {
      const result = queue.then(async () => { const before = structuredClone(state); try { return await operation(db); } catch (error) { state = before; throw error; } });
      queue = result.catch(() => undefined); return result;
    }),
    state: () => state,
  };
  return db;
}

describe('Hotel Stripe billing boundary', () => {
  let app: INestApplication; let base: string; let db: any; let sdk: any; let service: BillingService;
  const originalEnv = { ...process.env };
  beforeEach(async () => {
    Object.assign(process.env, environment); db = database();
    sdk = {
      webhooks: realStripe.webhooks,
      customers: { create: jest.fn(async ({ metadata: meta }: any) => customer(meta.vantaraTenantId)), retrieve: jest.fn(async (id: string) => customer(id.replace('cus_', ''))) },
      subscriptions: { retrieve: jest.fn().mockResolvedValue(currentSubscription()), list: jest.fn().mockResolvedValue({ has_more: false, data: [] }) },
      checkout: { sessions: {
        create: jest.fn(async (params: any) => ({ id: 'cs_mock', status: 'open', mode: 'subscription', customer: params.customer, livemode: false, metadata: params.metadata, url: 'https://checkout.stripe.com/c/pay/mock' })),
        retrieve: jest.fn(async () => ({ id: 'cs_mock', status: 'open', mode: 'subscription', customer: 'cus_hotel-a', livemode: false, metadata: metadata(), url: 'https://checkout.stripe.com/c/pay/mock' })),
      } },
      billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/session/mock' }) } },
    };
    const provider = new StripeProvider(); jest.spyOn(provider, 'sdk').mockImplementation(() => {
      if (!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')) throw new Error('Test configuration required');
      return sdk;
    });
    const module = await Test.createTestingModule({ imports: [RbacModule, BillingModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(StripeProvider).useValue(provider).overrideProvider(AuthService).useValue({ getWorkspace: async (token: string) => {
      const tenantId = token === 'admin-b' ? 'hotel-b' : ['owner', 'platform'].includes(token) ? 'platform' : 'hotel-a';
      const userId = token === 'staff' ? 'staff' : ['owner', 'platform'].includes(token) ? token : `admin-${tenantId}`;
      return { user: { id: userId }, tenant: { id: tenantId }, membership: { id: token, role: token === 'staff' ? 'HOTEL_STAFF' : 'HOTEL_ADMIN' } };
    } }).compile();
    app = module.createNestApplication({ rawBody: true }); app.useLogger(false);
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl(); service = module.get(BillingService);
  });
  afterEach(async () => { await app?.close(); process.env = { ...originalEnv }; });
  const post = (path: string, body: unknown, token = 'admin-a') => fetch(`${base}/api/billing/${path}`, { method: 'POST', headers: { cookie: `vantara_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const mapped = (tenant = 'hotel-a') => { db.state().subscriptions.find((row: any) => row.tenantId === tenant).stripeCustomerId = `cus_${tenant}`; };
  const signed = (event: Stripe.Event) => {
    const payload = JSON.stringify(event); const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret: environment.STRIPE_WEBHOOK_SECRET });
    return fetch(`${base}/api/billing/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload });
  };

  it('exposes only active-tenant persisted safe billing truth and audits the view', async () => {
    db.state().subscriptions[1].plan = 'GRAND';
    const response = await fetch(`${base}/api/billing/subscription?tenantId=hotel-b`, { headers: { cookie: 'vantara_session=admin-a' } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ plan: 'LOBBY', status: 'TRIALING', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, hasStripeCustomer: false, hasStripeSubscription: false });
    expect(db.state().audits[0]).toMatchObject({ tenantId: 'hotel-a', actorUserId: 'admin-hotel-a', action: 'BILLING_VIEW' });
  });
  it.each(['checkout', 'portal'])('denies HOTEL_STAFF %s before any Stripe call', async path => {
    expect((await post(path, path === 'checkout' ? { plan: 'SUITE' } : {}, 'staff')).status).toBe(403);
    expect(sdk.customers.create).not.toHaveBeenCalled(); expect(sdk.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
  it.each(['owner', 'platform'])('does not mix %s platform billing with HOTEL endpoints', async token => { expect((await post('checkout', { plan: 'SUITE' }, token)).status).toBe(403); });
  it.each([{ plan: 'SUITE', tenantId: 'hotel-b' }, { plan: 'SUITE', priceId: 'price_evil' }, { plan: 'SUITE', stripeCustomerId: 'cus_other' }, { plan: 'SUITE', metadata: { vantaraTenantId: 'hotel-b' } }, { plan: 'SIGNATURE' }, { plan: 'price_suite' }])('rejects untrusted checkout body %j', async body => {
    expect((await post('checkout', body)).status).toBe(400); expect(sdk.customers.create).not.toHaveBeenCalled();
  });
  it('rejects client ownership on portal', async () => { expect((await post('portal', { tenantId: 'hotel-b' })).status).toBe(400); });
  it('requires authentication', async () => { expect((await fetch(`${base}/api/billing/subscription`)).status).toBe(401); });
  it.each(['STRIPE_PRICE_SUITE', 'BILLING_SUCCESS_URL', 'BILLING_CANCEL_URL'])('fails safely with missing %s before customer creation', async key => {
    delete process.env[key]; expect((await post('checkout', { plan: 'SUITE' })).status).toBe(503); expect(sdk.customers.create).not.toHaveBeenCalled();
  });
  it('creates one customer/session under concurrent checkout requests, preserves trial until webhook', async () => {
    const responses = await Promise.all([post('checkout', { plan: 'SUITE' }), post('checkout', { plan: 'SUITE' })]);
    expect(responses.map(response => response.status)).toEqual([201, 201]); expect(sdk.customers.create).toHaveBeenCalledTimes(1); expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(db.state().subscriptions[0].status).toBe('TRIALING'); expect(db.state().subscriptions[0].stripeSubscriptionId).toBeNull(); expect(db.state().subscriptions[1].stripeCustomerId).toBeNull();
    expect(sdk.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ mode: 'subscription', customer: 'cus_hotel-a', line_items: [{ price: 'price_suite', quantity: 1 }], subscription_data: { metadata: { ...metadata(), vantaraPlan: 'SUITE' } } });
    expect(sdk.checkout.sessions.create.mock.calls[0][0].subscription_data.trial_period_days).toBeUndefined();
    expect(db.state().audits.filter((row: any) => row.metadata.reason === 'CHECKOUT_CREATED')).toHaveLength(1);
  });
  it('reuses existing customer and freezes Checkout parameters', async () => {
    mapped(); await post('checkout', { plan: 'SUITE' }); process.env.BILLING_SUCCESS_URL = 'https://changed.example/'; await post('checkout', { plan: 'SUITE' });
    expect(sdk.customers.create).not.toHaveBeenCalled(); expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(db.state().attempts[0].successUrl).toBe(environment.BILLING_SUCCESS_URL);
  });
  it('rejects competing plan while open, and completed checkout cannot create a second subscription', async () => {
    await post('checkout', { plan: 'SUITE' }); expect((await post('checkout', { plan: 'GRAND' })).status).toBe(409);
    sdk.checkout.sessions.retrieve.mockResolvedValue({ status: 'complete', customer: 'cus_hotel-a', livemode: false, metadata: metadata() });
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409); expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('blocks checkout after a linked subscription, including canceled ones', async () => {
    mapped(); Object.assign(db.state().subscriptions[0], { stripeSubscriptionId: 'sub_hotel-a', status: 'CANCELED' });
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409); expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('never replaces a deleted or foreign customer', async () => {
    mapped(); sdk.customers.retrieve.mockResolvedValue({ id: 'cus_hotel-a', deleted: true });
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409); expect(sdk.customers.create).not.toHaveBeenCalled(); expect(db.state().subscriptions[0].stripeCustomerId).toBe('cus_hotel-a');
  });
  it('uses the same persistent customer idempotency key after an ambiguous failure', async () => {
    sdk.customers.create.mockRejectedValueOnce(new Error('provider token sensitive'));
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(503);
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(201);
    expect(sdk.customers.create.mock.calls.map((call: any) => call[1].idempotencyKey)).toEqual(['vantara-customer-local-hotel-a', 'vantara-customer-local-hotel-a']);
  });
  it('does not retry unresolved customer creation beyond safe idempotency retention', async () => {
    db.state().subscriptions[0].stripeCustomerRequestedAt = new Date(Date.now() - 24 * 3600000);
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409); expect(sdk.customers.create).not.toHaveBeenCalled();
  });
  it('recovers external Checkout after local audit rollback with same attempt key', async () => {
    db.auditLog.create.mockRejectedValueOnce(new Error('audit down'));
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(503);
    expect(db.state().attempts[0].sessionId).toBeNull();
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(201);
    expect(sdk.checkout.sessions.create.mock.calls[0][1]).toEqual(sdk.checkout.sessions.create.mock.calls[1][1]);
  });
  it('blocks a second paid subscription when current Stripe truth has not linked locally', async () => {
    mapped(); sdk.subscriptions.list.mockResolvedValue({ has_more: false, data: [currentSubscription()] });
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409); expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('reconciles a missed webhook from authoritative Stripe state', async () => {
    mapped(); sdk.subscriptions.list.mockResolvedValue({ has_more: false, data: [currentSubscription()] });
    const response = await post('reconcile', {}); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ plan: 'SUITE', status: 'ACTIVE', hasStripeCustomer: true, hasStripeSubscription: true });
    expect(db.state().subscriptions[0]).toMatchObject({ plan: 'SUITE', status: 'ACTIVE', stripeSubscriptionId: 'sub_hotel-a' });
    expect(sdk.subscriptions.retrieve).toHaveBeenCalledWith('sub_hotel-a');
    expect(db.state().audits.some((row: any) => row.action === 'BILLING_CHANGE' && row.metadata.reason === 'STRIPE_RECONCILED')).toBe(true);
  });
  it('reconciliation is a no-op when local Stripe linkage is already complete', async () => {
    mapped(); Object.assign(db.state().subscriptions[0], { stripeSubscriptionId: 'sub_hotel-a', status: 'ACTIVE', plan: 'SUITE' });
    const response = await post('reconcile', {}); expect(response.status).toBe(201);
    expect(sdk.subscriptions.list).not.toHaveBeenCalled(); expect(sdk.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('refuses to guess when Stripe has multiple current subscriptions', async () => {
    mapped(); sdk.subscriptions.list.mockResolvedValue({ has_more: false, data: [currentSubscription(), { ...currentSubscription(), id: 'sub_second' }] });
    const response = await post('reconcile', {}); expect(response.status).toBe(409);
    expect(db.state().subscriptions[0]).toMatchObject({ status: 'TRIALING', stripeSubscriptionId: null }); expect(sdk.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('rejects a foreign existing customer before checkout or portal', async () => {
    mapped(); sdk.customers.retrieve.mockResolvedValue(customer('hotel-b'));
    expect((await post('checkout', { plan: 'SUITE' })).status).toBe(409);
    expect((await post('portal', {})).status).toBe(409); expect(sdk.customers.create).not.toHaveBeenCalled();
  });
  it('processes signed non-normalized raw bytes and rejects tampering', async () => {
    mapped(); const payload = JSON.stringify(subscriptionEvent(), null, 2) + '\n';
    const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret: environment.STRIPE_WEBHOOK_SECRET });
    const request = (body: string) => fetch(`${base}/api/billing/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body });
    expect((await request(payload + ' ')).status).toBe(400); expect(db.state().events).toHaveLength(0);
    expect((await request(payload)).status).toBe(200);
  });
  it('rejects unknown provider state without marking payment successful', async () => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription('hotel-a', 'future_unknown'));
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.state().subscriptions[0].status).toBe('TRIALING');
  });
  it.each([0, 2])('rejects unsupported subscription item quantity %s', async quantity => {
    mapped(); const current = currentSubscription(); current.items.data[0].quantity = quantity; sdk.subscriptions.retrieve.mockResolvedValue(current);
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.subscription.update).not.toHaveBeenCalled();
  });
  it('rejects live subscription data even inside a signed test event', async () => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue({ ...currentSubscription(), livemode: true });
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.subscription.update).not.toHaveBeenCalled();
  });
  it('portal requires a persisted customer and uses server-owned return URL', async () => {
    expect((await post('portal', {})).status).toBe(409); expect(sdk.customers.create).not.toHaveBeenCalled(); mapped();
    const response = await post('portal', {}); expect(response.status).toBe(201); expect(await response.json()).toEqual({ url: 'https://billing.stripe.com/p/session/mock' });
    expect(sdk.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_hotel-a', return_url: environment.BILLING_PORTAL_RETURN_URL });
  });
  it('rejects missing and invalid webhook signatures with no persistence', async () => {
    for (const headers of [{}, { 'stripe-signature': 'invalid' }]) {
      const response = await fetch(`${base}/api/billing/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } as Record<string, string>, body: JSON.stringify(subscriptionEvent()) }); expect(response.status).toBe(400);
    }
    expect(db.state().events).toHaveLength(0);
  });
  it('verifies raw-body signatures on the real HTTP route and deduplicates concurrent events', async () => {
    mapped(); const responses = await Promise.all([signed(subscriptionEvent()), signed(subscriptionEvent())]);
    expect(responses.map(response => response.status)).toEqual([200, 200]); expect(db.state().subscriptions[0]).toMatchObject({ status: 'ACTIVE', plan: 'SUITE', stripeSubscriptionId: 'sub_hotel-a' });
    expect(db.subscription.update).toHaveBeenCalledTimes(1); expect(db.state().events).toHaveLength(1); expect(db.state().events[0].status).toBe('PROCESSED');
    expect(db.state().audits).toHaveLength(1); expect(db.state().audits[0]).toMatchObject({ actorType: 'SYSTEM', tenantId: 'hotel-a', metadata: { status: 'ACTIVE', previousStatus: 'TRIALING', cancelAtPeriodEnd: false } });
  });
  it('rejects a signed live-mode or malformed event', async () => {
    expect((await signed({ ...subscriptionEvent(), livemode: true })).status).toBe(400);
    expect((await signed({ ...subscriptionEvent(), id: '' })).status).toBe(400); expect(db.state().events).toHaveLength(0);
  });
  it('foreign customer or subscription metadata cannot mutate either tenant', async () => {
    mapped(); mapped('hotel-b'); sdk.subscriptions.retrieve.mockResolvedValue({ ...currentSubscription(), metadata: metadata('hotel-b') });
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow('Safe retry'); expect(db.subscription.update).not.toHaveBeenCalled(); expect(db.state().events[0]).toMatchObject({ status: 'FAILED', processedAt: null });
  });
  it('rejects event customer A linked to a retrieved subscription/customer B', async () => {
    mapped(); mapped('hotel-b'); sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription('hotel-b'));
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.subscription.update).not.toHaveBeenCalled();
  });
  it('rejects an unrecognized customer rather than guessing from metadata', async () => {
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(sdk.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('rejects unknown prices and permits retry after config/state is corrected', async () => {
    mapped(); const unknown = currentSubscription(); unknown.items.data[0].price.id = 'price_unknown'; sdk.subscriptions.retrieve.mockResolvedValue(unknown);
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.state().subscriptions[0].status).toBe('TRIALING'); expect(db.state().events[0].status).toBe('FAILED');
    sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription()); await service.handleEvent(subscriptionEvent()); expect(db.state().events[0].status).toBe('PROCESSED');
  });
  it('does not substitute another subscription for a valid mapping', async () => {
    mapped(); db.state().subscriptions[0].stripeSubscriptionId = 'sub_other';
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.subscription.update).not.toHaveBeenCalled();
  });
  it.each(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'])('synchronizes current authoritative state for %s', async type => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue({ ...currentSubscription('hotel-a', type.endsWith('deleted') ? 'canceled' : 'past_due'), cancel_at_period_end: true });
    await service.handleEvent(subscriptionEvent(type)); expect(db.state().subscriptions[0]).toMatchObject({ status: type.endsWith('deleted') ? 'CANCELED' : 'PAST_DUE', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(1793600000000) });
  });
  it('checkout completion links but does not invent ACTIVE when Stripe is incomplete', async () => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription('hotel-a', 'incomplete'));
    const event = { ...subscriptionEvent('checkout.session.completed'), data: { object: { mode: 'subscription', subscription: 'sub_hotel-a', customer: 'cus_hotel-a', metadata: metadata() } } } as unknown as Stripe.Event;
    await service.handleEvent(event); expect(db.state().subscriptions[0].status).toBe('INCOMPLETE');
  });
  it('subscription.updated before checkout.completed works without ordering dependency', async () => {
    mapped(); await service.handleEvent(subscriptionEvent());
    await service.handleEvent({ ...subscriptionEvent('checkout.session.completed', 'evt_checkout'), data: { object: { mode: 'subscription', subscription: 'sub_hotel-a', customer: 'cus_hotel-a', metadata: metadata() } } } as unknown as Stripe.Event);
    expect(db.state().subscriptions[0].status).toBe('ACTIVE'); expect(db.state().audits).toHaveLength(1);
  });
  it('failed invoice follows current past_due; paid recovers; stale failed invoice cannot regress ACTIVE', async () => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription('hotel-a', 'past_due'));
    await service.handleEvent(invoiceEvent('invoice.payment_failed', 'evt_failed')); expect(db.state().subscriptions[0].status).toBe('PAST_DUE');
    sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription()); await service.handleEvent(invoiceEvent('invoice.paid', 'evt_paid')); expect(db.state().subscriptions[0].status).toBe('ACTIVE');
    await service.handleEvent(invoiceEvent('invoice.payment_failed', 'evt_oldfailed')); expect(db.state().subscriptions[0].status).toBe('ACTIVE'); expect(db.state().audits).toHaveLength(2);
  });
  it('invoice.paid cannot override a current unhealthy subscription', async () => {
    mapped(); sdk.subscriptions.retrieve.mockResolvedValue(currentSubscription('hotel-a', 'past_due')); await service.handleEvent(invoiceEvent('invoice.paid', 'evt_paid')); expect(db.state().subscriptions[0].status).toBe('PAST_DUE');
  });
  it('audit failure atomically rolls back subscription + event and allows retry', async () => {
    mapped(); db.auditLog.create.mockRejectedValueOnce(new Error('secret-provider-payload'));
    await expect(service.handleEvent(subscriptionEvent())).rejects.toThrow(); expect(db.state().subscriptions[0].status).toBe('TRIALING'); expect(db.state().events[0]).toMatchObject({ status: 'FAILED', lastError: 'BILLING_PROCESSING_FAILED', processedAt: null });
    await service.handleEvent(subscriptionEvent()); expect(db.state().subscriptions[0].status).toBe('ACTIVE'); expect(db.state().audits).toHaveLength(1);
  });
  it('ignores irrelevant signed events without Stripe mutations', async () => {
    await service.handleEvent(subscriptionEvent('payment_intent.succeeded')); expect(db.state().events[0].status).toBe('IGNORED'); expect(sdk.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it('billing audits exclude Stripe secrets, raw IDs, URLs and payloads', () => {
    expect(safeAuditMetadata({ plan: 'SUITE', status: 'ACTIVE', previousStatus: 'TRIALING', cancelAtPeriodEnd: true, secret: 'sk_test_secret', stripeCustomerId: 'cus_private', url: 'https://billing.stripe.com/private', payload: { card: '123' } })).toEqual({ plan: 'SUITE', status: 'ACTIVE', previousStatus: 'TRIALING', cancelAtPeriodEnd: true });
  });
});

describe('Stripe configuration and status mapping', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  it.each(['trialing', 'active', 'past_due', 'incomplete', 'paused', 'canceled', 'incomplete_expired', 'unpaid'])('explicitly maps %s', status => {
    const expected: Record<string, string> = { trialing: 'TRIALING', active: 'ACTIVE', past_due: 'PAST_DUE', incomplete: 'INCOMPLETE', paused: 'PAUSED', canceled: 'CANCELED', incomplete_expired: 'CANCELED', unpaid: 'PAST_DUE' }; expect(stripeStatus(status)).toBe(expected[status]);
  });
  it('does not map unknown status to ACTIVE', () => { expect(() => stripeStatus('future_unknown')).toThrow(); });
  it.each(['sk_live_unsafe', 'rk_live_unsafe', ''])('rejects non-test credentials %s', key => { process.env.STRIPE_SECRET_KEY = key; expect(() => new StripeProvider().sdk()).toThrow('test-mode'); });
  it('validates signature presence before SDK construction', () => { expect(() => new StripeProvider().verify(undefined, undefined)).toThrow('required'); });
  it('rejects missing webhook configuration', () => { delete process.env.STRIPE_WEBHOOK_SECRET; expect(() => new StripeProvider().verify(Buffer.from('{}'), 'invalid')).toThrow('configuration'); });
  it('rejects duplicate price configuration', () => { Object.assign(process.env, environment, { STRIPE_PRICE_GRAND: 'price_suite' }); expect(() => new StripeProvider().prices()).toThrow('distinct'); });
  it('rejects unsafe return URL protocols', () => { process.env.BILLING_SUCCESS_URL = 'javascript:alert(1)'; expect(() => new StripeProvider().url('BILLING_SUCCESS_URL')).toThrow('trusted'); });
});
