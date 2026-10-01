# Vantara Billing & Commerce

Vantara has two distinct financial domains.

## Vantara Billing

**Hotel -> Zuitzero**

Initial subscription plans:

| Plan | Monthly price | Positioning |
|---|---:|---|
| Lobby | MXN $2,999 | Organize the hotel |
| Suite | MXN $5,999 | Connect the hotel |
| Grand | MXN $7,999 | Intelligent + connected hotel |

Stripe Billing is the initial provider for recurring subscriptions.

Vantara stores its own subscription state and maps it to provider identifiers. Stripe processes the payment; Vantara determines product entitlements and tenant access.

## Vantara Commerce

**Guest -> Hotel**

Guests may pay for reservations, deposits, room service, hotel services, experiences, and other eligible charges.

Stripe Connect is the initial direction for routing guest payments to participating hotels.

Every transaction must retain Vantara business context:

- tenant/property
- guest
- reservation or order
- room when applicable
- amount and currency
- payment status
- refund status
- provider references

Stripe objects must not become Vantara's business-domain model.

## Core payment entities

Initial conceptual entities:

- Subscription
- Invoice
- Payment
- Transaction
- Refund
- CheckoutSession
- Order
- Payout

## Critical rules

1. Hotel subscription payments belong economically to Zuitzero/Vantara.
2. Guest reservation and service payments belong economically to the hotel, subject to the commercial and payment-provider arrangement.
3. Never trust the frontend to declare payment success.
4. Provider webhooks must be verified and processed idempotently.
5. Payment state changes must be auditable.
6. Money must use exact decimal/numeric representations, never floating-point database values.
7. Refunds and cancellations must be represented explicitly.
8. Entitlements are determined by Vantara, not by a client-side plan selector.

## Subscription lifecycle

```text
Landing / Demo
      -> Register
      -> Create Tenant
      -> Select Plan
      -> Stripe Checkout
      -> Verified webhook
      -> Vantara Subscription ACTIVE
      -> Entitlements applied
      -> Workspace access
```

Plan changes update entitlements without creating a new tenant or user identity.

## Guest payment lifecycle

```text
Guest
  -> Availability
  -> Reservation
  -> Checkout
  -> Payment provider
  -> Verified webhook
  -> Payment recorded
  -> Reservation confirmed
  -> Hotel notified
```

The authorization/capture model will depend on the hotel's reservation policy.

## Provider boundary

Payment providers sit behind a provider boundary so regional or alternative providers can be added later without coupling Vantara domain logic to Stripe-specific objects.

```text
PaymentProvider
   +-- StripeBilling
   +-- StripeConnect
   +-- FutureProvider
```
