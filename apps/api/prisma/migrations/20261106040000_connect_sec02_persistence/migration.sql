-- AlterTable
ALTER TABLE "guest_connect_access" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "guest_connect_bootstraps" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "legacyTokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "guest_connect_bootstraps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_connect_sessions" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "bootstrapId" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "legacyTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "guest_connect_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_connect_idempotency" (
    "id" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_connect_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_connect_bootstraps_codeHash_key" ON "guest_connect_bootstraps"("codeHash");

-- CreateIndex
CREATE INDEX "guest_connect_bootstraps_accessId_generation_expiresAt_idx" ON "guest_connect_bootstraps"("accessId", "generation", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "guest_connect_sessions_secretHash_key" ON "guest_connect_sessions"("secretHash");

-- CreateIndex
CREATE UNIQUE INDEX "guest_connect_sessions_bootstrapId_key" ON "guest_connect_sessions"("bootstrapId");

-- CreateIndex
CREATE INDEX "guest_connect_sessions_accessId_generation_revokedAt_expire_idx" ON "guest_connect_sessions"("accessId", "generation", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "guest_connect_idempotency_resultRequestId_tenantId_reservat_idx" ON "guest_connect_idempotency"("resultRequestId", "tenantId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_connect_idempotency_accessId_generation_keyHash_key" ON "guest_connect_idempotency"("accessId", "generation", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "guest_connect_access_id_tenantId_reservationId_key" ON "guest_connect_access"("id", "tenantId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_requests_id_tenantId_reservationId_key" ON "guest_requests"("id", "tenantId", "reservationId");

-- AddForeignKey
ALTER TABLE "guest_connect_bootstraps" ADD CONSTRAINT "guest_connect_bootstraps_accessId_tenantId_reservationId_fkey" FOREIGN KEY ("accessId", "tenantId", "reservationId") REFERENCES "guest_connect_access"("id", "tenantId", "reservationId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_bootstraps" ADD CONSTRAINT "guest_connect_bootstraps_propertyId_tenantId_fkey" FOREIGN KEY ("propertyId", "tenantId") REFERENCES "properties"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_bootstraps" ADD CONSTRAINT "guest_connect_bootstraps_guestId_tenantId_fkey" FOREIGN KEY ("guestId", "tenantId") REFERENCES "guests"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_sessions" ADD CONSTRAINT "guest_connect_sessions_bootstrapId_fkey" FOREIGN KEY ("bootstrapId") REFERENCES "guest_connect_bootstraps"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_sessions" ADD CONSTRAINT "guest_connect_sessions_accessId_tenantId_reservationId_fkey" FOREIGN KEY ("accessId", "tenantId", "reservationId") REFERENCES "guest_connect_access"("id", "tenantId", "reservationId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_sessions" ADD CONSTRAINT "guest_connect_sessions_propertyId_tenantId_fkey" FOREIGN KEY ("propertyId", "tenantId") REFERENCES "properties"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_sessions" ADD CONSTRAINT "guest_connect_sessions_guestId_tenantId_fkey" FOREIGN KEY ("guestId", "tenantId") REFERENCES "guests"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_idempotency" ADD CONSTRAINT "guest_connect_idempotency_accessId_tenantId_reservationId_fkey" FOREIGN KEY ("accessId", "tenantId", "reservationId") REFERENCES "guest_connect_access"("id", "tenantId", "reservationId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guest_connect_idempotency" ADD CONSTRAINT "guest_connect_idempotency_resultRequestId_tenantId_reserva_fkey" FOREIGN KEY ("resultRequestId", "tenantId", "reservationId") REFERENCES "guest_requests"("id", "tenantId", "reservationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Inactive snapshot integrity, beyond what Prisma schema can express.
ALTER TABLE "guest_connect_access" ADD CONSTRAINT "guest_access_generation_positive" CHECK ("generation" > 0);
ALTER TABLE "guest_connect_bootstraps" ADD CONSTRAINT "guest_bootstrap_shape" CHECK (
  "generation" > 0 AND "codeHash" ~ '^[a-f0-9]{64}$' AND "legacyTokenHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "issuedAt");
ALTER TABLE "guest_connect_sessions" ADD CONSTRAINT "guest_session_shape" CHECK (
  "generation" > 0 AND "secretHash" ~ '^[a-f0-9]{64}$' AND "legacyTokenHash" ~ '^[a-f0-9]{64}$' AND
  "expiresAt" > "createdAt" AND "lastSeenAt" >= "createdAt" AND "lastSeenAt" < "expiresAt");
ALTER TABLE "guest_connect_idempotency" ADD CONSTRAINT "guest_claim_shape" CHECK (
  "generation" > 0 AND "keyHash" ~ '^[a-f0-9]{64}$' AND "payloadHash" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION guest_access_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."generation" < OLD."generation" THEN RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guest_access_generation_guard BEFORE UPDATE ON "guest_connect_access"
FOR EACH ROW EXECUTE FUNCTION guest_access_generation_guard();

CREATE FUNCTION guest_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."accessId", NEW."tenantId", NEW."reservationId", NEW."generation") IS DISTINCT FROM
     (OLD."id", OLD."accessId", OLD."tenantId", OLD."reservationId", OLD."generation") THEN
    RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'guest_connect_idempotency' THEN
    IF (NEW."keyHash", NEW."payloadHash", NEW."createdAt") IS DISTINCT FROM (OLD."keyHash", OLD."payloadHash", OLD."createdAt") OR
       (OLD."resultRequestId" IS NOT NULL AND NEW."resultRequestId" IS DISTINCT FROM OLD."resultRequestId") THEN
      RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW."propertyId", NEW."guestId", NEW."legacyTokenHash", NEW."expiresAt") IS DISTINCT FROM
       (OLD."propertyId", OLD."guestId", OLD."legacyTokenHash", OLD."expiresAt") OR
       (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
      RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'guest_connect_bootstraps' THEN
      IF (NEW."codeHash", NEW."issuedAt") IS DISTINCT FROM (OLD."codeHash", OLD."issuedAt") OR
         (OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt") THEN
        RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF (NEW."secretHash", NEW."bootstrapId", NEW."createdAt") IS DISTINCT FROM (OLD."secretHash", OLD."bootstrapId", OLD."createdAt") OR NEW."lastSeenAt" < OLD."lastSeenAt" THEN
        RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guest_bootstrap_snapshot BEFORE UPDATE ON "guest_connect_bootstraps" FOR EACH ROW EXECUTE FUNCTION guest_snapshot_guard();
CREATE TRIGGER guest_session_snapshot BEFORE UPDATE ON "guest_connect_sessions" FOR EACH ROW EXECUTE FUNCTION guest_snapshot_guard();
CREATE TRIGGER guest_claim_snapshot BEFORE UPDATE ON "guest_connect_idempotency" FOR EACH ROW EXECUTE FUNCTION guest_snapshot_guard();

-- Deferred checks run at COMMIT, not transaction-start time. SQL timestamps are UTC.
CREATE FUNCTION guest_bootstrap_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (OLD."consumedAt" IS NULL AND NEW."consumedAt" IS NOT NULL) THEN
    IF NEW."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."consumedAt" IS NULL AND NEW."consumedAt" IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM "guest_connect_sessions" WHERE "bootstrapId" = NEW."id") THEN
    RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER guest_bootstrap_commit AFTER INSERT OR UPDATE ON "guest_connect_bootstraps"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guest_bootstrap_commit_guard();

CREATE FUNCTION guest_session_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "guest_connect_bootstraps"%ROWTYPE;
BEGIN
  IF NEW."revokedAt" IS NULL AND NEW."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO b FROM "guest_connect_bootstraps" WHERE "id" = NEW."bootstrapId";
    IF b."consumedAt" IS NULL OR b."consumedAt" <> NEW."createdAt" OR b."revokedAt" IS NOT NULL OR
       b."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR
       (b."accessId", b."tenantId", b."reservationId", b."propertyId", b."guestId", b."generation", b."legacyTokenHash") IS DISTINCT FROM
       (NEW."accessId", NEW."tenantId", NEW."reservationId", NEW."propertyId", NEW."guestId", NEW."generation", NEW."legacyTokenHash") THEN
      RAISE EXCEPTION 'GUEST_ACCESS_DENIED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER guest_session_commit AFTER INSERT OR UPDATE ON "guest_connect_sessions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guest_session_commit_guard();
