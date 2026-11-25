import { useMemo, useState } from 'react';
import {
  Icon,
  Textarea,
  cx,
  formatDate,
  formatNumber,
  formatXof,
  useI18n,
  useToast,
} from '@resto-hub/design-system';
import { accountApi, publicApi, type LoyaltyProgram, type Review, type ReviewAggregate } from '../lib/api';
import { useAsync, useEstablishment, useFavorites } from '../lib/hooks';
import { useSession } from '../lib/session';
import { useTenantTheme } from '../lib/tenantTheme';
import { establishmentAddress, isOpenNow, kindKey, ratingLabel, telHref, todayLabelKeys } from '../lib/format';
import { navigate } from '../lib/router';
import { ClientBottomBar, ClientHeader, PageLoading, SectionTitle } from '../components/ClientChrome';
import { CoverImage } from '../components/EstablishmentCard';
import { HeartIcon, StarRatingInput, Stars } from '../components/Stars';

export default function EstablishmentPage({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { user } = useSession();
  const { favoriteIds, toggle } = useFavorites();
  const { data, loading, error, reload } = useEstablishment(slug);
  const establishment = data?.establishment;

  useTenantTheme(establishment ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor } : null);

  const reviewsState = useAsync(async () => {
    if (!establishment) return null;
    const [publicReviews, program] = await Promise.all([
      publicApi.reviews(establishment.id, 20),
      publicApi.loyaltyProgram(establishment.id),
    ]);
    return { reviews: publicReviews, program: program.program };
  }, [establishment?.id]);

  const myReviewState = useAsync(async () => {
    if (!establishment || !user) return null;
    const mine = await accountApi.myReviews(establishment.id);
    return mine.items[0] ?? null;
  }, [establishment?.id, user?.id]);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showGallery, setShowGallery] = useState(false);

  const myReview = myReviewState.data;
  const hasExisting = Boolean(myReview);

  const hours = useMemo(() => {
    if (!establishment) return [];
    const keys = todayLabelKeys().slice(0, 7);
    return ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((dayKey) => {
      const entry = establishment.hours.find((item) => item.day === dayKey);
      const isToday = keys[0]?.dayKey === dayKey;
      return { dayKey, entry, isToday };
    });
  }, [establishment]);

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.loading')} back="/recherche" />
        <PageLoading />
        <ClientBottomBar active="explore" />
      </div>
    );
  }

  if (error || !establishment) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.error')} back="/recherche" />
        <main className="rh-client-page">
          <div className="rh-client-error">
            <p>{error?.message ?? t('common.error')}</p>
            <button type="button" className="rh-client-link-btn" onClick={reload}>
              {t('common.retry')}
            </button>
          </div>
        </main>
        <ClientBottomBar active="explore" />
      </div>
    );
  }

  const reviews: ReviewAggregate | null = reviewsState.data?.reviews.aggregate ?? null;
  const program: LoyaltyProgram | null = reviewsState.data?.program ?? null;
  const favorite = favoriteIds.has(establishment.id);
  const open = isOpenNow(establishment);
  const gallery = establishment.photos.slice(0, 4);

  const onFavorite = async () => {
    if (!user) {
      toast.push({ title: t('common.signInRequired'), description: t('establishment.favoriteLogin'), tone: 'info' });
      navigate('/compte');
      return;
    }
    const added = await toggle(establishment.id);
    toast.push({ title: added ? t('establishment.favorited') : t('establishment.favorite'), tone: 'success' });
  };

  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      toast.push({ title: t('common.signInRequired'), description: t('establishment.reviewLogin'), tone: 'info' });
      navigate('/compte');
      return;
    }
    if (rating < 1) return;
    setSubmitting(true);
    try {
      await accountApi.submitReview({ tenantId: establishment.id, rating, comment: comment.trim() || undefined });
      toast.push({ title: t('establishment.reviewThanks'), tone: 'success' });
      setComment('');
      setRating(0);
      myReviewState.reload();
      reviewsState.reload();
    } catch (caught) {
      toast.push({ title: t('common.error'), description: caught instanceof Error ? caught.message : undefined, tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader
        title={establishment.brandName}
        subtitle={t(`establishment.${kindKey(establishment.kind)}`)}
        back="/recherche"
        logo={establishment.logoUrl}
        actions={
          <button
            type="button"
            className={cx('rh-chrome-btn rh-chrome-btn--round', favorite && 'rh-chrome-btn--on')}
            aria-pressed={favorite}
            aria-label={favorite ? t('establishment.favorited') : t('establishment.favorite')}
            onClick={onFavorite}
          >
            <HeartIcon filled={favorite} />
          </button>
        }
      />

      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-tenant-hero">
          <CoverImage src={gallery[0]} alt={establishment.brandName} seed={establishment.brandName} className="rh-tenant-hero__main" />
          <div className="rh-tenant-hero__overlay">
            <div className="rh-tenant-hero__headline">
              <h1>{establishment.brandName}</h1>
              <span className={cx('rh-client-pill', open ? 'rh-client-pill--success' : 'rh-client-pill--neutral')}>
                {open ? t('common.open') : t('common.closed')}
              </span>
            </div>
            <div className="rh-tenant-hero__meta">
              {reviews && reviews.count > 0 ? (
                <span>
                  <Stars value={reviews.average} size="sm" /> {ratingLabel(reviews.average)} ·{' '}
                  {t('establishment.ratingCount', { rating: ratingLabel(reviews.average), count: reviews.count })}
                </span>
              ) : (
                <span>{t('establishment.noRating')}</span>
              )}
            </div>
            {gallery.length > 1 && (
              <div className="rh-tenant-hero__thumbs">
                {gallery.slice(0, 3).map((photo, index) => (
                  <button key={photo} type="button" onClick={() => setShowGallery(true)} aria-label={`${t('establishment.photos')} ${index + 1}`}>
                    <img src={photo} alt="" loading="lazy" />
                  </button>
                ))}
                {gallery.length > 3 && (
                  <button type="button" className="rh-tenant-hero__more" onClick={() => setShowGallery(true)}>
                    +{gallery.length - 3}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {showGallery && (
          <div className="rh-gallery" role="dialog" aria-modal="true" aria-label={t('establishment.photos')}>
            <button type="button" className="rh-gallery__close" onClick={() => setShowGallery(false)} aria-label={t('common.close')}>
              <Icon name="x" />
            </button>
            <div className="rh-gallery__grid">
              {establishment.photos.map((photo) => (
                <img key={photo} src={photo} alt={establishment.brandName} />
              ))}
            </div>
          </div>
        )}

        <p className="rh-tenant-desc">{establishment.description}</p>

        <div className="rh-tenant-cta">
          <button type="button" className="rh-client-btn rh-client-btn--primary" onClick={() => navigate(`/e/${establishment.slug}/menu`)}>
            <Icon name="utensils" size="sm" /> {t('establishment.menu')}
          </button>
          <button
            type="button"
            className="rh-client-btn rh-client-btn--outline"
            onClick={() => navigate(`/e/${establishment.slug}/reservation`)}
          >
            <Icon name="calendar" size="sm" /> {t('establishment.reserve')}
          </button>
        </div>

        <section className="rh-tenant-info">
          <div className="rh-tenant-info__row">
            <span className="rh-tenant-info__icon">
              <Icon name="pin" size="sm" />
            </span>
            <div>
              <strong>{t('establishment.address')}</strong>
              <span>{establishmentAddress(establishment) || establishment.primarySite?.address}</span>
              {establishment.siteCount > 1 && (
                <em>{t('establishment.sites', { count: establishment.siteCount })}</em>
              )}
            </div>
          </div>
          {establishment.contactPhone && (
            <a className="rh-tenant-info__row" href={telHref(establishment.contactPhone)}>
              <span className="rh-tenant-info__icon">
                <Icon name="smartphone" size="sm" />
              </span>
              <div>
                <strong>{t('establishment.phone')}</strong>
                <span>{establishment.contactPhone}</span>
              </div>
              <span className="rh-tenant-info__cta">{t('establishment.call')}</span>
            </a>
          )}
          <div className="rh-tenant-info__row rh-tenant-info__row--block">
            <span className="rh-tenant-info__icon">
              <Icon name="clock" size="sm" />
            </span>
            <div className="rh-tenant-hours">
              <strong>{t('establishment.hoursTitle')}</strong>
              <ul>
                {hours.map(({ dayKey, entry, isToday }) => (
                  <li key={dayKey} className={cx(isToday && 'is-today')}>
                    <span>{t(`days.${dayKey}`)}</span>
                    <span>{entry && !entry.closed ? `${entry.open} – ${entry.close}` : t('common.closed')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {program && (
          <section className="rh-tenant-loyalty">
            <span className="rh-tenant-loyalty__icon">
              <Icon name="gift" />
            </span>
            <div>
              <strong>{t('establishment.loyaltyTitle')}</strong>
              <p>
                {t('establishment.loyaltyDesc', {
                  tiers: program.tiers.map((tier) => tier.label).join(' · '),
                })}
              </p>
            </div>
            <button
              type="button"
              className="rh-client-link-btn"
              onClick={() => navigate(`/e/${establishment.slug}/fidelite`)}
            >
              {t('establishment.seeLoyalty')}
            </button>
          </section>
        )}

        <section>
          <SectionTitle title={t('establishment.reviewsTitle')} subtitle={reviews && reviews.count > 0 ? `${ratingLabel(reviews.average)} / 5 · ${formatNumber(reviews.count, locale)} ${t('common.reviews')}` : undefined} />
          {reviews && reviews.count > 0 && (
            <div className="rh-review-summary">
              <div className="rh-review-summary__score">
                <strong>{ratingLabel(reviews.average)}</strong>
                <Stars value={reviews.average} />
                <span>{formatNumber(reviews.count, locale)} {t('common.reviews')}</span>
              </div>
              <div className="rh-review-summary__bars">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = reviews.distribution[String(star)] ?? 0;
                  const ratio = reviews.count > 0 ? count / reviews.count : 0;
                  return (
                    <div className="rh-review-bar" key={star}>
                      <span>{star}</span>
                      <div className="rh-review-bar__track">
                        <div className="rh-review-bar__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                      </div>
                      <span>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rh-review-list">
            {reviewsState.data?.reviews.items.length ? (
              reviewsState.data.reviews.items.map((review) => (
                <article className="rh-review" key={review.id}>
                  <div className="rh-review__head">
                    <strong>{review.userName}</strong>
                    <span>{formatDate(review.createdAt, locale)}</span>
                  </div>
                  <Stars value={review.rating} size="sm" />
                  {review.comment && <p>{review.comment}</p>}
                </article>
              ))
            ) : (
              <p className="rh-client-muted">{t('establishment.noReviews')}</p>
            )}
          </div>

          <form className="rh-review-form" onSubmit={submitReview}>
            <div className="rh-review-form__head">
              <strong>{t('establishment.writeReview')}</strong>
              {hasExisting && <span className="rh-client-pill rh-client-pill--info">{t('establishment.reviewPending')}</span>}
            </div>
            {!user ? (
              <p className="rh-client-muted">
                {t('establishment.reviewLogin')}{' '}
                <button type="button" className="rh-client-link-btn" onClick={() => navigate('/compte')}>
                  {t('common.login')}
                </button>
              </p>
            ) : (
              <>
                <label className="rh-review-form__label">{t('establishment.yourRating')}</label>
                <StarRatingInput value={rating || myReview?.rating || 0} onChange={setRating} label={t('establishment.yourRating')} />
                {hasExisting && <p className="rh-client-hint">{t('establishment.reviewExisting')}</p>}
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={t('establishment.reviewPlaceholder')}
                  maxLength={500}
                  rows={3}
                />
                <button type="submit" className="rh-client-btn rh-client-btn--primary" disabled={submitting || (rating === 0 && !hasExisting)}>
                  {submitting ? t('common.loading') : t('establishment.submitReview')}
                </button>
              </>
            )}
          </form>
        </section>

        <p className="rh-client-footnote">
          {formatXof(0)} · {establishment.currency} · {establishment.timezone}
        </p>
      </main>
      <ClientBottomBar active="explore" />
    </div>
  );
}
