export interface PaymentConfig {
  port: number;
  internalKey: string;
  identityUrl: string;
  tenantUrl: string;
  orderUrl: string;
  corsOrigin: string;
  eventSubscribers: string[];
  demoSeed: boolean;
  sandbox: boolean;
  providerKeys: Record<string, string | undefined>;
  webhookSecrets: Record<string, string>;
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

const PROVIDER_ENV = {
  tmoney: 'TMONEY_API_KEY',
  moov_money: 'MOOV_MONEY_API_KEY',
  cinetpay: 'CINETPAY_API_KEY',
  paydunya: 'PAYDUNYA_API_KEY',
  fedapay: 'FEDAPAY_API_KEY',
  paygate: 'PAYGATE_API_KEY',
  stripe: 'STRIPE_SECRET_KEY',
} as const;

export function loadPaymentConfig(): PaymentConfig {
  const production = process.env.NODE_ENV === 'production';
  const providerKeys: Record<string, string | undefined> = {};
  const webhookSecrets: Record<string, string> = {};
  for (const [id, envName] of Object.entries(PROVIDER_ENV)) {
    providerKeys[id] = process.env[envName];
    const secretName = `PAYMENT_WEBHOOK_SECRET_${id.toUpperCase()}`;
    webhookSecrets[id] = process.env[secretName] ?? 'whsec_sandbox';
  }
  return {
    port: Number(process.env.PAYMENT_PORT ?? 4007),
    internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
    identityUrl: process.env.IDENTITY_URL ?? 'http://127.0.0.1:4001',
    tenantUrl: process.env.TENANT_URL ?? 'http://127.0.0.1:4002',
    orderUrl: process.env.ORDER_URL ?? 'http://127.0.0.1:4005',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    eventSubscribers: (process.env.EVENT_SUBSCRIBERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    demoSeed: envFlag('DEMO_SEED', !production),
    sandbox: envFlag('PAYMENT_SANDBOX', !production),
    providerKeys,
    webhookSecrets,
  };
}
