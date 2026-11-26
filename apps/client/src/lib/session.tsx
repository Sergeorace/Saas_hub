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
  SESSION_KEY,
  authApi,
  setAccessToken,
  type ClientUser,
  type StoredSession,
  type TokenBundle,
} from './api';

interface SessionContextValue {
  session: StoredSession | null;
  user: ClientUser | null;
  signIn: (bundle: TokenBundle) => void;
  signOut: () => Promise<void>;
  /** Recharge le profil depuis identity-service (rôles, statut). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.accessToken && parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null) {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredSession | null>(() => {
    const stored = readSession();
    if (stored) setAccessToken(stored.accessToken);
    return stored;
  });

  const apply = useCallback((next: StoredSession | null) => {
    setAccessToken(next?.accessToken ?? null);
    writeSession(next);
    setSessionState(next);
  }, []);

  const signIn = useCallback(
    (bundle: TokenBundle) => {
      apply({
        accessToken: bundle.accessToken,
        refreshToken: bundle.refreshToken,
        user: bundle.user,
      });
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    const current = session;
    apply(null);
    if (current) {
      try {
        await authApi.logout(current.refreshToken);
      } catch {
        /* déconnexion locale suffisante */
      }
    }
  }, [apply, session]);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setSessionState((current) => {
        if (!current) return current;
        const next = { ...current, user: me.user };
        writeSession(next);
        return next;
      });
    } catch {
      /* le jeton sera rafraîchi à la prochaine requête authentifiée */
    }
  }, []);

  useEffect(() => {
    const onExpired = () => apply(null);
    const onTokens = (event: Event) => {
      const bundle = (event as CustomEvent<TokenBundle>).detail;
      setSessionState((current) =>
        current
          ? { ...current, accessToken: bundle.accessToken, refreshToken: bundle.refreshToken }
          : current,
      );
    };
    window.addEventListener('restohub:client-session-expired', onExpired);
    window.addEventListener('restohub:client-tokens', onTokens);
    return () => {
      window.removeEventListener('restohub:client-session-expired', onExpired);
      window.removeEventListener('restohub:client-tokens', onTokens);
    };
  }, [apply]);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, signIn, signOut, refresh }),
    [session, signIn, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession doit être utilisé dans un <SessionProvider>.');
  return context;
}

export function requireSessionMessage(isFr: boolean): string {
  return isFr
    ? 'Connectez-vous avec votre numéro de téléphone pour retrouver vos favoris, vos points et vos avis.'
    : 'Sign in with your phone number to keep your favorites, points and reviews.';
}
