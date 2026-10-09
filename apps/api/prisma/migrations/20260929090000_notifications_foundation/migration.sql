-- Repair missing Notifications baseline required by operations incidents and later notification migrations.
-- This migration is intentionally idempotent because some existing environments may
-- already contain these objects outside Prisma migration history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationAudience') THEN
    CREATE TYPE "NotificationAudience" AS ENUM ('GUEST', 'HOTEL', 'ZUITZERO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationSeverity') THEN
    CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationChannel') THEN
    CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'WHATSAPP', 'EMAIL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "audience" "NotificationAudience" NOT NULL,
  "recipientId" TEXT,
  "severity" "NotificationSeverity" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_tenantId_audience_createdAt_idx"
  ON "notifications"("tenantId", "audience", "createdAt");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_recipientId_readAt_idx"
  ON "notifications"("tenantId", "recipientId", "readAt");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_createdAt_idx"
  ON "notifications"("tenantId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_tenantId_fkey'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
