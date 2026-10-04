import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditActor } from './audit-context';

export interface AuditContext {
  tenantId?: string; actorUserId?: string; actorType?: AuditActorType;
  action: AuditAction; resourceType: string; resourceId?: string; success?: boolean;
  ipAddress?: string; userAgent?: string; metadata?: Prisma.InputJsonValue;
}
const safeKeys = new Set(['status', 'previousStatus', 'roomId', 'previousRoomId', 'propertyId', 'assignedStaffId', 'previousAssignedStaffId', 'blocksRoom', 'department', 'operationalStatus', 'occupancyStatus', 'previousOccupancyStatus', 'plan', 'requiredPermissions', 'reason', 'role', 'tenantType']);
export function safeAuditMetadata(metadata?: Prisma.InputJsonValue): Prisma.InputJsonObject {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => safeKeys.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value) || (key === 'requiredPermissions' && Array.isArray(value) && value.every(item => typeof item === 'string')))));
}
async function write(db: Pick<Prisma.TransactionClient, 'auditLog'>, context: AuditContext) {
  return db.auditLog.create({ data: { ...context, actorType: context.actorType ?? AuditActorType.USER, success: context.success ?? true, metadata: safeAuditMetadata(context.metadata) } });
}
// Used by domain services with their existing transaction client. No caller-supplied actor fields.
export async function auditMutation(tx: Prisma.TransactionClient, tenantId: string, action: AuditAction, resourceType: string, resourceId: string, metadata?: Prisma.InputJsonValue) {
  const actor = auditActor.getStore();
  if (actor && actor.tenantId !== tenantId) throw new ForbiddenException('Audit mutation tenant does not match authenticated context.');
  return write(tx, { tenantId, actorUserId: actor?.userId, actorType: actor ? AuditActorType.USER : AuditActorType.SYSTEM, action, resourceType, resourceId, metadata });
}
export function auditBootstrapFailure(db: Pick<Prisma.TransactionClient, 'auditLog'>) {
  return write(db, { actorType: AuditActorType.SYSTEM, action: AuditAction.WORKSPACE_CREATE_FAILED, resourceType: 'workspace', success: false, metadata: { reason: 'BOOTSTRAP_FAILED' } });
}
export function auditBootstrap(tx: Prisma.TransactionClient, tenantId: string, userId: string, plan: string) {
  return write(tx, { tenantId, actorUserId: userId, actorType: AuditActorType.SYSTEM, action: AuditAction.WORKSPACE_CREATED, resourceType: 'workspace', resourceId: tenantId, metadata: { plan } });
}
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  record(context: AuditContext) {
    const actor = auditActor.getStore();
    if (actor && (context.tenantId !== actor.tenantId || context.actorUserId !== actor.userId)) throw new ForbiddenException('Audit context mismatch.');
    return write(this.prisma, context);
  }
  async listForHotel(tenantId: string, offset: number, limit: number, action?: AuditAction) {
    const actor = auditActor.getStore();
    if (actor && actor.tenantId !== tenantId) throw new ForbiddenException('Audit read tenant does not match authenticated context.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { type: true } });
    if (tenant?.type !== 'HOTEL') throw new ForbiddenException('Hotel audit requires a HOTEL tenant.');
    const rows = await this.prisma.auditLog.findMany({ where: { tenantId, ...(action ? { action } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit + 1,
      select: { id: true, createdAt: true, actorType: true, actorUser: { select: { name: true } }, action: true, resourceType: true, resourceId: true, success: true, metadata: true } });
    return { items: rows.slice(0, limit).map(row => ({ ...row, metadata: safeAuditMetadata(row.metadata as Prisma.InputJsonValue) })), hasMore: rows.length > limit, offset, limit };
  }
}
