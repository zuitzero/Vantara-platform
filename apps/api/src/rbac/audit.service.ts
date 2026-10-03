import { Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  tenantId?: string;
  actorUserId?: string;
  actorType?: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  success?: boolean;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(context: AuditContext) {
    return this.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        actorType: context.actorType ?? AuditActorType.USER,
        action: context.action,
        resourceType: context.resourceType,
        resourceId: context.resourceId,
        success: context.success ?? true,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: context.metadata,
      },
    });
  }
}
