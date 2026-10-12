CREATE UNIQUE INDEX "reservations_id_tenantId_key" ON "reservations"("id", "tenantId");

CREATE TABLE "guest_connect_access" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guest_connect_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guest_connect_access_reservationId_key" ON "guest_connect_access"("reservationId");
CREATE UNIQUE INDEX "guest_connect_access_tokenHash_key" ON "guest_connect_access"("tokenHash");
CREATE INDEX "guest_connect_access_tenantId_expiresAt_idx" ON "guest_connect_access"("tenantId", "expiresAt");

ALTER TABLE "guest_connect_access"
  ADD CONSTRAINT "guest_connect_access_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_connect_access"
  ADD CONSTRAINT "guest_connect_access_reservationId_tenantId_fkey"
  FOREIGN KEY ("reservationId", "tenantId") REFERENCES "reservations"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
