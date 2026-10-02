-- Vantara RBAC foundation
-- Legacy roles are mapped conservatively:
-- OWNER -> OWNER, ADMIN -> HOTEL_ADMIN, MANAGER/STAFF -> HOTEL_STAFF.

CREATE TYPE "MembershipRole_new" AS ENUM ('GUEST', 'HOTEL_STAFF', 'HOTEL_ADMIN', 'ZUITZERO_ADMIN', 'OWNER');

ALTER TABLE "memberships" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "memberships"
  ALTER COLUMN "role" TYPE "MembershipRole_new"
  USING (
    CASE "role"::text
      WHEN 'OWNER' THEN 'OWNER'
      WHEN 'ADMIN' THEN 'HOTEL_ADMIN'
      WHEN 'MANAGER' THEN 'HOTEL_STAFF'
      WHEN 'STAFF' THEN 'HOTEL_STAFF'
      ELSE 'HOTEL_STAFF'
    END
  )::"MembershipRole_new";

DROP TYPE "MembershipRole";
ALTER TYPE "MembershipRole_new" RENAME TO "MembershipRole";
ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'HOTEL_STAFF';

CREATE TYPE "TenantType" AS ENUM ('HOTEL', 'PLATFORM');
ALTER TABLE "tenants" ADD COLUMN "type" "TenantType" NOT NULL DEFAULT 'HOTEL';
CREATE INDEX "tenants_type_idx" ON "tenants"("type");

CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'LOGOUT', 'BILLING_VIEW', 'BILLING_CHANGE', 'ROLE_CHANGE', 'PERMISSION_DENIED');
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "actorUserId" TEXT,
  "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
  "action" "AuditAction" NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");
CREATE INDEX "audit_logs_resourceType_resourceId_createdAt_idx" ON "audit_logs"("resourceType", "resourceId", "createdAt");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
