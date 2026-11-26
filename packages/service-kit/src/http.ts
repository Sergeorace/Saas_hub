import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface AuthClaims {
  sub: string;
  sid: string;
  email?: string;
  phone?: string;
  name: string;
  mfa: boolean;
  platformRoles: string[];
  platformPermissions: string[];
  tenantPermissions: Record<string, string[]>;
}

export interface RequestContext {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  requestId: string;
  auth?: AuthClaims;
  service: boolean;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: { data: Buffer; contentType: string; fileName?: string };
}

export type Handler = (ctx: RequestContext) => Promise<Reply | void> | Reply | void;

export interface Route {
  method: HttpMethod;
  path: string;
  handler: Handler;
  auth?: boolean;
  service?: boolean;
}

export type Authenticator = (token: string) => Promise<AuthClaims | undefined>;

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export interface ServiceServerOptions {
  name: string;
  routes: Route[];
  authenticate?: Authenticator;
  internalKey?: string;
  corsOrigin?: string;
  bodyLimitBytes?: number;
  rateLimit?: RateLimitOptions | false;
  onError?: (error: unknown, ctx: RequestContext) => void;
}

const RATE_LIMIT_DEFAULT: Required<RateLimitOptions> = { windowMs: 60_000, max: 600 };

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(segments[i]);
    } else if (part !== segments[i]) {
      return null;
    }
  }
  return params;
}

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'payload_too_large', 'Corps de requête trop volumineux.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      const text = Buffer.concat(chunks).toString('utf8');
      const contentType = String(req.headers['content-type'] ?? '');
      if (!contentType.includes('json')) return resolve(text);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(HttpError.badRequest('invalid_json', 'JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string>,
) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    ...headers,
  });
  res.end(body);
}

export function createServiceServer(options: ServiceServerOptions): Server {
  const limit = options.bodyLimitBytes ?? 6 * 1024 * 1024;
  const startedAt = Date.now();
  const rateLimit =
    options.rateLimit === false ? null : { ...RATE_LIMIT_DEFAULT, ...(options.rateLimit ?? {}) };
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const enforceRateLimit = (ip: string, path: string): number | null => {
    if (!rateLimit) return null;
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + rateLimit.windowMs });
      if (buckets.size > 10_000) {
        for (const [key, entry] of buckets) {
          if (entry.resetAt <= now) buckets.delete(key);
        }
      }
      return null;
    }
    bucket.count += 1;
    if (bucket.count > rateLimit.max) {
      console.warn(`[${options.name}] limitation de débit atteinte pour ${ip} sur ${path}`);
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }
    return null;
  };

  return createServer(async (req, res) => {
    const started = Date.now();
    const requestId = randomUUID();
    const cors: Record<string, string> = {};
    const origin = String(req.headers.origin ?? '');
    if (
      origin &&
      (!options.corsOrigin || options.corsOrigin === '*' || origin === options.corsOrigin)
    ) {
      cors['access-control-allow-origin'] = origin;
      cors['vary'] = 'Origin';
      cors['access-control-allow-headers'] =
        'authorization, content-type, x-internal-key, x-request-id';
      cors['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    }
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);
    const method = (req.method ?? 'GET').toUpperCase();

    const ctx: RequestContext = {
      method: method as HttpMethod,
      path: url.pathname,
      params: {},
      query: url.searchParams,
      body: undefined,
      headers: req.headers,
      ip: req.socket.remoteAddress ?? 'unknown',
      requestId,
      service: false,
    };

    try {
      if (!methods.has(method))
        throw new HttpError(405, 'method_not_allowed', 'Méthode non supportée.');
      const route = options.routes.find((candidate) => {
        if (candidate.method !== method) return false;
        const params = matchPath(candidate.path, segments);
        if (!params) return false;
        ctx.params = params;
        return true;
      });

      if (!route && method === 'GET' && url.pathname === '/health') {
        sendJson(
          res,
          200,
          {
            service: options.name,
            status: 'ok',
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            now: new Date().toISOString(),
          },
          cors,
        );
        return;
      }

      if (!route) throw HttpError.notFound('Route inconnue.');

      if (!route.service && url.pathname !== '/health') {
        const retryAfter = enforceRateLimit(req.socket.remoteAddress ?? 'unknown', url.pathname);
        if (retryAfter !== null) {
          sendJson(
            res,
            429,
            {
              error: {
                code: 'rate_limited',
                message: 'Trop de requêtes. Réessayez dans un instant.',
                details: { retryAfterSeconds: retryAfter },
                requestId,
              },
            },
            { ...cors, 'retry-after': String(retryAfter) },
          );
          return;
        }
      }

      ctx.body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req, limit);

      if (route.service) {
        const key = String(req.headers['x-internal-key'] ?? '');
        if (!options.internalKey || key !== options.internalKey) {
          throw HttpError.unauthorized('Clé de service invalide.');
        }
        ctx.service = true;
      } else if (route.auth !== false) {
        const header = String(req.headers.authorization ?? '');
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (!token) throw HttpError.unauthorized();
        const claims = await options.authenticate?.(token);
        if (!claims) throw HttpError.unauthorized('Session invalide ou expirée.');
        ctx.auth = claims;
      }

      const result = (await route.handler(ctx)) ?? {};
      const headers = { ...cors, ...(result.headers ?? {}) };
      if (result.raw) {
        res.writeHead(result.status ?? 200, {
          'content-type': result.raw.contentType,
          'content-length': String(result.raw.data.length),
          ...(result.raw.fileName
            ? {
                'content-disposition': `inline; filename="${result.raw.fileName.replace(/"/g, '')}"`,
              }
            : {}),
          ...headers,
        });
        res.end(result.raw.data);
        return;
      }
      sendJson(res, result.status ?? 200, result.body ?? { ok: true }, headers);
      if (res.statusCode >= 500) {
        console.error(
          `[${options.name}] ${method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`,
        );
      }
    } catch (error) {
      if (options.onError) options.onError(error, ctx);
      if (error instanceof HttpError) {
        sendJson(
          res,
          error.status,
          {
            error: { code: error.code, message: error.message, details: error.details, requestId },
          },
          cors,
        );
        return;
      }
      console.error(`[${options.name}] unhandled error ${requestId}`, error);
      sendJson(
        res,
        500,
        { error: { code: 'internal_error', message: 'Erreur interne.', requestId } },
        cors,
      );
    }
  });
}

export interface RunningServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(options: ServiceServerOptions, port = 0): Promise<RunningServer> {
  const server = createServiceServer(options);
  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    url: `http://127.0.0.1:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
