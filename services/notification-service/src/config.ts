export interface NotificationConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  tenantUrl: string;
  smsWebhookSecret: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadNotificationConfig(): NotificationConfig {
  const production = process.env.NODE_ENV === 'production';
  return {
    port: Number(process.env.NOTIFICATION_PORT ?? 4011),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    tenantUrl: process.env.TENANT_URL ?? 'http://127.0.0.1:4002',
    smsWebhookSecret: process.env.SMS_WEBHOOK_SECRET ?? (production ? '' : 'dev-sms-webhook-secret'),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
  };
}
