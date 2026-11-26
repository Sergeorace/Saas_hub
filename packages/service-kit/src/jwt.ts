import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'access' | 'mfa' | 'stepup';

export interface TokenClaims {
  sub: string;
  sid: string;
  name?: string;
  email?: string;
  phone?: string;
  kind: TokenKind;
  purpose?: string;
  iss: string;
  iat: number;
  exp: number;
}

function encode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signToken(
  claims: Omit<TokenClaims, 'iat' | 'exp' | 'iss'> & { iss?: string },
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenClaims = {
    ...claims,
    iss: claims.iss ?? 'resto-hub',
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encode(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifyToken(
  token: string,
  secret: string,
  expectedKind?: TokenKind,
): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    if (!claims.sub || !claims.kind) return null;
    if (expectedKind && claims.kind !== expectedKind) return null;
    if (claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
