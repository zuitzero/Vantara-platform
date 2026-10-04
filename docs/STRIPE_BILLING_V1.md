# Stripe Billing v1

HOTEL self-service subscriptions use Stripe-hosted Checkout and Customer Portal.
All payment calls run in the API through the official Node SDK 22.6.0, pinned to
API `2026-08-26.dahlia`. No live-mode keys/events are accepted by this version.
Use an isolated Stripe sandbox; ordinary tests use deterministic mocks, never
Stripe network calls. No production deployment or database migration was applied.

## Authorization and endpoints

All routes have the existing `/api` prefix.

| Route | Policy | Response |
| --- | --- | --- |
| `GET /billing/subscription` | Authenticated active HOTEL, HOTEL_ADMIN, billing.read | Persisted plan/status/period dates/cancellation and customer/subscription presence booleans |
| `POST /billing/checkout` | Same scope, billing.manage; body only `{plan: LOBBY\|SUITE\|GRAND}` | `{url}` for hosted Checkout |
| `POST /billing/portal` | Same scope, billing.manage; empty body | `{url}` for Customer Portal |
| `POST /billing/webhooks/stripe` | Public; raw body + valid Stripe signature + test-mode event | `{received:true}` after durable processing |

HOTEL_ADMIN now has billing.manage, as explicitly requested for this feature.
`AGENTS.md` reflects that HOTEL exception. HOTEL_STAFF receives neither billing
read nor manage. Existing OWNER/PLATFORM write helper and ZUITZERO_ADMIN platform
read permissions are unchanged; these HOTEL endpoints do not grant cross-tenant
platform capabilities. There is no body/path tenant selector. The authenticated
session determines ownership, and service-level RBAC checks revalidate membership.
Global DTO validation rejects tenantId, Price IDs, customer/subscription IDs,
metadata and SIGNATURE. URLs and prices are server-owned configuration.

## Configuration / local sandbox

Copy `apps/api/.env.example` to the API's environment file; configure:

- `STRIPE_SECRET_KEY`: sandbox/test secret (`sk_test_`) or restricted test key
  (`rk_test_`) with Customers read/write, Checkout read/write, Subscriptions read
  and Billing Portal session creation permissions. Never client-visible.
- `STRIPE_WEBHOOK_SECRET`: endpoint-specific `whsec_` signing secret.
- `STRIPE_PRICE_LOBBY`, `STRIPE_PRICE_SUITE`, `STRIPE_PRICE_GRAND`: distinct,
  active recurring test prices, one item with quantity one per subscription.
- `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`, `BILLING_PORTAL_RETURN_URL`:
  trusted application URLs. HTTPS required except localhost / 127.0.0.1 HTTP.
  Default local URLs use `/?billing=returned` or `/?billing=canceled` so the
  Hotel Command Center opens Billing and reloads persisted state on return.

The server checks required checkout configuration before customer creation.
Configure products/prices manually in the sandbox; startup creates no catalog.
The reverse price mapping is the only plan authority. Unknown prices, duplicate
mapping, extra subscription items, live data and unknown statuses fail safely.
No automatic tax, discounts, payment method allowlist, metering or Connect.

Apply the forward migration with normal repository deployment procedures, then
run the API and Web. Forward local sandbox webhooks using Stripe CLI:

```sh
stripe listen --forward-to localhost:3001/api/billing/webhooks/stripe
```

Set the signing secret printed by that listener, rather than the secret for a
Dashboard endpoint. Log into a sandbox HOTEL_ADMIN, open Billing, choose a plan,
complete hosted Checkout with Stripe test payment data, then refresh Billing.
The return URL never sets payment state; delayed webhook delivery may require
another refresh. Use Portal and verify scheduled cancellation and period end.

Configure Portal in the same sandbox account: payment method management, history
and cancellation at period end. Disable plan changes unless restricted to these
three configured recurring prices, single-item subscriptions and quantity one.
Unrecognized Portal plans are intentionally rejected during sync. Portal features
and cancellation policy are account configuration, not silently created here.

## Customer and Checkout lifecycle

`Subscription.stripeCustomerId` remains the unique persistent customer mapping.
Both customer and subscription metadata contain server-controlled
`vantaraTenantId` and `vantaraSubscriptionId`; Checkout and subscription metadata
also record the chosen `vantaraPlan` for diagnostics, never plan authority.

Before the first customer API call, persist `stripeCustomerRequestedAt`. Use a
stable customer idempotency key derived from the local subscription ID. Each
subsequent call verifies the customer is non-deleted, test mode, and matches both
local identifiers. A deleted, missing or foreign customer is not replaced or
attached from client data: reconciliation is required.

Persist one `StripeCheckoutAttempt` per local subscription before creating an
external session: fixed plan, price, trusted URLs, expiration and attempt ID.
Use that ID as the Stripe idempotency key. A PostgreSQL transaction-scoped
advisory lock serializes customer creation, checkout attempt reservation,
session creation and webhook updates for that subscription. Repeated/concurrent
requests reuse the customer and open session. Before returning or creating
Checkout, the API also lists existing Stripe subscriptions for this customer;
nonterminal subscriptions or an ambiguous paginated result block new Checkout
even when the local subscription linkage has not synchronized. A competing plan waits for the
open session to expire. A completed session cannot create a second subscription
while its webhook is pending. Once a retrieved session is expired, a fresh
attempt can be reserved; different attempts cannot have overlapping sessions.
Sessions expire after one hour. Uncertain outcomes retry the same frozen key.
After 23 hours, an unresolved creation without a persisted Stripe ID requires
manual reconciliation; never blindly issue a fresh key after Stripe's minimum
24-hour idempotency retention. Inspect sandbox Stripe requests/metadata and the
local attempt before repairing a mapping; never clear it and blindly recreate.

A linked subscription routes management to Portal, including canceled ones.
A separate safe resubscription flow after terminal cancellation is follow-up work.
There is no additional Stripe trial configured. Existing internal TRIALING rows
and dates survive migration and Checkout creation. Only verified subscription
truth changes local plan/status/periods or attaches a Stripe subscription ID.

## Webhook integrity, coverage and ordering

Nest retains raw request bytes (`rawBody:true`) while keeping ordinary JSON
parsing and strict DTO validation. `constructEvent` verifies the Stripe header
with the configured secret and SDK timestamp tolerance. Missing/invalid
signatures and malformed/live events return 400; no event row is written.
Missing secret/key configuration prevents processing. No payload, card data,
provider error text, hosted URLs or secrets enter audit records.

Covered events:

- checkout.session.completed: validate subscription-mode linkage, retrieve
  current Stripe subscription, synchronize its actual state (not automatic ACTIVE).
- customer.subscription.created / updated / deleted: retrieve and synchronize
  current subscription plan, status, item period dates and cancel_at_period_end.
- invoice.paid / invoice.payment_failed: resolve `parent.subscription_details`
  and retrieve current subscription. An old failure cannot overwrite recovery;
  a paid invoice cannot force ACTIVE on a currently unhealthy subscription.

`StripeWebhookEvent` stores unique event ID, type, RECEIVED/FAILED/PROCESSED/IGNORED
state, processing date and a generic safe error code. Unsupported signed event
types are recorded IGNORED without changes. Supported events require a known
customer mapping and cross-check event customer/metadata, current subscription
customer/metadata, local Subscription and HOTEL tenant. Invoice payload metadata
is not sufficient authority. A different already-linked subscription is rejected.

Processing locks the event then the subscription. The Stripe current-state read
occurs inside the subscription lock, preventing a prefetched stale snapshot from
being applied after a newer local commit. Database event uniqueness and locks
prevent duplicate updates across API processes. Subscription change, safe audit
and processed state commit atomically. Failure rolls them back; a separate
conditional update records FAILED without overwriting concurrent success. HTTP
503 requests a Stripe retry. Failed events remain eligible for processing.
Provider outages never result in fake successful state.

Current reads remove dependence on event delivery order, including subscription
updates before Checkout completion and delayed failed invoices after payment.
Stripe can still change remotely during a read/commit; the next delivery converges.
No exactly-once distributed transaction spans Stripe and PostgreSQL. Persistent
creation attempts plus provider keys recover external-success/local-rollback
outcomes. API transactions hold locks during provider calls, capped at 60 seconds
with bounded SDK timeout/retry; monitor contention before scaling.

## Status and audit

| Stripe | Vantara |
| --- | --- |
| trialing | TRIALING |
| active | ACTIVE |
| past_due / unpaid | PAST_DUE |
| incomplete | INCOMPLETE |
| paused | PAUSED |
| canceled / incomplete_expired | CANCELED |

An unknown status fails; it never becomes ACTIVE. Periods come from the sole
subscription item in this Stripe API version. Scheduled cancellation remains
ACTIVE when Stripe is ACTIVE. No operational entitlement shutdown is introduced.

Existing BILLING_VIEW / BILLING_CHANGE actions are reused. Audit records include
successful state reads, initial Checkout creation, Portal session creation and
meaningful persisted state transitions (including period/cancellation changes).
State transition metadata contains only plan, previousStatus, status and
cancelAtPeriodEnd; session audits contain plan/reason. Human actions use existing
authenticated audit context, webhooks use SYSTEM, always tenant scoped. Duplicate
or unchanged deliveries do not duplicate transition audit.

## Validation and rollout

Tests exercise the real Nest HTTP boundary with strict validation/guards/raw
bytes and actual SDK signing helpers; Stripe API methods and DB are mocked.
They cover RBAC, client ownership rejection, tenant mappings, customer/session
reuse, concurrent duplicate deliveries, rollback/retry, unknown prices/statuses,
invoice ordering, Portal prerequisites and audit sanitization. An in-memory
transaction queue models locks; it does not prove PostgreSQL concurrency behavior.

Run canonical Prisma generate, API test/build and Web build. Before any release:

1. Review this forward migration and apply it in a disposable PostgreSQL sandbox;
   exercise concurrent API instances, unique indexes, advisory locks and rollback.
2. Verify restricted test-key permissions, catalog mapping, configured URLs and
   Portal cancellation/plan settings in an isolated sandbox.
3. Exercise success, incomplete/failed payments, recovery, scheduled/end-of-period
   cancellation, signed duplicates and out-of-order deliveries end to end.
4. Configure and verify the six supported webhook event types on the correct API
   version. Do not log payloads or signature/secrets in proxies/error tooling.
5. Set monitoring for FAILED/unprocessed events, retries, unresolved attempts and
   transaction timeouts. Define retention/reconciliation runbooks.
6. Review pricing/business rules, safe resubscription and entitlement policy.
7. A later explicitly reviewed change must enable live-mode keys/events and
   production catalog/configuration; this version deliberately refuses them.

Known debt: no scheduled reconciliation/backfill job, event retention policy or
administrative replay UI; no terminal-subscription reactivation; no entitlement
shutdown; unknown/foreign or historically unlinked subscriptions require manual
reconciliation. Portal has no server-created configuration, so operators must
restrict plans/cancellation themselves. No durable outbox is added. A webhook
before customer mapping commits fails safely and depends on Stripe retry. No
real Stripe calls, browser Checkout run or PostgreSQL migration were performed
by the mocked unit suite. SIGNATURE, refunds, Connect, Tax, custom invoices and
metering remain outside this feature.

References: [Checkout subscriptions](https://docs.stripe.com/billing/quickstart),
[webhook signatures](https://docs.stripe.com/webhooks/signature),
[webhook ordering and retries](https://docs.stripe.com/webhooks),
[idempotent requests](https://docs.stripe.com/api/idempotent_requests),
[Customer Portal](https://docs.stripe.com/customer-management).

Implementation validation: Prisma generation, 282 API tests across 16 suites
(66 new billing tests), API build and Web build passed. Prisma's schema diff
matches the new migration. No migration was applied to a running database.
