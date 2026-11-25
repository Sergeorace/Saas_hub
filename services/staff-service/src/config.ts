export interface StaffConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadStaffConfig(): StaffConfig {
  const production = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.STAFF_PORT ?? 4008),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
  };
}
