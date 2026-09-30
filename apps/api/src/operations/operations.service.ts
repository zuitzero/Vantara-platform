import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCheckResult, OperationsHealthSnapshot, ServiceHealth } from './operations.types';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async checkDatabase(): Promise<HealthCheckResult> {
    const startedAt = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Math.round(performance.now() - startedAt);
      return { status: latencyMs > 500 ? 'DEGRADED' : 'UP', latencyMs, checkedAt: new Date().toISOString() };
    } catch (error) {
      return { status: 'DOWN', latencyMs: Math.round(performance.now() - startedAt), checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Database check failed' };
    }
  }

  async health(): Promise<OperationsHealthSnapshot> {
    const checkedAt = new Date().toISOString();
    const database = await this.checkDatabase();
    const realtime: HealthCheckResult = { status: 'UP', latencyMs: 0, checkedAt };
    const api: HealthCheckResult = { status: 'UP', latencyMs: 0, checkedAt };
    const statuses: ServiceHealth[] = [database.status, realtime.status, api.status];
    const status: ServiceHealth = statuses.includes('DOWN') ? 'DOWN' : statuses.includes('DEGRADED') ? 'DEGRADED' : 'UP';
    return { service: 'vantara-api', status, checkedAt, checks: { database, realtime, api } };
  }
}
