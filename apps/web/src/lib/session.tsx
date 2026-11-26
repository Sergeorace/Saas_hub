import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  identityApi,
  setAccessToken,
  type AuthClaimsView,
  type TokenBundle,
  type User,
} from './api';

const STORAGE_KEY = 'restohub.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  claims: AuthClaimsView;
}

export interface SessionValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  user?: User;
  claims?: AuthClaimsView;
  tokens?: { accessToken: string; refreshToken: string };
  signIn: (bundle: TokenBundle) => Promise<{ user: User; claims: AuthClaimsView }>;
  signOut: () => Promise<void>;
  reloadClaims: () => Promise<void>;
  hasPlatform: (permission: string) => boolean;
  tenants: Record<string, string[]>;
}

const SessionContext = createContext<SessionValue | null>(null);

let refreshInFlight: Promise<TokenBundle> | null = null;

function refreshOnce(refreshToken: string): Promise<TokenBundle> {
  refreshInFlight ??= identityApi.refresh(refreshToken).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function verifyAndRefresh(stored: StoredSession): Promise<StoredSession> {
  setAccessToken(stored.accessToken);
  try {
    const me = await identityApi.me();
    return { ...stored, user: me.user, claims: me.claims };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const bundle = await refreshOnce(stored.refreshToken);
    setAccessToken(bundle.accessToken);
    const me = await identityApi.me();
    return {
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      user: me.user,
      claims: me.claims,
    };
  }
}

function readStored(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null) {
  try {
    if (!session) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* stockage indisponible */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredSession | null>(() => {
    const initial = readStored();
    setAccessToken(initial?.accessToken ?? null);
    return initial;
  });
  const [status, setStatus] = useState<SessionValue['status']>(() =>
    readStored() ? 'loading' : 'anonymous',
  );

  const signIn = useCallback(async (bundle: TokenBundle) => {
    setAccessToken(bundle.accessToken);
    const me = await identityApi.me();
    const session: StoredSession = {
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      user: me.user,
      claims: me.claims,
    };
    writeStored(session);
    setStored(session);
    setStatus('authenticated');
    return { user: me.user, claims: me.claims };
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    writeStored(null);
    setStored(null);
    setStatus('anonymous');
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = stored?.refreshToken;
    clear();
    if (refreshToken) {
      try {
        await identityApi.logout(refreshToken);
      } catch {
        /* la session locale est déjà fermée */
      }
    }
  }, [stored, clear]);

  const reloadClaims = useCallback(async () => {
    if (!stored) return;
    try {
      const next = await verifyAndRefresh(stored);
      writeStored(next);
      setStored(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clear();
    }
  }, [stored, clear]);

  useEffect(() => {
    const onRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<TokenBundle>).detail;
      setStored((current) =>
        current
          ? { ...current, accessToken: detail.accessToken, refreshToken: detail.refreshToken }
          : current,
      );
    };
    const onExpired = () => clear();
    window.addEventListener('restohub:tokens-refreshed', onRefreshed);
    window.addEventListener('restohub:session-expired', onExpired);
    return () => {
      window.removeEventListener('restohub:tokens-refreshed', onRefreshed);
      window.removeEventListener('restohub:session-expired', onExpired);
    };
  }, [clear]);

  useEffect(() => {
    if (!stored || status === 'authenticated') return;
    let cancelled = false;
    (async () => {
      try {
        const next = await verifyAndRefresh(stored);
        if (cancelled) return;
        writeStored(next);
        setStored(next);
        setStatus('authenticated');
      } catch {
        if (!cancelled) clear();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.accessToken, status]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user: stored?.user,
      claims: stored?.claims,
      tokens: stored
        ? { accessToken: stored.accessToken, refreshToken: stored.refreshToken }
        : undefined,
      signIn,
      signOut,
      reloadClaims,
      hasPlatform: (permission) => Boolean(stored?.claims.platformPermissions.includes(permission)),
      tenants: stored?.claims.tenantPermissions ?? {},
    }),
    [status, stored, signIn, signOut, reloadClaims],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession doit être utilisé dans un <SessionProvider>.');
  return context;
}
