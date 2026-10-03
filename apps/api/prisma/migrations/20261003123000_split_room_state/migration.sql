CREATE TYPE "RoomOccupancyStatus" AS ENUM ('VACANT', 'OCCUPIED');
CREATE TYPE "RoomReadinessStatus" AS ENUM ('READY', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE');

ALTER TABLE "rooms"
ADD COLUMN "occupancyStatus" "RoomOccupancyStatus" NOT NULL DEFAULT 'VACANT',
ADD COLUMN "readinessStatus" "RoomReadinessStatus" NOT NULL DEFAULT 'READY';

UPDATE "rooms"
SET
  "occupancyStatus" = CASE
    WHEN "status" = 'OCCUPIED' THEN 'OCCUPIED'::"RoomOccupancyStatus"
    ELSE 'VACANT'::"RoomOccupancyStatus"
  END,
  "readinessStatus" = CASE
    WHEN "status" = 'CLEANING' THEN 'CLEANING'::"RoomReadinessStatus"
    WHEN "status" = 'MAINTENANCE' THEN 'MAINTENANCE'::"RoomReadinessStatus"
    WHEN "status" = 'OUT_OF_SERVICE' THEN 'OUT_OF_SERVICE'::"RoomReadinessStatus"
    ELSE 'READY'::"RoomReadinessStatus"
  END;

DROP INDEX IF EXISTS "rooms_propertyId_status_idx";
ALTER TABLE "rooms" DROP COLUMN "status";
DROP TYPE "RoomStatus";

CREATE INDEX "rooms_propertyId_occupancyStatus_idx" ON "rooms"("propertyId", "occupancyStatus");
CREATE INDEX "rooms_propertyId_readinessStatus_idx" ON "rooms"("propertyId", "readinessStatus");