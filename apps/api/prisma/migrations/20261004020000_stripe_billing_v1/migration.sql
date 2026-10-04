-- Preserve existing internal trials and Stripe identities.
ALTER TABLE "subscriptions" ADD COLUMN "stripeCustomerRequestedAt" TIMESTAMP(3);
CREATE TABLE "stripe_checkout_attempts" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "plan" "PlanCode" NOT NULL,
  "priceId" TEXT NOT NULL,
  "successUrl" TEXT NOT NULL,
  "cancelUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_checkout_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stripe_checkout_attempts_subscriptionId_key" ON "stripe_checkout_attempts"("subscriptionId");
CREATE UNIQUE INDEX "stripe_checkout_attempts_sessionId_key" ON "stripe_checkout_attempts"("sessionId");
ALTER TABLE "stripe_checkout_attempts" ADD CONSTRAINT "stripe_checkout_attempts_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "stripe_webhook_events" (
  "id" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stripe_webhook_events_stripeEventId_key" ON "stripe_webhook_events"("stripeEventId");
CREATE INDEX "stripe_webhook_events_status_createdAt_idx" ON "stripe_webhook_events"("status", "createdAt");
