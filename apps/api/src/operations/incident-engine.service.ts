import { Injectable, Logger } from '@nestjs/common';
import { IncidentStatus, NotificationSeverity, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsHealthSnapshot } from './operations.types';

@Injectable()
export class IncidentEngineService {
  private readonly logger = new Logger(IncidentEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async evaluate(snapshot: OperationsHealthSnapshot, zuitzeroTenantId?: string) {
    if (!zuitzeroTenantId) return this.list();

    for (const [service, check] of Object.entries(snapshot.checks)) {
      const openIncident = await this.prisma.operationsIncident.findFirst({
        where: { tenantId: zuitzeroTenantId, service, status: { in: [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED] } },
        orderBy: { firstDetectedAt: 'desc' },
      });

      if (check.status === 'UP') {
        if (openIncident) {
          const resolved = await this.prisma.operationsIncident.update({
            where: { id: openIncident.id },
            data: { status: IncidentStatus.RESOLVED, resolvedAt: new Date(snapshot.checkedAt), lastDetectedAt: new Date(snapshot.checkedAt) },
          });
          await this.notifications.publish({
            tenantId: zuitzeroTenantId,
            audience: 'ZUITZERO',
            severity: 'INFO',
            channel: 'IN_APP',
            type: 'operations.incident.resolved',
            title: `${service} recovered`,
            message: `Vantara ${service} is operational again.`,
            metadata: { incidentId: resolved.id, service, resolvedAt: resolved.resolvedAt },
          });
        }
        continue;
      }

      const severity: NotificationSeverity = check.status === 'DOWN' ? 'CRITICAL' : 'WARNING';
      const message = check.error ?? `${service} health check is ${check.status.toLowerCase()} (${check.latencyMs}ms).`;

      if (openIncident) {
        await this.prisma.operationsIncident.update({
          where: { id: openIncident.id },
          data: { severity, lastDetectedAt: new Date(snapshot.checkedAt), occurrenceCount: { increment: 1 }, message },
        });
        continue;
      }

      const incident = await this.prisma.operationsIncident.create({
        data: {
          tenantId: zuitzeroTenantId,
          service,
          severity,
          status: IncidentStatus.OPEN,
          title: `Vantara ${service} ${check.status.toLowerCase()}`,
          message,
          firstDetectedAt: new Date(snapshot.checkedAt),
          lastDetectedAt: new Date(snapshot.checkedAt),
          metadata: { latencyMs: check.latencyMs } as Prisma.InputJsonValue,
        },
      });

      this.logger.error(`${incident.title}: ${incident.message}`);
      await this.notifications.publish({
        tenantId: zuitzeroTenantId,
        audience: 'ZUITZERO',
        severity,
        channel: 'IN_APP',
        type: 'operations.incident.opened',
        title: incident.title,
        message: incident.message,
        metadata: { incidentId: incident.id, service, detectedAt: incident.firstDetectedAt },
      });
    }

    return this.list(zuitzeroTenantId);
  }

  list(tenantId?: string) {
    return this.prisma.operationsIncident.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { firstDetectedAt: 'desc' },
      take: 100,
    });
  }
}
