import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '../lib/format';

export type Messages = { [key: string]: unknown };

const STORAGE_KEY = 'restohub.locale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Chaîne traduite avec interpolation {variable}. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Valeur structurée (listes, objets) pour les blocs de contenu. */
  tm: <T>(key: string) => T;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
}

function readInitialLocale(fallback: Locale): Locale {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    /* stockage indisponible */
  }
  return fallback;
}

export function I18nProvider({
  messages,
  defaultLocale = 'fr',
  children,
}: {
  messages: Record<Locale, Messages>;
  defaultLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => readInitialLocale(defaultLocale));

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* stockage indisponible */
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const value = resolve(messages[locale], key);
      const base =
        typeof value === 'string' ? value : resolve(messages[locale === 'fr' ? 'en' : 'fr'], key);
      if (typeof base !== 'string') return key;
      if (!vars) return base;
      return base.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    [locale, messages],
  );

  const tm = useCallback(
    <T,>(key: string): T => resolve(messages[locale], key) as T,
    [locale, messages],
  );

  const value = useMemo(() => ({ locale, setLocale, t, tm }), [locale, setLocale, t, tm]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n doit être utilisé dans un <I18nProvider>.');
  }
  return context;
}
