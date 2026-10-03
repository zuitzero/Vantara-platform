CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "operations_incidents" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "severity" "NotificationSeverity" NOT NULL,
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  CONSTRAINT "operations_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "operations_incidents_tenantId_service_status_idx" ON "operations_incidents"("tenantId", "service", "status");
CREATE INDEX "operations_incidents_tenantId_severity_status_idx" ON "operations_incidents"("tenantId", "severity", "status");
CREATE INDEX "operations_incidents_tenantId_firstDetectedAt_idx" ON "operations_incidents"("tenantId", "firstDetectedAt");

ALTER TABLE "operations_incidents" ADD CONSTRAINT "operations_incidents_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
