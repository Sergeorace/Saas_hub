import { useCallback, useEffect, useRef, useState } from 'react';
import { accountApi, publicApi, type Establishment, type EstablishmentSite } from './api';
import { useSession } from './session';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (alive) {
          setData(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload };
}

export function useFavorites() {
  const { user } = useSession();
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    if (!user) {
      setIds(new Set());
      return;
    }
    accountApi
      .favorites()
      .then((result) => {
        if (alive) setIds(new Set(result.items.map((item) => item.tenantId)));
      })
      .catch(() => {
        /* favoris optionnels : échec silencieux */
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const toggle = useCallback(
    async (tenantId: string) => {
      if (!user) return false;
      const isFavorite = ids.has(tenantId);
      const next = new Set(ids);
      if (isFavorite) {
        next.delete(tenantId);
        setIds(next);
        try {
          await accountApi.removeFavorite(tenantId);
        } catch {
          setIds(new Set(ids));
        }
      } else {
        next.add(tenantId);
        setIds(next);
        try {
          await accountApi.addFavorite(tenantId);
        } catch {
          setIds(new Set(ids));
        }
      }
      return !isFavorite;
    },
    [ids, user],
  );

  return { favoriteIds: ids, toggle };
}

export function useEstablishment(
  key: string | undefined,
): AsyncState<{ establishment: Establishment; sites: EstablishmentSite[] }> {
  return useAsync(
    () => (key ? publicApi.establishment(key) : Promise.reject(new Error('Établissement introuvable.'))),
    [key],
  );
}
