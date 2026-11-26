import { Icon, formatXof, useI18n } from '@resto-hub/design-system';

const navIcons = ['home', 'utensils', 'receipt', 'users'] as const;

export function ClientPhone() {
  const { t, tm, locale } = useI18n();
  const phone = tm<Record<string, string>>('landing.hero.phone');
  const categories = tm<string[]>('landing.hero.phone.categories');
  const navLabels = tm<string[]>('landing.hero.phone.nav');

  return (
    <div className="cphone" aria-hidden="true">
      <div className="cphone__shell">
        <span className="cphone__notch" />
        <div className="cphone__screen">
          <div className="cphone__status">
            <span>21:04</span>
            <span className="cphone__status-icons">
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="cphone__top">
            <div className="cphone__deliver">
              <span className="cphone__deliver-icon">
                <Icon name="pin" size="sm" />
              </span>
              <div>
                <span>{phone.deliver}</span>
                <strong>{phone.address}</strong>
              </div>
              <Icon name="chevron-down" size="sm" />
            </div>
            <button className="cphone__bell" type="button" tabIndex={-1}>
              <Icon name="bell" size="sm" />
              <span className="cphone__bell-dot" />
            </button>
          </div>

          <h3 className="cphone__greeting">
            {phone.greetingA}
            <br />
            <em>{phone.greetingB}</em>
          </h3>

          <div className="cphone__search">
            <Icon name="search" size="sm" />
            <span>{phone.search}</span>
          </div>

          <div className="cphone__chips">
            {(categories ?? []).map((category, index) => (
              <span
                key={category}
                className={index === 0 ? 'cphone__chip is-active' : 'cphone__chip'}
              >
                {category}
              </span>
            ))}
          </div>

          <div className="cphone__section-head">
            <strong>{phone.recommended}</strong>
            <span>{phone.seeAll}</span>
          </div>

          <div className="cphone__cards">
            <article className="cphone__card">
              <div className="cphone__card-media">
                <img src="/marketing/hero-chicken-thumb.webp" alt="" loading="lazy" />
                <span className="cphone__rating">
                  <Icon name="sparkles" size="sm" />
                  {phone.rating1}
                </span>
              </div>
              <strong>{phone.dish1}</strong>
              <span className="cphone__card-meta">{phone.dish1Meta}</span>
              <div className="cphone__card-foot">
                <span className="cphone__price">{formatXof(4500, locale)}</span>
                <span className="cphone__add">
                  <Icon name="plus" size="sm" />
                </span>
              </div>
            </article>

            <article className="cphone__card">
              <div className="cphone__card-media">
                <img src="/marketing/dish-potatoes.webp" alt="" loading="lazy" />
                <span className="cphone__rating">
                  <Icon name="sparkles" size="sm" />
                  {phone.rating2}
                </span>
              </div>
              <strong>{phone.dish2}</strong>
              <span className="cphone__card-meta">{phone.dish2Meta}</span>
              <div className="cphone__card-foot">
                <span className="cphone__price">{formatXof(2000, locale)}</span>
                <span className="cphone__add">
                  <Icon name="plus" size="sm" />
                </span>
              </div>
            </article>
          </div>

          <div className="cphone__tabs">
            {(navLabels ?? []).map((label, index) => (
              <span key={label} className={index === 0 ? 'is-active' : undefined}>
                <Icon name={navIcons[index] ?? 'home'} size="sm" />
                <i>{label}</i>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="cphone__live">
        <span className="cphone__live-dot" />
        {phone.live}
      </div>

      <div className="cphone__ticket">
        <span className="cphone__ticket-icon">
          <Icon name="wallet" size="sm" />
        </span>
        <div>
          <strong>{t('landing.hero.badgeTitle')}</strong>
          <span>{t('landing.hero.badgeMeta')}</span>
        </div>
        <span className="cphone__ticket-ok">
          <Icon name="check-circle" size="sm" />
        </span>
      </div>

      <div className="cphone__plate">
        <img src="/marketing/hero-chicken.webp" alt="" width={1200} height={1200} />
      </div>
    </div>
  );
}
