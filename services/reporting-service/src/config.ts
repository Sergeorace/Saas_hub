export interface ReportingConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  orderUrl: string;
  inventoryUrl: string;
  floorUrl: string;
  tenantUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadReportingConfig(): ReportingConfig {
  const production = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.REPORTING_PORT ?? 4012),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    orderUrl: process.env.ORDER_URL ?? 'http://127.0.0.1:4005',
    inventoryUrl: process.env.INVENTORY_URL ?? 'http://127.0.0.1:4010',
    floorUrl: process.env.FLOOR_URL ?? 'http://127.0.0.1:4004',
    tenantUrl: process.env.TENANT_URL ?? 'http://127.0.0.1:4002',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
  };
}
