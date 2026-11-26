export interface ServiceConfig {
  name: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  databaseUrl: string | null;
  internalApiKey: string;
  tenantHeader: string;
  jwtIssuer: string;
}

function requireProductionSecret(value: string | undefined, fallback: string, key: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${key} est obligatoire en production.`);
  }
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const environment =
    env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  return {
    name: env.SERVICE_NAME ?? 'service-template',
    port: Number(env.PORT ?? 4000),
    environment,
    databaseUrl: env.DATABASE_URL ?? null,
    internalApiKey: requireProductionSecret(
      env.INTERNAL_API_KEY,
      'dev-interne-resto-hub',
      'INTERNAL_API_KEY',
    ),
    tenantHeader: 'x-tenant-id',
    jwtIssuer: env.JWT_ISSUER ?? 'resto-hub',
  };
}

export const SERVICE_CONFIG = 'SERVICE_CONFIG';
