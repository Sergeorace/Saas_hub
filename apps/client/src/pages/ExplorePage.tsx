import { useEffect, useMemo, useState } from 'react';
import { Icon, Skeleton, cx, useI18n, useToast } from '@resto-hub/design-system';
import { publicApi, type ReviewAggregate } from '../lib/api';
import { useAsync, useFavorites } from '../lib/hooks';
import { useLocation, navigate, withQuery } from '../lib/router';
import { useSession } from '../lib/session';
import { isOpenNow } from '../lib/format';
import { ClientBottomBar, ClientHeader, SectionTitle } from '../components/ClientChrome';
import { EstablishmentCard } from '../components/EstablishmentCard';
import { PlacesMap } from '../components/PlacesMap';

interface ExploreData {
  items: Awaited<ReturnType<typeof publicApi.establishments>>['items'];
  cities: string[];
  ratings: Record<string, ReviewAggregate | null>;
}

export default function ExplorePage() {
  const { t } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const { user } = useSession();
  const { favoriteIds, toggle } = useFavorites();

  const initialQ = location.query.get('q') ?? '';
  const initialKind = location.query.get('kind') ?? 'all';
  const initialCity = location.query.get('city') ?? 'all';
  const initialView = location.query.get('view') === 'map' ? 'map' : 'list';

  const [q, setQ] = useState(initialQ);
  const [kind, setKind] = useState(initialKind);
  const [city, setCity] = useState(initialCity);
  const [view, setView] = useState<'list' | 'map'>(initialView);
  const [openOnly, setOpenOnly] = useState(false);

  useEffect(() => {
    setQ(initialQ);
    setKind(initialKind);
    setCity(initialCity);
    setView(initialView);
  }, [initialQ, initialKind, initialCity, initialView]);

  const query = { q: q.trim(), kind, city };
  const { data, loading, error, reload } = useAsync<ExploreData>(async () => {
    const [all, filtered] = await Promise.all([
      publicApi.establishments(),
      publicApi.establishments(query),
    ]);
    const ratings = await Promise.all(
      filtered.items.map(async (item) => {
        try {
          const reviews = await publicApi.reviews(item.id, 1);
          return [item.id, reviews.aggregate] as const;
        } catch {
          return [item.id, null] as const;
        }
      }),
    );
    const cities = Array.from(
      new Set(all.items.map((item) => item.address?.city).filter((value): value is string => Boolean(value))),
    ).sort();
    return { items: filtered.items, cities, ratings: Object.fromEntries(ratings) };
  }, [query.q, query.kind, query.city]);

  const applyFilters = (next: { q?: string; kind?: string; city?: string; view?: 'list' | 'map' }) => {
    navigate(
      withQuery('/recherche', {
        q: next.q ?? q.trim(),
        kind: next.kind ?? kind,
        city: next.city ?? city,
        view: next.view ?? view,
      }),
    );
  };

  const items = useMemo(() => {
    const list = data?.items ?? [];
    return openOnly ? list.filter((item) => isOpenNow(item)) : list;
  }, [data, openOnly]);

  const onFavorite = async (tenantId: string) => {
    if (!user) {
      toast.push({ title: t('common.signInRequired'), description: t('establishment.favoriteLogin'), tone: 'info' });
      navigate('/compte');
      return;
    }
    const added = await toggle(tenantId);
    toast.push({ title: added ? t('establishment.favorited') : t('establishment.favorite'), tone: 'success' });
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('explore.title')} subtitle={t('explore.subtitle')} back="/" />
      <main className="rh-client-page rh-client-page--flush">
        <form
          className="rh-client-search rh-client-search--compact"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({});
          }}
        >
          <Icon name="search" size="sm" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('common.search')}
            enterKeyHint="search"
          />
          {q && (
            <button
              type="button"
              className="rh-client-search__clear"
              aria-label={t('explore.reset')}
              onClick={() => {
                setQ('');
                applyFilters({ q: '' });
              }}
            >
              <Icon name="x" size="sm" />
            </button>
          )}
        </form>

        <div className="rh-client-chips" role="group" aria-label={t('explore.kind')}>
          {[
            { id: 'all', label: t('explore.anyKind') },
            { id: 'restaurant', label: t('explore.restaurant') },
            { id: 'bar', label: t('explore.bar') },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={cx('rh-client-chip', kind === option.id && 'rh-client-chip--active')}
              aria-pressed={kind === option.id}
              onClick={() => {
                setKind(option.id);
                applyFilters({ kind: option.id });
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className={cx('rh-client-chip', openOnly && 'rh-client-chip--active')}
            aria-pressed={openOnly}
            onClick={() => setOpenOnly((value) => !value)}
          >
            <span className="rh-client-chip__dot" aria-hidden="true" /> {t('explore.openNow')}
          </button>
        </div>

        <div className="rh-client-toolbar">
          <div className="rh-client-segmented" role="tablist" aria-label={t('explore.title')}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              className={cx(view === 'list' && 'is-active')}
              onClick={() => {
                setView('list');
                applyFilters({ view: 'list' });
              }}
            >
              <Icon name="grid" size="sm" /> {t('explore.listView')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'map'}
              className={cx(view === 'map' && 'is-active')}
              onClick={() => {
                setView('map');
                applyFilters({ view: 'map' });
              }}
            >
              <Icon name="pin" size="sm" /> {t('explore.mapView')}
            </button>
          </div>
          {(data?.cities.length ?? 0) > 0 && (
            <label className="rh-client-selectline">
              <Icon name="pin" size="sm" />
              <select
                value={city}
                aria-label={t('explore.city')}
                onChange={(event) => {
                  setCity(event.target.value);
                  applyFilters({ city: event.target.value });
                }}
              >
                <option value="all">{t('explore.allCities')}</option>
                {data?.cities.map((name) => (
                  <option value={name} key={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="rh-client-results">{t('explore.results', { count: items.length })}</p>

        {loading ? (
          <div className="rh-client-place-list">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={188} />
            ))}
          </div>
        ) : error ? (
          <div className="rh-client-error">
            <p>{error.message}</p>
            <button type="button" className="rh-client-link-btn" onClick={reload}>
              {t('common.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="search" />
            </span>
            <h2>{t('explore.noResults')}</h2>
            <p>{t('explore.noResultsDesc')}</p>
            <button
              type="button"
              className="rh-client-link-btn"
              onClick={() => {
                setQ('');
                setKind('all');
                setCity('all');
                setOpenOnly(false);
                navigate('/recherche');
              }}
            >
              {t('explore.reset')}
            </button>
          </div>
        ) : view === 'map' ? (
          <PlacesMap establishments={items} />
        ) : (
          <>
            <SectionTitle title={t('explore.results', { count: items.length })} />
            <div className="rh-client-place-list">
              {items.map((item) => (
                <EstablishmentCard
                  key={item.id}
                  establishment={item}
                  rating={data?.ratings[item.id]?.average}
                  reviews={data?.ratings[item.id]?.count}
                  favorite={favoriteIds.has(item.id)}
                  onFavorite={() => onFavorite(item.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>
      <ClientBottomBar active="explore" />
    </div>
  );
}
