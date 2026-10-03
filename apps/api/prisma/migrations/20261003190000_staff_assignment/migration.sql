CREATE TYPE "StaffDepartment" AS ENUM ('FRONT_DESK', 'HOUSEKEEPING', 'MAINTENANCE', 'MANAGEMENT');
CREATE TYPE "StaffOperationalStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE UNIQUE INDEX "memberships_id_tenantId_key" ON "memberships"("id", "tenantId");
CREATE UNIQUE INDEX "properties_id_tenantId_key" ON "properties"("id", "tenantId");

CREATE TABLE "operational_staff" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "propertyId" TEXT,
  "department" "StaffDepartment" NOT NULL,
  "operationalStatus" "StaffOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operational_staff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_staff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "operational_staff_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "memberships"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "operational_staff_propertyId_tenantId_fkey" FOREIGN KEY ("propertyId", "tenantId") REFERENCES "properties"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "operational_staff_membershipId_key" ON "operational_staff"("membershipId");
CREATE UNIQUE INDEX "operational_staff_id_tenantId_key" ON "operational_staff"("id", "tenantId");
CREATE INDEX "operational_staff_tenantId_operationalStatus_department_idx" ON "operational_staff"("tenantId", "operationalStatus", "department");
CREATE UNIQUE INDEX "operational_staff_membershipId_tenantId_key" ON "operational_staff"("membershipId", "tenantId");
CREATE INDEX "operational_staff_propertyId_idx" ON "operational_staff"("propertyId");

ALTER TABLE "housekeeping_tasks" ADD COLUMN "assignedStaffId" TEXT;
ALTER TABLE "maintenance_tickets" ADD COLUMN "assignedStaffId" TEXT;
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assignedStaffId_tenantId_fkey" FOREIGN KEY ("assignedStaffId", "tenantId") REFERENCES "operational_staff"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_assignedStaffId_tenantId_fkey" FOREIGN KEY ("assignedStaffId", "tenantId") REFERENCES "operational_staff"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "housekeeping_tasks_tenantId_assignedStaffId_status_idx" ON "housekeeping_tasks"("tenantId", "assignedStaffId", "status");
CREATE INDEX "maintenance_tickets_tenantId_assignedStaffId_status_idx" ON "maintenance_tickets"("tenantId", "assignedStaffId", "status");
