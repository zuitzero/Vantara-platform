ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_ROOM_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CHECKED_IN';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CHECKED_OUT';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CANCELED';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_NO_SHOW';
ALTER TYPE "AuditAction" ADD VALUE 'GUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_OCCUPANCY_OVERRIDDEN';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_OUT_OF_SERVICE_LOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'ROOM_OUT_OF_SERVICE_UNLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'HOUSEKEEPING_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'HOUSEKEEPING_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'HOUSEKEEPING_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'HOUSEKEEPING_BLOCKING_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'MAINTENANCE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MAINTENANCE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'MAINTENANCE_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'MAINTENANCE_BLOCKING_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_PROFILE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_PROFILE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKSPACE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKSPACE_CREATE_FAILED';
CREATE UNIQUE INDEX "notifications_id_tenantId_key" ON "notifications"("id", "tenantId");
CREATE TABLE "notification_reads" (
  "notificationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notificationId", "userId")
);
CREATE INDEX "notification_reads_tenantId_userId_idx" ON "notification_reads"("tenantId", "userId");
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_tenantId_fkey" FOREIGN KEY ("notificationId", "tenantId") REFERENCES "notifications"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Only targeted HOTEL read history has a known reader. Broadcast readAt cannot identify a reader and is ignored in v2.
INSERT INTO "notification_reads" ("notificationId", "tenantId", "userId", "readAt")
SELECT n."id", n."tenantId", n."recipientId", n."readAt" FROM "notifications" n
JOIN "memberships" m ON m."tenantId" = n."tenantId" AND m."userId" = n."recipientId"
WHERE n."audience" = 'HOTEL' AND n."readAt" IS NOT NULL AND m."role" IN ('HOTEL_ADMIN', 'HOTEL_STAFF');
