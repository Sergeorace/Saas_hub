import { useMemo, useState } from 'react';
import { Icon, Skeleton, formatXof, useI18n, useToast } from '@resto-hub/design-system';
import { publicApi, type ReviewAggregate } from '../lib/api';
import { useAsync, useFavorites } from '../lib/hooks';
import { useSession } from '../lib/session';
import { navigate } from '../lib/router';
import { ClientBottomBar, LocaleToggle, SectionTitle, ThemeToggle } from '../components/ClientChrome';
import { EstablishmentCard } from '../components/EstablishmentCard';

interface HomeData {
  items: Awaited<ReturnType<typeof publicApi.establishments>>['items'];
  ratings: Record<string, ReviewAggregate | null>;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { user } = useSession();
  const { favoriteIds, toggle } = useFavorites();
  const [query, setQuery] = useState('');

  const { data, loading } = useAsync<HomeData>(async () => {
    const listing = await publicApi.establishments();
    const ratings = await Promise.all(
      listing.items.map(async (item) => {
        try {
          const reviews = await publicApi.reviews(item.id, 1);
          return [item.id, reviews.aggregate] as const;
        } catch {
          return [item.id, null] as const;
        }
      }),
    );
    return { items: listing.items, ratings: Object.fromEntries(ratings) };
  }, []);

  const featured = data?.items ?? [];
  const favorites = useMemo(
    () => featured.filter((item) => favoriteIds.has(item.id)),
    [featured, favoriteIds],
  );
  const hero = featured[0];

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(query.trim() ? `/recherche?q=${encodeURIComponent(query.trim())}` : '/recherche');
  };

  const onFavorite = async (tenantId: string) => {
    if (!user) {
      toast.push({ title: t('common.signInRequired'), description: t('establishment.favoriteLogin'), tone: 'info' });
      navigate('/compte');
      return;
    }
    const added = await toggle(tenantId);
    toast.push({
      title: added ? t('establishment.favorited') : t('establishment.favorite'),
      tone: 'success',
    });
  };

  return (
    <div className="rh-client-screen">
      <header className="rh-client-hero-head">
        <div className="rh-client-brandline">
          <span className="rh-client-wordmark">
            <span className="rh-client-wordmark__dot" aria-hidden="true" />
            {t('common.appName')}
            <em>{t('common.clientTag')}</em>
          </span>
          <div className="rh-client-hero-head__actions">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
        <p className="rh-client-greeting">
          {user ? t('home.greetingName', { name: user.name }) : t('home.greeting')}
        </p>
        <h1 className="rh-client-hero-title">{t('home.heroTitle')}</h1>
        <p className="rh-client-hero-sub">{t('home.heroSub')}</p>

        <form className="rh-client-search" onSubmit={onSearch} role="search">
          <Icon name="search" size="sm" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('common.search')}
            enterKeyHint="search"
          />
          <button type="submit" aria-label={t('common.search')}>
            <Icon name="arrow-right" size="sm" />
          </button>
        </form>

        <div className="rh-client-chips" role="group" aria-label={t('explore.kind')}>
          <a href="#/recherche" className="rh-client-chip rh-client-chip--active">
            {t('common.all')}
          </a>
          <a href="#/recherche?kind=restaurant" className="rh-client-chip">
            {t('explore.restaurant')}
          </a>
          <a href="#/recherche?kind=bar" className="rh-client-chip">
            {t('explore.bar')}
          </a>
          <a href="#/scan" className="rh-client-chip rh-client-chip--accent">
            <Icon name="scan" size="sm" /> {t('home.quickScan')}
          </a>
        </div>
      </header>

      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-client-quick" aria-label={t('home.quickTitle')}>
          <button type="button" className="rh-client-quick-card" onClick={() => navigate('/scan')}>
            <span className="rh-client-quick-card__icon rh-client-quick-card__icon--primary">
              <Icon name="scan" />
            </span>
            <strong>{t('home.quickScan')}</strong>
            <span>{t('home.quickScanDesc')}</span>
          </button>
          <button
            type="button"
            className="rh-client-quick-card"
            onClick={() => navigate(hero ? `/e/${hero.slug}/reservation` : '/recherche')}
          >
            <span className="rh-client-quick-card__icon rh-client-quick-card__icon--secondary">
              <Icon name="calendar" />
            </span>
            <strong>{t('home.quickReserve')}</strong>
            <span>{t('home.quickReserveDesc')}</span>
          </button>
          <button type="button" className="rh-client-quick-card" onClick={() => navigate('/commandes')}>
            <span className="rh-client-quick-card__icon rh-client-quick-card__icon--info">
              <Icon name="receipt" />
            </span>
            <strong>{t('home.quickOrders')}</strong>
            <span>{t('home.quickOrdersDesc')}</span>
          </button>
          <button
            type="button"
            className="rh-client-quick-card"
            onClick={() => navigate(hero ? `/e/${hero.slug}/fidelite` : '/compte')}
          >
            <span className="rh-client-quick-card__icon rh-client-quick-card__icon--accent">
              <Icon name="gift" />
            </span>
            <strong>{t('home.quickLoyalty')}</strong>
            <span>{t('home.quickLoyaltyDesc')}</span>
          </button>
        </section>

        {hero && (
          <a
            className="rh-client-promo"
            href={`#/e/${hero.slug}/menu`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/e/${hero.slug}/menu`);
            }}
          >
            <img src={hero.photos[0]} alt="" className="rh-client-promo__img" loading="lazy" />
            <div className="rh-client-promo__body">
              <span className="rh-client-promo__tag">
                <Icon name="flame" size="sm" /> {t('home.promoTitle')}
              </span>
              <strong>{t('home.promoDesc')}</strong>
              <span className="rh-client-promo__cta">
                {t('establishment.menu')} <Icon name="arrow-right" size="sm" />
              </span>
            </div>
          </a>
        )}

        {user && favorites.length > 0 && (
          <section>
            <SectionTitle
              title={t('home.favorites')}
              action={
                <a className="rh-client-textlink" href="#/compte">
                  {t('common.seeAll')}
                </a>
              }
            />
            <div className="rh-client-place-list">
              {favorites.map((item) => (
                <EstablishmentCard
                  key={item.id}
                  establishment={item}
                  rating={data?.ratings[item.id]?.average}
                  reviews={data?.ratings[item.id]?.count}
                  favorite
                  onFavorite={() => onFavorite(item.id)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle
            title={t('home.nearby')}
            subtitle={t('home.nearbySub')}
            action={
              <a className="rh-client-textlink" href="#/recherche">
                {t('common.seeAll')}
              </a>
            }
          />
          {loading ? (
            <div className="rh-client-place-list">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} height={188} />
              ))}
            </div>
          ) : (
            <div className="rh-client-place-list">
              {featured.map((item) => (
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
          )}
        </section>

        <section className="rh-client-install">
          <span className="rh-client-install__icon">
            <Icon name="smartphone" />
          </span>
          <div>
            <strong>{t('home.installTitle')}</strong>
            <p>{t('home.installDesc')}</p>
          </div>
          <span className="rh-client-install__pill">{locale === 'fr' ? 'PWA' : 'PWA'}</span>
        </section>

        <p className="rh-client-footnote">
          {formatXof(0)} · XOF · Lomé, Togo · {t('common.appName')} v0.1
        </p>
      </main>

      <ClientBottomBar active="home" />
    </div>
  );
}
