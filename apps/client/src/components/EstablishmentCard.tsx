import { cx, useI18n } from '@resto-hub/design-system';
import type { Establishment } from '../lib/api';
import { isOpenNow, kindKey, ratingLabel, shortAddress } from '../lib/format';
import { navigate } from '../lib/router';
import { HeartIcon, Stars } from './Stars';

export function CoverImage({
  src,
  alt,
  className,
  seed,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  seed?: string;
}) {
  if (!src) {
    return (
      <div className={cx('rh-cover rh-cover--placeholder', className)} aria-hidden="true">
        <span>{seed?.slice(0, 2).toUpperCase() ?? 'RH'}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className={cx('rh-cover', className)} loading="lazy" />;
}

export function EstablishmentCard({
  establishment,
  rating,
  reviews,
  favorite,
  onFavorite,
  compact,
}: {
  establishment: Establishment;
  rating?: number;
  reviews?: number;
  favorite?: boolean;
  onFavorite?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const open = isOpenNow(establishment);
  const href = `/e/${encodeURIComponent(establishment.slug || establishment.id)}`;
  return (
    <article className={cx('rh-place-card', compact && 'rh-place-card--compact')}>
      <a
        className="rh-place-card__link"
        href={`#${href}`}
        onClick={(event) => {
          event.preventDefault();
          navigate(href);
        }}
      >
        <div className="rh-place-card__media">
          <CoverImage
            src={establishment.photos[0]}
            alt={establishment.brandName}
            seed={establishment.brandName}
          />
          <div className="rh-place-card__badges">
            <span
              className={cx(
                'rh-client-pill',
                open ? 'rh-client-pill--success' : 'rh-client-pill--neutral',
              )}
            >
              {open ? t('common.open') : t('common.closed')}
            </span>
            <span className="rh-place-card__kind">
              {t(`establishment.${kindKey(establishment.kind)}`)}
            </span>
          </div>
        </div>
        <div className="rh-place-card__body">
          <div className="rh-place-card__title-row">
            <h3>{establishment.brandName}</h3>
            {typeof rating === 'number' && rating > 0 && (
              <span className="rh-place-card__rating">
                <Stars value={rating} size="sm" />
                <strong>{ratingLabel(rating)}</strong>
                {typeof reviews === 'number' && <span>({reviews})</span>}
              </span>
            )}
          </div>
          {establishment.description && (
            <p className="rh-place-card__desc">{establishment.description}</p>
          )}
          <div className="rh-place-card__meta">
            <span>
              {shortAddress(establishment) || establishment.primarySite?.address || 'Lomé'}
            </span>
            {establishment.primarySite && (
              <>
                <span className="rh-place-card__dot" aria-hidden="true" />
                <span>{establishment.primarySite.name}</span>
              </>
            )}
          </div>
        </div>
      </a>
      {onFavorite && (
        <button
          type="button"
          className={cx('rh-place-card__fav', favorite && 'rh-place-card__fav--on')}
          aria-label={favorite ? t('establishment.favorited') : t('establishment.favorite')}
          aria-pressed={!!favorite}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFavorite();
          }}
        >
          <HeartIcon filled={favorite} />
        </button>
      )}
    </article>
  );
}
