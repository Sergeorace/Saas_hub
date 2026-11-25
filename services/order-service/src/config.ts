export interface OrderConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  catalogUrl: string;
  floorUrl: string;
  tenantUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  appPublicUrl: string;
  timeZone: string;
  vatRate: number;
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadOrderConfig(): OrderConfig {
  const production = process.env.NODE_ENV === 'production';
  const vat = Number(process.env.ORDER_VAT_RATE ?? 0.18);
  return {
    port: Number(process.env.ORDER_PORT ?? 4005),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    catalogUrl: process.env.CATALOG_URL ?? 'http://127.0.0.1:4003',
    floorUrl: process.env.FLOOR_URL ?? 'http://127.0.0.1:4004',
    tenantUrl: process.env.TENANT_URL ?? 'http://127.0.0.1:4002',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    appPublicUrl: process.env.CLIENT_APP_URL ?? 'https://app.resto-hub.tg',
    timeZone: process.env.ORDER_TIMEZONE ?? 'Africa/Lome',
    vatRate: Number.isFinite(vat) && vat >= 0 && vat < 1 ? vat : 0.18,
    demoSeed: envFlag('DEMO_SEED', !production),
  };
}
