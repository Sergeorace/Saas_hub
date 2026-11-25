import { useEffect, useState } from 'react';

export interface RouteLocation {
  /** Chemin logique, ex. "/e/sahel-grill/menu". */
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function currentHash(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function parseLocation(hash = currentHash()): RouteLocation {
  const [rawPath, rawQuery = ''] = hash.split('?');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { path, segments, query: new URLSearchParams(rawQuery) };
}

export function useLocation(): RouteLocation {
  const [location, setLocation] = useState<RouteLocation>(() => parseLocation());
  useEffect(() => {
    const onChange = () => setLocation(parseLocation());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return location;
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (options.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function withQuery(path: string, query: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

/**
 * Les QR de table (`/t/:tenantId/:code?k=`) et les liens de suivi
 * (`/suivi/:tenantId/:orderId?k=`) générés par les services pointent vers des
 * chemins classiques. On les convertit en routes de l'application cliente.
 */
export function adoptLegacyPaths() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const table = /^\/t\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (table) {
    const key = params.get('k') ?? '';
    window.history.replaceState(null, '', `/`);
    navigate(
      withQuery(`/e/${encodeURIComponent(table[1])}/menu`, { table: decodeURIComponent(table[2]), k: key }),
      { replace: true },
    );
    return;
  }
  const tracking = /^\/suivi\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (tracking) {
    window.history.replaceState(null, '', `/`);
    navigate(
      withQuery(`/suivi/${encodeURIComponent(tracking[1])}/${encodeURIComponent(tracking[2])}`, {
        k: params.get('k') ?? '',
      }),
      { replace: true },
    );
    return;
  }
  const reservation = /^\/reservation\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (reservation) {
    window.history.replaceState(null, '', `/`);
    navigate(
      withQuery(`/e/${encodeURIComponent(reservation[1])}/reservation`, {
        res: decodeURIComponent(reservation[2]),
        k: params.get('k') ?? '',
      }),
      { replace: true },
    );
  }
}

export function parseTableQr(raw: string): { tenantKey: string; code: string; token: string } | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    const match = /\/t\/([^/]+)\/([^/?#]+)/.exec(url.pathname);
    if (match) {
      return {
        tenantKey: decodeURIComponent(match[1]),
        code: decodeURIComponent(match[2]),
        token: url.searchParams.get('k') ?? '',
      };
    }
  } catch {
    /* pas une URL : essayer le format compact */
  }
  const compact = /^([a-z0-9_]+)[/:]([A-Za-z0-9-]+)(?:\?k=([\w-]+))?$/.exec(value);
  if (compact) return { tenantKey: compact[1], code: compact[2], token: compact[3] ?? '' };
  return null;
}
