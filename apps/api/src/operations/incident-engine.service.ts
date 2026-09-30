import { Injectable, Logger } from '@nestjs/common';
import { NotificationSeverity } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsHealthSnapshot } from './operations.types';

export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface OperationsIncident {
  id: string;
  status: IncidentStatus;
  severity: NotificationSeverity;
  title: string;
  message: string;
  detectedAt: string;
  resolvedAt?: string;
}

@Injectable()
export class IncidentEngineService {
  private readonly logger = new Logger(IncidentEngineService.name);
  private readonly incidents = new Map<string, OperationsIncident>();

  constructor(private readonly notifications: NotificationsService) {}

  async evaluate(snapshot: OperationsHealthSnapshot, zuitzeroTenantId?: string): Promise<OperationsIncident[]> {
    const incidents: OperationsIncident[] = [];
    for (const [service, check] of Object.entries(snapshot.checks)) {
      if (check.status === 'UP') continue;

      const id = `ops:${service}`;
      const existing = this.incidents.get(id);
      const severity: NotificationSeverity = check.status === 'DOWN' ? 'CRITICAL' : 'WARNING';
      const incident: OperationsIncident = existing ?? {
        id,
        status: 'OPEN',
        severity,
        title: `Vantara ${service} ${check.status.toLowerCase()}`,
        message: check.error ?? `${service} health check is ${check.status.toLowerCase()} (${check.latencyMs}ms).`,
        detectedAt: snapshot.checkedAt,
      };

      incident.severity = severity;
      incident.status = incident.status === 'RESOLVED' ? 'OPEN' : incident.status;
      this.incidents.set(id, incident);
      incidents.push(incident);

      if ((!existing || existing.status === 'RESOLVED') && zuitzeroTenantId) {
        this.logger.error(`${incident.title}: ${incident.message}`);
        await this.notifications.publish({
          tenantId: zuitzeroTenantId,
          audience: 'ZUITZERO',
          severity,
          channel: 'IN_APP',
          type: 'operations.incident.opened',
          title: incident.title,
          message: incident.message,
          metadata: { incidentId: id, service, detectedAt: incident.detectedAt },
        });
      }
    }

    for (const [id, incident] of this.incidents) {
      const service = id.replace('ops:', '') as keyof OperationsHealthSnapshot['checks'];
      const check = snapshot.checks[service];
      if (check?.status === 'UP' && incident.status !== 'RESOLVED') {
        incident.status = 'RESOLVED';
        incident.resolvedAt = snapshot.checkedAt;
        if (zuitzeroTenantId) {
          await this.notifications.publish({
            tenantId: zuitzeroTenantId,
            audience: 'ZUITZERO',
            severity: 'INFO',
            channel: 'IN_APP',
            type: 'operations.incident.resolved',
            title: `${service} recovered`,
            message: `Vantara ${service} is operational again.`,
            metadata: { incidentId: id, service, resolvedAt: incident.resolvedAt },
          });
        }
      }
    }

    return Array.from(this.incidents.values());
  }

  list() {
    return Array.from(this.incidents.values());
  }
}
