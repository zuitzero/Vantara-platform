CREATE TYPE "GuestRequestStatus" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "GuestRequestCategory" AS ENUM ('HOUSEKEEPING', 'ROOM_SERVICE', 'MAINTENANCE', 'CONCIERGE', 'FRONT_DESK', 'AMENITIES', 'OTHER');
CREATE TYPE "GuestRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "guest_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "guestId" TEXT NOT NULL,
  "roomId" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "category" "GuestRequestCategory" NOT NULL,
  "priority" "GuestRequestPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "GuestRequestStatus" NOT NULL DEFAULT 'CREATED',
  "guestCount" INTEGER NOT NULL DEFAULT 1,
  "resolutionNote" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guest_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guest_requests_tenantId_status_priority_idx" ON "guest_requests"("tenantId", "status", "priority");
CREATE INDEX "guest_requests_propertyId_status_idx" ON "guest_requests"("propertyId", "status");
CREATE INDEX "guest_requests_guestId_createdAt_idx" ON "guest_requests"("guestId", "createdAt");
CREATE INDEX "guest_requests_roomId_createdAt_idx" ON "guest_requests"("roomId", "createdAt");

ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
