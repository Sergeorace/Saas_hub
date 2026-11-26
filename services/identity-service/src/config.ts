export interface IdentityConfig {
  port: number;
  tokenSecret: string;
  internalKey: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoOtp: boolean;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  otpTtlSeconds: number;
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadIdentityConfig(): IdentityConfig {
  const production = process.env.NODE_ENV === 'production';
  const tokenSecret = process.env.IDENTITY_TOKEN_SECRET ?? 'dev-identity-secret-change-me';
  const internalKey = process.env.INTERNAL_API_KEY ?? 'dev-internal-key';
  if (production && (!process.env.IDENTITY_TOKEN_SECRET || !process.env.INTERNAL_API_KEY)) {
    throw new Error('IDENTITY_TOKEN_SECRET et INTERNAL_API_KEY sont obligatoires en production.');
  }
  return {
    port: Number(process.env.IDENTITY_PORT ?? 4001),
    tokenSecret,
    internalKey,
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoOtp: envFlag('DEMO_OTP', !production),
    accessTtlSeconds: Number(process.env.ACCESS_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
    otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
    demoSeed: envFlag('DEMO_SEED', true),
  };
}
