import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ServiceHealth = 'UP' | 'DOWN' | 'DEGRADED';

export interface OperationsHealth {
  service: 'vantara-api';
  status: ServiceHealth;
  checkedAt: string;
  checks: {
    database: { status: ServiceHealth; latencyMs: number };
  };
}

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async health(): Promise<OperationsHealth> {
    const startedAt = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Math.round(performance.now() - startedAt);
      return {
        service: 'vantara-api',
        status: latencyMs > 500 ? 'DEGRADED' : 'UP',
        checkedAt: new Date().toISOString(),
        checks: { database: { status: 'UP', latencyMs } },
      };
    } catch {
      return {
        service: 'vantara-api',
        status: 'DOWN',
        checkedAt: new Date().toISOString(),
        checks: { database: { status: 'DOWN', latencyMs: Math.round(performance.now() - startedAt) } },
      };
    }
  }
}
