ALTER TABLE "housekeeping_tasks"
  ADD COLUMN "sourceGuestRequestId" TEXT,
  ADD COLUMN "sourceReservationId" TEXT;

ALTER TABLE "maintenance_tickets"
  ADD COLUMN "sourceGuestRequestId" TEXT;

CREATE UNIQUE INDEX "housekeeping_tasks_sourceGuestRequestId_key"
  ON "housekeeping_tasks"("sourceGuestRequestId");

CREATE UNIQUE INDEX "housekeeping_tasks_sourceReservationId_key"
  ON "housekeeping_tasks"("sourceReservationId");

CREATE UNIQUE INDEX "maintenance_tickets_sourceGuestRequestId_key"
  ON "maintenance_tickets"("sourceGuestRequestId");
