CREATE TABLE "guest_preferences" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "guestId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guest_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_tags" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "guestId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_notes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "guestId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guests_id_tenantId_key" ON "guests"("id", "tenantId");
CREATE UNIQUE INDEX "guest_preferences_guestId_key_key" ON "guest_preferences"("guestId", "key");
CREATE INDEX "guest_preferences_tenantId_guestId_idx" ON "guest_preferences"("tenantId", "guestId");
CREATE UNIQUE INDEX "guest_tags_guestId_label_key" ON "guest_tags"("guestId", "label");
CREATE INDEX "guest_tags_tenantId_guestId_idx" ON "guest_tags"("tenantId", "guestId");
CREATE INDEX "guest_notes_tenantId_guestId_createdAt_idx" ON "guest_notes"("tenantId", "guestId", "createdAt");
CREATE INDEX "guest_notes_authorUserId_idx" ON "guest_notes"("authorUserId");

ALTER TABLE "guest_preferences"
  ADD CONSTRAINT "guest_preferences_guestId_fkey"
  FOREIGN KEY ("guestId", "tenantId") REFERENCES "guests"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_tags"
  ADD CONSTRAINT "guest_tags_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_notes"
  ADD CONSTRAINT "guest_notes_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_notes"
  ADD CONSTRAINT "guest_notes_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
