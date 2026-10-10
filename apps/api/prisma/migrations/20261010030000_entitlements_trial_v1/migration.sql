ALTER TABLE "subscriptions"
  ADD COLUMN "trialStartedAt" TIMESTAMP(3),
  ADD COLUMN "trialEndsAt" TIMESTAMP(3);

UPDATE "subscriptions"
SET
  "trialStartedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "trialEndsAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) + INTERVAL '14 days'
WHERE "trialStartedAt" IS NULL OR "trialEndsAt" IS NULL;

ALTER TABLE "subscriptions"
  ALTER COLUMN "trialStartedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "trialStartedAt" SET NOT NULL,
  ALTER COLUMN "trialEndsAt" SET NOT NULL;
