export interface SupervisedService {
  name: string;
  url: string;
}

export interface PlatformAdminConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
  services: SupervisedService[];
  healthIntervalMs: number;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function serviceUrl(name: string, fallbackPort: number): string {
  return process.env[`${name}_URL`] ?? `http://127.0.0.1:${fallbackPort}`;
}

export function loadPlatformAdminConfig(): PlatformAdminConfig {
  const production = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.PLATFORM_ADMIN_PORT ?? 4013),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
    services: [
      { name: 'identity-service', url: serviceUrl('IDENTITY', 4001) },
      { name: 'tenant-service', url: serviceUrl('TENANT', 4002) },
      { name: 'catalog-service', url: serviceUrl('CATALOG', 4003) },
      { name: 'floor-service', url: serviceUrl('FLOOR', 4004) },
      { name: 'order-service', url: serviceUrl('ORDER', 4005) },
      { name: 'loyalty-marketing-service', url: serviceUrl('LOYALTY', 4006) },
      { name: 'payment-service', url: serviceUrl('PAYMENT', 4007) },
      { name: 'staff-service', url: serviceUrl('STAFF', 4008) },
      { name: 'payroll-service', url: serviceUrl('PAYROLL', 4009) },
      { name: 'inventory-service', url: serviceUrl('INVENTORY', 4010) },
      { name: 'notification-service', url: serviceUrl('NOTIFICATION', 4011) },
      { name: 'reporting-service', url: serviceUrl('REPORTING', 4012) },
    ],
    healthIntervalMs: Number(process.env.HEALTH_INTERVAL_MS ?? 20_000),
  };
}
