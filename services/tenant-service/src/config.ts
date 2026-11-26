export interface TenantConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  catalogUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  billingWebhookSecret: string;
  demoBilling: boolean;
  trialDays: number;
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadTenantConfig(): TenantConfig {
  const production = process.env.NODE_ENV === 'production';
  const internalKey = process.env.INTERNAL_API_KEY ?? 'dev-internal-key';
  const billingWebhookSecret = process.env.BILLING_WEBHOOK_SECRET ?? 'dev-billing-secret';
  if (production && (!process.env.INTERNAL_API_KEY || !process.env.BILLING_WEBHOOK_SECRET)) {
    throw new Error('INTERNAL_API_KEY et BILLING_WEBHOOK_SECRET sont obligatoires en production.');
  }
  return {
    port: Number(process.env.TENANT_PORT ?? 4002),
    internalKey,
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    catalogUrl: process.env.CATALOG_URL ?? 'http://127.0.0.1:4003',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    billingWebhookSecret,
    demoBilling: envFlag('DEMO_BILLING', !production),
    trialDays: Number(process.env.TRIAL_DAYS ?? 14),
    demoSeed: envFlag('DEMO_SEED', true),
  };
}
