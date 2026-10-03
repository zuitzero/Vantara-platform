export type ServiceHealth = 'UP' | 'DOWN' | 'DEGRADED';

export interface HealthCheckResult {
  status: ServiceHealth;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface OperationsHealthSnapshot {
  service: 'vantara-api';
  status: ServiceHealth;
  checkedAt: string;
  checks: {
    database: HealthCheckResult;
    realtime: HealthCheckResult;
    api: HealthCheckResult;
  };
}
