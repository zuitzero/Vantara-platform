CREATE TYPE "GuestStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "guests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "propertyId" TEXT,
  "roomId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "status" "GuestStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guests_tenantId_status_idx" ON "guests"("tenantId", "status");
CREATE INDEX "guests_propertyId_idx" ON "guests"("propertyId");
CREATE INDEX "guests_roomId_idx" ON "guests"("roomId");
CREATE INDEX "guests_tenantId_email_idx" ON "guests"("tenantId", "email");

ALTER TABLE "guests" ADD CONSTRAINT "guests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guests" ADD CONSTRAINT "guests_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guests" ADD CONSTRAINT "guests_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
