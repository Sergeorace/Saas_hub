export interface LoyaltyConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  orderUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadLoyaltyConfig(): LoyaltyConfig {
  const production = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.LOYALTY_PORT ?? 4006),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    orderUrl: process.env.ORDER_URL ?? 'http://127.0.0.1:4005',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
  };
}
