import { NotificationsService } from '../notifications/notifications.service';
import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HousekeepingStatus, MaintenanceStatus, MembershipRole, StaffDepartment, StaffOperationalStatus, TenantType } from '@prisma/client';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { HousekeepingController } from '../housekeeping/housekeeping.controller';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { CreateHousekeepingTaskDto, UpdateHousekeepingTaskDto } from '../housekeeping/housekeeping.dto';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { UpdateMaintenanceTicketDto } from '../maintenance/maintenance.dto';
import { RbacService } from '../rbac/rbac.service';
import { StaffController } from './staff.controller';
import { CreateStaffDto, UpdateStaffDto } from './staff.dto';
import { StaffService } from './staff.service';

function fixture(department: StaffDepartment = StaffDepartment.HOUSEKEEPING) {
  const membership = { id: 'member-a', userId: 'user-a', tenantId: 'hotel-a', role: MembershipRole.HOTEL_STAFF, tenant: { type: TenantType.HOTEL }, user: { name: 'Staff A' } };
  const profile = { id: 'staff-a', tenantId: 'hotel-a', membershipId: membership.id, propertyId: 'property-a', department, operationalStatus: StaffOperationalStatus.ACTIVE, membership };
  const task = { id: 'work-a', tenantId: 'hotel-a', propertyId: 'property-a', roomId: 'room-a', status: department === StaffDepartment.HOUSEKEEPING ? 'PENDING' : 'OPEN', assignedStaffId: null as string | null, startedAt: null, completedAt: null, resolvedAt: null };
  const work = { findFirst: jest.fn().mockResolvedValue(task), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(async q => q.data), update: jest.fn().mockImplementation(async q => ({ ...task, ...q.data })), count: jest.fn().mockResolvedValue(0) };
  const db = {
    auditLog: { create: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({ id: 'notification-a' }) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ type: TenantType.HOTEL }) },
    membership: { findFirst: jest.fn().mockResolvedValue(membership), findMany: jest.fn().mockResolvedValue([]) },
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'property-a' }) },
    operationalStaff: { findFirst: jest.fn().mockResolvedValue(profile), findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(async q => q.data), update: jest.fn().mockImplementation(async q => q.data) },
    housekeepingTask: { ...work }, maintenanceTicket: { ...work },
    room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-a', propertyId: 'property-a', readinessStatus: 'READY' }), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(async callback => callback(db));
  const staff = new StaffService(db as any, new NotificationsService(db as any, { emit: jest.fn() } as any));
  return { db, profile, membership, task, staff };
}

describe('Operational Staff identity and tenant boundaries', () => {
  it('creates only operational context linked to an existing membership', async () => {
    const { staff, db } = fixture();
    await staff.createForTenant('hotel-a', { membershipId: 'member-a', department: StaffDepartment.HOUSEKEEPING, propertyId: 'property-a' });
    expect(db.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'member-a', tenantId: 'hotel-a' } }));
    expect(db.operationalStaff.create).toHaveBeenCalledWith(expect.objectContaining({ data: { tenantId: 'hotel-a', membershipId: 'member-a', department: 'HOUSEKEEPING', propertyId: 'property-a', operationalStatus: undefined } }));
  });
  it('rejects foreign membership', async () => {
    const { staff, db } = fixture(); db.membership.findFirst.mockResolvedValue(null);
    await expect(staff.createForTenant('hotel-a', { membershipId: 'foreign', department: StaffDepartment.FRONT_DESK })).rejects.toThrow('membership');
    expect(db.operationalStaff.create).not.toHaveBeenCalled();
  });
  it.each([MembershipRole.OWNER, MembershipRole.ZUITZERO_ADMIN, MembershipRole.GUEST])('rejects role %s as hotel staff', async role => {
    const { staff, db, membership } = fixture(); db.membership.findFirst.mockResolvedValue({ ...membership, role });
    await expect(staff.createForTenant('hotel-a', { membershipId: 'member-a', department: StaffDepartment.MANAGEMENT })).rejects.toThrow('membership');
    expect(db.operationalStaff.create).not.toHaveBeenCalled();
  });
  it('rejects PLATFORM tenant staff operations including OWNER access', async () => {
    const { staff, db } = fixture(); db.tenant.findUnique.mockResolvedValue({ type: TenantType.PLATFORM });
    await expect(staff.listForTenant('platform')).rejects.toThrow(ForbiddenException);
    await expect(staff.createForTenant('platform', { membershipId: 'owner', department: StaffDepartment.MANAGEMENT })).rejects.toThrow(ForbiddenException);
  });
  it('rejects foreign property on create and update', async () => {
    const { staff, db } = fixture(); db.property.findFirst.mockResolvedValue(null);
    await expect(staff.createForTenant('hotel-a', { membershipId: 'member-a', department: StaffDepartment.HOUSEKEEPING, propertyId: 'foreign' })).rejects.toThrow('Property');
    await expect(staff.updateForTenant('hotel-a', 'staff-a', { propertyId: 'foreign' })).rejects.toThrow('Property');
    expect(db.property.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'hotel-a' } });
    expect(db.operationalStaff.update).not.toHaveBeenCalled();
  });
  it('rejects cross-tenant profile updates', async () => {
    const { staff, db } = fixture(); db.operationalStaff.findFirst.mockResolvedValue(null);
    await expect(staff.updateForTenant('hotel-a', 'foreign', { department: StaffDepartment.MAINTENANCE })).rejects.toThrow(NotFoundException);
    expect(db.operationalStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', tenantId: 'hotel-a' } }));
  });
  it('scopes directory and eligible memberships without exposing credentials', async () => {
    const { staff, db } = fixture();
    await staff.listForTenant('hotel-a'); await staff.membershipsForTenant('hotel-a');
    expect(db.operationalStaff.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'hotel-a' }) }));
    const query = db.membership.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ tenantId: 'hotel-a', role: { in: ['HOTEL_ADMIN', 'HOTEL_STAFF'] }, staffProfile: null });
    expect(query.select.user).toEqual({ select: { id: true, name: true } });
  });
  it('returns only active departmental candidates with hotel identities', async () => {
    const { staff, db } = fixture();
    await staff.assigneesForTenant('hotel-a', StaffDepartment.HOUSEKEEPING);
    expect(db.operationalStaff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'hotel-a', department: 'HOUSEKEEPING', operationalStatus: 'ACTIVE', membership: { role: { in: ['HOTEL_ADMIN', 'HOTEL_STAFF'] }, tenant: { type: 'HOTEL' } } },
      select: expect.objectContaining({ id: true, propertyId: true }),
    }));
  });
  it.each([{ operationalStatus: StaffOperationalStatus.INACTIVE }, { department: StaffDepartment.MAINTENANCE }, { propertyId: null }])('blocks incompatible profile changes with open work %j', async input => {
    const { staff, db } = fixture(); db.housekeepingTask.count.mockResolvedValue(1);
    await expect(staff.updateForTenant('hotel-a', 'staff-a', input)).rejects.toThrow('Reassign or finish');
    expect(db.operationalStaff.update).not.toHaveBeenCalled();
  });
  it('updates context and clears scope after open work is finished', async () => {
    const { staff, db } = fixture();
    await staff.updateForTenant('hotel-a', 'staff-a', { propertyId: null, operationalStatus: StaffOperationalStatus.INACTIVE });
    expect(db.operationalStaff.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'staff-a', tenantId: 'hotel-a' }, data: expect.objectContaining({ propertyId: null, operationalStatus: 'INACTIVE' }) }));
  });
});

describe.each([
  { department: StaffDepartment.HOUSEKEEPING, model: 'housekeepingTask', initial: 'PENDING', completed: 'COMPLETED', Service: HousekeepingService },
  { department: StaffDepartment.MAINTENANCE, model: 'maintenanceTicket', initial: 'OPEN', completed: 'RESOLVED', Service: MaintenanceService },
])('$department assignment', ({ department, model, initial, completed, Service }) => {
  function setup() { const f = fixture(department); return { ...f, work: (f.db as any)[model], service: new Service(f.db as any, f.staff, new RoomReadinessService(f.db as any)) }; }
  it('assigns eligible staff and moves pending work to ASSIGNED atomically', async () => {
    const { service, db, work } = setup();
    await service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: 'staff-a' });
    expect(work.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'work-a', tenantId: 'hotel-a' }, data: expect.objectContaining({ assignedStaffId: 'staff-a', assignedTo: null, status: 'ASSIGNED' }) }));
    expect(db.operationalStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'staff-a', tenantId: 'hotel-a' } }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(db.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ occupancyStatus: expect.anything() }) }));
  });
  it('rejects foreign work', async () => {
    const { service, work } = setup(); work.findFirst.mockResolvedValue(null);
    await expect(service.updateForTenant('hotel-a', 'foreign', { assignedStaffId: 'staff-a' })).rejects.toThrow(NotFoundException);
    expect(work.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'hotel-a' } });
    expect(work.update).not.toHaveBeenCalled();
  });
  it('rejects foreign staff', async () => {
    const { service, db, work } = setup(); db.operationalStaff.findFirst.mockResolvedValue(null);
    await expect(service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: 'foreign' })).rejects.toThrow('does not belong');
    expect(work.update).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'department', 'property', 'platform'])('rejects incompatible %s staff', async reason => {
    const { service, db, profile, membership, work } = setup();
    db.operationalStaff.findFirst.mockResolvedValue({ ...profile, ...(reason === 'inactive' ? { operationalStatus: StaffOperationalStatus.INACTIVE } : {}), ...(reason === 'department' ? { department: StaffDepartment.FRONT_DESK } : {}), ...(reason === 'property' ? { propertyId: 'foreign' } : {}), ...(reason === 'platform' ? { membership: { ...membership, role: MembershipRole.OWNER } } : {}) });
    await expect(service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: 'staff-a' })).rejects.toThrow(BadRequestException);
    expect(work.update).not.toHaveBeenCalled();
  });
  it.each(['terminal', 'cancelled'])('rejects assignment and reopening of %s work', async state => {
    const { service, work, task } = setup(); work.findFirst.mockResolvedValue({ ...task, status: state === 'terminal' ? completed : 'CANCELLED' });
    await expect(service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: 'staff-a' })).rejects.toThrow('Closed work');
    await expect(service.updateForTenant('hotel-a', 'work-a', { status: initial } as any)).rejects.toThrow('Closed work');
    expect(work.update).not.toHaveBeenCalled();
  });
  it('unassigns ASSIGNED work without restarting work in progress', async () => {
    const { service, work, task } = setup(); work.findFirst.mockResolvedValue({ ...task, status: 'ASSIGNED', assignedStaffId: 'staff-a' });
    await service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: null });
    expect(work.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedStaffId: null, status: initial }) }));
    work.findFirst.mockResolvedValue({ ...task, status: 'IN_PROGRESS', assignedStaffId: 'staff-a' });
    await service.updateForTenant('hotel-a', 'work-a', { assignedStaffId: null });
    expect(work.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedStaffId: null, status: 'IN_PROGRESS' }) }));
  });
  it('allows hotel-wide staff scope and preserves readiness-only completion', async () => {
    const { service, db, work, task, profile } = setup(); db.operationalStaff.findFirst.mockResolvedValue({ ...profile, propertyId: null });
    work.findFirst.mockResolvedValue({ ...task, status: 'ASSIGNED', assignedStaffId: 'staff-a' });
    await service.updateForTenant('hotel-a', 'work-a', { status: 'IN_PROGRESS' } as any);
    await service.updateForTenant('hotel-a', 'work-a', { status: completed } as any);
    expect(db.room.update).toHaveBeenCalledWith({ where: { id: 'room-a', property: { tenantId: 'hotel-a' } }, data: { readinessStatus: 'READY' }, include: { property: true, roomType: true } });
  });
  it('validates creation assignment and rejects free-text identity bypass', async () => {
    const { service, db, work } = setup();
    await service.createForTenant('hotel-a', { roomId: 'room-a', title: 'Work', description: 'Issue', assignedStaffId: 'staff-a' } as any);
    expect(work.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'hotel-a', assignedStaffId: 'staff-a', status: 'ASSIGNED' }) }));
    expect(db.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ occupancyStatus: expect.anything() }) }));
  });
  it('rejects creation with foreign staff before work or readiness writes', async () => {
    const { service, db, work } = setup(); db.operationalStaff.findFirst.mockResolvedValue(null);
    await expect(service.createForTenant('hotel-a', { roomId: 'room-a', title: 'Work', description: 'Issue', assignedStaffId: 'foreign' } as any)).rejects.toThrow('does not belong');
    expect(work.create).not.toHaveBeenCalled(); expect(db.room.update).not.toHaveBeenCalled();
  });
  it('rejects ASSIGNED without staff and preserves closed timestamps and readiness on metadata edits', async () => {
    const { service, db, work, task } = setup();
    await expect(service.updateForTenant('hotel-a', 'work-a', { status: 'ASSIGNED' } as any)).rejects.toThrow('requires an operational staff profile');
    const timestamp = new Date('2026-10-01T12:00:00Z');
    work.findFirst.mockResolvedValue({ ...task, status: completed, completedAt: timestamp, resolvedAt: timestamp });
    await service.updateForTenant('hotel-a', 'work-a', { priority: 'NORMAL' } as any);
    expect(work.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ [completed === 'COMPLETED' ? 'completedAt' : 'resolvedAt']: timestamp }) }));
    expect(db.room.update).not.toHaveBeenCalled();
  });
});

describe('Staff and assignment authorization', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it.each([
    { metatype: CreateStaffDto, payload: { membershipId: 'member-a', department: 'HOUSEKEEPING' }, extra: { tenantId: 'foreign' } },
    { metatype: UpdateStaffDto, payload: { department: 'HOUSEKEEPING' }, extra: { role: 'HOTEL_ADMIN' } },
    { metatype: UpdateStaffDto, payload: {}, extra: { membershipId: 'foreign' } },
    { metatype: UpdateHousekeepingTaskDto, payload: { assignedStaffId: 'staff-a' }, extra: { tenantId: 'foreign' } },
    { metatype: UpdateMaintenanceTicketDto, payload: { assignedStaffId: 'staff-a' }, extra: { assignedTo: 'owner' } },
  ])('rejects client ownership/identity fields $extra', async ({ metatype, payload, extra }) => {
    try { await pipe.transform({ ...payload, ...extra }, { type: 'body', metatype } as any); throw new Error('Unexpected acceptance'); }
    catch (error) { expect(error).toBeInstanceOf(BadRequestException); expect((error as BadRequestException).getResponse()).toEqual(expect.objectContaining({ message: expect.arrayContaining([expect.stringContaining('should not exist')]) })); }
  });
  it.each([MembershipRole.HOTEL_ADMIN, MembershipRole.HOTEL_STAFF])('keeps staff management restricted for %s while preserving operations permissions', async role => {
    const request = { auth: { user: { id: 'user-a' }, tenant: { id: 'hotel-a' }, membership: { id: 'member-a', role } }, body: { tenantId: 'foreign' }, tenantContext: { tenantId: 'foreign' } };
    let handler: Function = StaffController.prototype.create;
    const context = { getHandler: () => handler, getClass: () => StaffController, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    new TenantContextGuard().canActivate(context);
    const rbac = new RbacService({ membership: { findUnique: jest.fn().mockResolvedValue({ role, tenant: { type: TenantType.HOTEL } }) } } as any);
    const guard = new PermissionsGuard(new Reflector(), rbac, { record: jest.fn() } as any);
    if (role === MembershipRole.HOTEL_ADMIN) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
      const createForTenant = jest.fn(); new StaffController({ createForTenant } as any).create(request as any, { membershipId: 'member-a', department: StaffDepartment.HOUSEKEEPING });
      expect(createForTenant).toHaveBeenCalledWith('hotel-a', expect.anything());
    } else await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    handler = HousekeepingController.prototype.update;
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
