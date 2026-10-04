-- Preserve previous blocking behavior; guest-created maintenance is non-blocking only for NEW requests.
ALTER TABLE "rooms" ADD COLUMN "outOfServiceLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "housekeeping_tasks" ADD COLUMN "blocksRoom" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "maintenance_tickets" ADD COLUMN "blocksRoom" BOOLEAN NOT NULL DEFAULT true;
UPDATE "rooms" SET "outOfServiceLocked" = true WHERE "readinessStatus" = 'OUT_OF_SERVICE';

-- Preserve legacy readiness with no corresponding active work as explicit reviewable work.
INSERT INTO "housekeeping_tasks" ("id", "tenantId", "propertyId", "roomId", "title", "notes", "updatedAt")
SELECT 'readiness-hk-' || r."id", p."tenantId", r."propertyId", r."id",
  'Legacy cleaning readiness review', 'Created by readiness migration to preserve an existing CLEANING room without active housekeeping.', CURRENT_TIMESTAMP
FROM "rooms" r JOIN "properties" p ON p."id" = r."propertyId"
WHERE r."readinessStatus" = 'CLEANING' AND NOT EXISTS (
  SELECT 1 FROM "housekeeping_tasks" h WHERE h."roomId" = r."id" AND h."tenantId" = p."tenantId"
  AND h."status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS') AND h."blocksRoom" = true
);
INSERT INTO "maintenance_tickets" ("id", "tenantId", "propertyId", "roomId", "title", "description", "updatedAt")
SELECT 'readiness-mt-' || r."id", p."tenantId", r."propertyId", r."id",
  'Legacy maintenance readiness review', 'Created by readiness migration to preserve an existing MAINTENANCE room without active maintenance.', CURRENT_TIMESTAMP
FROM "rooms" r JOIN "properties" p ON p."id" = r."propertyId"
WHERE r."readinessStatus" = 'MAINTENANCE' AND NOT EXISTS (
  SELECT 1 FROM "maintenance_tickets" m WHERE m."roomId" = r."id" AND m."tenantId" = p."tenantId"
  AND m."status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS') AND m."blocksRoom" = true
);

-- Initialize the cached derived state without touching occupancy.
UPDATE "rooms" r SET "readinessStatus" = (CASE
  WHEN r."outOfServiceLocked" THEN 'OUT_OF_SERVICE'
  WHEN EXISTS (SELECT 1 FROM "maintenance_tickets" m JOIN "properties" p ON p."id" = r."propertyId"
    WHERE m."roomId" = r."id" AND m."tenantId" = p."tenantId" AND m."blocksRoom" AND m."status" IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')) THEN 'MAINTENANCE'
  WHEN EXISTS (SELECT 1 FROM "housekeeping_tasks" h JOIN "properties" p ON p."id" = r."propertyId"
    WHERE h."roomId" = r."id" AND h."tenantId" = p."tenantId" AND h."blocksRoom" AND h."status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')) THEN 'CLEANING'
  ELSE 'READY' END)::"RoomReadinessStatus", "updatedAt" = CURRENT_TIMESTAMP;
