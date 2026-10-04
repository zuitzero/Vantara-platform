import { NotificationsService } from '../notifications/notifications.service';
import { auditMutation } from '../rbac/audit.service';
import { AuditAction } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole, Prisma, StaffDepartment, StaffOperationalStatus, TenantType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto, UpdateStaffDto } from './staff.dto';

export const staffIdentity = { select: { id: true, role: true, user: { select: { id: true, name: true } } } } as const;
const hotelRoles: MembershipRole[] = [MembershipRole.HOTEL_ADMIN, MembershipRole.HOTEL_STAFF];
const staffInclude = { membership: staffIdentity, property: { select: { id: true, name: true } } } as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) { }

  async assertHotel(tenantId: string, db: Prisma.TransactionClient = this.prisma) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { type: true } });
    if (tenant?.type !== TenantType.HOTEL) throw new ForbiddenException('Staff operations require a HOTEL tenant.');
  }
  async listForTenant(tenantId: string) {
    await this.assertHotel(tenantId);
    return this.prisma.operationalStaff.findMany({
      where: { tenantId, membership: { role: { in: hotelRoles }, tenant: { type: TenantType.HOTEL } } },
      include: staffInclude, orderBy: { createdAt: 'asc' },
    });
  }
  async membershipsForTenant(tenantId: string) {
    await this.assertHotel(tenantId);
    return this.prisma.membership.findMany({
      where: { tenantId, role: { in: hotelRoles }, staffProfile: null },
      select: staffIdentity.select, orderBy: { user: { name: 'asc' } },
    });
  }
  async assigneesForTenant(tenantId: string, department: StaffDepartment) {
    await this.assertHotel(tenantId);
    return this.prisma.operationalStaff.findMany({
      where: { tenantId, department, operationalStatus: StaffOperationalStatus.ACTIVE, membership: { role: { in: hotelRoles }, tenant: { type: TenantType.HOTEL } } },
      select: { id: true, propertyId: true, department: true, membership: staffIdentity },
      orderBy: { membership: { user: { name: 'asc' } } },
    });
  }
  async createForTenant(tenantId: string, input: CreateStaffDto) {
    return this.transaction(async tx => {
      await this.assertHotel(tenantId, tx);
      const membership = await tx.membership.findFirst({ where: { id: input.membershipId, tenantId }, include: { tenant: { select: { type: true } } } });
      if (!membership || !hotelRoles.includes(membership.role) || membership.tenant.type !== TenantType.HOTEL) {
        throw new BadRequestException('Staff requires a HOTEL_ADMIN or HOTEL_STAFF membership in this hotel.');
      }
      await this.validateProperty(tx, tenantId, input.propertyId);
      const created = await tx.operationalStaff.create({
        data: { tenantId, membershipId: membership.id, propertyId: input.propertyId, department: input.department, operationalStatus: input.operationalStatus },
        include: staffInclude,
      });
      await auditMutation(tx, tenantId, AuditAction.STAFF_PROFILE_CREATED, 'staff', created.id, { department: created.department, propertyId: created.propertyId ?? null, operationalStatus: created.operationalStatus });
      return created;
    });
  }
  async updateForTenant(tenantId: string, staffId: string, input: UpdateStaffDto) {
    return this.transaction(async tx => {
      await this.assertHotel(tenantId, tx);
      const current = await tx.operationalStaff.findFirst({ where: { id: staffId, tenantId }, include: { membership: { include: { tenant: true } } } });
      if (!current) throw new NotFoundException('Staff profile not found.');
      if (!hotelRoles.includes(current.membership.role) || current.membership.tenant.type !== TenantType.HOTEL) throw new BadRequestException('Hotel staff membership required.');
      await this.validateProperty(tx, tenantId, input.propertyId);
      const changed = (input.propertyId !== undefined && input.propertyId !== current.propertyId)
        || (input.department !== undefined && input.department !== current.department)
        || (input.operationalStatus !== undefined && input.operationalStatus !== current.operationalStatus);
      if (changed) {
        const [housekeeping, maintenance] = await Promise.all([
          tx.housekeepingTask.count({ where: { tenantId, assignedStaffId: staffId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
          tx.maintenanceTicket.count({ where: { tenantId, assignedStaffId: staffId, status: { notIn: ['RESOLVED', 'CANCELLED'] } } }),
        ]);
        if (housekeeping || maintenance) throw new BadRequestException('Reassign or finish open work before changing this staff profile.');
      }
      const updated = await tx.operationalStaff.update({
        where: { id: staffId, tenantId },
        data: { propertyId: input.propertyId, department: input.department, operationalStatus: input.operationalStatus }, include: staffInclude,
      });
      if (changed) await auditMutation(tx, tenantId, AuditAction.STAFF_PROFILE_CHANGED, 'staff', staffId, { department: updated.department, propertyId: updated.propertyId ?? null, operationalStatus: updated.operationalStatus });
      return updated;
    });
  }
  async validateAssignee(db: Prisma.TransactionClient, tenantId: string, staffId: string, propertyId: string, department: StaffDepartment) {
    const staff = await db.operationalStaff.findFirst({
      where: { id: staffId, tenantId }, include: { membership: { include: { tenant: { select: { type: true } } } } },
    });
    if (!staff) throw new BadRequestException('Staff profile does not belong to this hotel.');
    if (!hotelRoles.includes(staff.membership.role) || staff.membership.tenant.type !== TenantType.HOTEL) throw new BadRequestException('Hotel staff membership required.');
    if (staff.operationalStatus !== StaffOperationalStatus.ACTIVE) throw new BadRequestException('Assigned staff must be ACTIVE.');
    if (staff.department !== department) throw new BadRequestException(`Assigned staff must belong to ${department}.`);
    if (staff.propertyId && staff.propertyId !== propertyId) throw new BadRequestException('Staff property scope does not match this work.');
  }
  async notifyWork(tx: Prisma.TransactionClient, tenantId: string, work: { id: string; roomId: string; propertyId: string; assignedStaffId: string | null; priority: string }, kind: 'housekeeping' | 'maintenance', assignmentChanged: boolean, created: boolean) {
    if (assignmentChanged && work.assignedStaffId) {
      const profile = await tx.operationalStaff.findFirst({ where: { id: work.assignedStaffId, tenantId }, include: { membership: true } });
      if (!profile) throw new BadRequestException('Assigned staff not found.');
      await this.notifications.queue(tx, { tenantId, audience: 'HOTEL', recipientId: profile.membership.userId, severity: kind === 'maintenance' && work.priority === 'URGENT' ? 'CRITICAL' : kind === 'maintenance' && work.priority === 'HIGH' ? 'HIGH' : 'INFO', type: `${kind}.assigned`, title: `${kind === 'housekeeping' ? 'Housekeeping' : 'Maintenance'} work assigned`, message: 'You have a new operational assignment.', metadata: { workId: work.id, roomId: work.roomId, propertyId: work.propertyId } });
    } else if (created && kind === 'maintenance' && ['HIGH', 'URGENT'].includes(work.priority)) {
      await this.notifications.queue(tx, { tenantId, audience: 'HOTEL', severity: work.priority === 'URGENT' ? 'CRITICAL' : 'HIGH', type: 'maintenance.attention', title: 'Maintenance requires attention', message: 'High-priority maintenance work was created.', metadata: { workId: work.id, roomId: work.roomId } });
    }
  }
  private async validateProperty(db: Prisma.TransactionClient, tenantId: string, propertyId?: string | null) {
    if (propertyId && !await db.property.findFirst({ where: { id: propertyId, tenantId } })) throw new BadRequestException('Property does not belong to this hotel.');
  }
  async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0;attempt < 3;attempt++) {
      try { return await this.notifications.transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This membership already has a staff profile.');
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new ConflictException('Staff or work changed concurrently. Refresh and retry.');
      }
    }
    throw new ConflictException('Refresh and retry.');
  }
}
