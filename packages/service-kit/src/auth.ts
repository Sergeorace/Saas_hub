import { HttpError } from './errors.js';
import type { AuthClaims, Authenticator } from './http.js';

export interface IntrospectionOptions {
  identityUrl: string;
  internalKey: string;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

interface CacheEntry {
  claims: AuthClaims;
  expiresAt: number;
}

export function createIntrospectionAuthenticator(options: IntrospectionOptions): Authenticator {
  const cache = new Map<string, CacheEntry>();
  const ttl = options.cacheTtlMs ?? 15_000;
  const doFetch = options.fetchImpl ?? fetch;

  return async (token: string) => {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.claims;
    try {
      const response = await doFetch(`${options.identityUrl}/internal/introspect`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': options.internalKey,
        },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) return undefined;
      const data = (await response.json()) as { claims?: AuthClaims };
      if (!data.claims) return undefined;
      cache.set(token, { claims: data.claims, expiresAt: Date.now() + ttl });
      if (cache.size > 2_000) {
        for (const [key, entry] of cache) {
          if (entry.expiresAt <= Date.now()) cache.delete(key);
        }
      }
      return data.claims;
    } catch {
      return undefined;
    }
  };
}

export function hasPlatformPermission(claims: AuthClaims | undefined, permission: string): boolean {
  return Boolean(claims?.platformPermissions.includes(permission));
}

export function hasTenantPermission(
  claims: AuthClaims | undefined,
  tenantId: string,
  permission: string,
): boolean {
  if (!claims) return false;
  if (claims.platformPermissions.includes(permission)) return true;
  return Boolean(claims.tenantPermissions[tenantId]?.includes(permission));
}

export function requirePlatformPermission(
  claims: AuthClaims | undefined,
  permission: string,
): AuthClaims {
  if (!claims) throw HttpError.unauthorized();
  if (!hasPlatformPermission(claims, permission)) {
    throw HttpError.forbidden('Permission plateforme requise.');
  }
  return claims;
}

export function requireTenantPermission(
  claims: AuthClaims | undefined,
  tenantId: string,
  permission: string,
): AuthClaims {
  if (!claims) throw HttpError.unauthorized();
  if (!tenantId) throw HttpError.badRequest('tenant_required', 'Établissement non précisé.');
  if (!hasTenantPermission(claims, tenantId, permission)) {
    throw new HttpError(403, 'tenant_scope_denied', "Vous n'avez pas accès à cet établissement.");
  }
  return claims;
}
