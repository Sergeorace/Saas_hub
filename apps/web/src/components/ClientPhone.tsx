import { Icon, formatXof, useI18n } from '@resto-hub/design-system';
import { DeviceStatus } from './DeviceStatus';

const navIcons = ['home', 'utensils', 'receipt', 'users'] as const;

export function ClientPhone() {
  const { t, tm, locale } = useI18n();
  const phone = tm<Record<string, string>>('landing.hero.phone');
  const categories = tm<string[]>('landing.hero.phone.categories');
  const navLabels = tm<string[]>('landing.hero.phone.nav');

  return (
    <div className="cphone" aria-hidden="true">
      <div className="cphone__float">
        <div className="cphone__device">
          <span className="cphone__key cphone__key--power" />
          <span className="cphone__key cphone__key--volume-up" />
          <span className="cphone__key cphone__key--volume-down" />
          <div className="cphone__shell">
            <span className="cphone__island">
              <span className="cphone__lens" />
            </span>
            <div className="cphone__screen">
              <div className="cphone__status">
                <span>21:04</span>
                <DeviceStatus className="cphone__status-icons" />
              </div>

              <div className="cphone__apphead">
                <span className="cphone__avatar">
                  <img src="/marketing/kitchen-chef.webp" alt="" loading="lazy" />
                </span>
                <div className="cphone__venue">
                  <strong>{phone.venue}</strong>
                  <span>{phone.service}</span>
                </div>
                <span className="cphone__bell">
                  <Icon name="bell" size="sm" />
                  <span className="cphone__bell-dot" />
                </span>
              </div>

              <div className="cphone__table">
                <Icon name="pin" size="sm" />
                <span>{phone.table}</span>
                <Icon name="chevron-down" size="sm" />
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
              <span className="cphone__home" />
            </div>
            <span className="cphone__glare" />
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
        <div className="cphone__ticket-body">
          <strong>{t('landing.hero.badgeTitle')}</strong>
          <span>{t('landing.hero.badgeMeta')}</span>
          <span className="cphone__ticket-track">
            <i />
          </span>
        </div>
        <span className="cphone__ticket-ok">
          <Icon name="check-circle" size="sm" />
          <i>{t('landing.hero.badgeStatus')}</i>
        </span>
      </div>

      <div className="cphone__plate">
        <img src="/marketing/hero-chicken.webp" alt="" width={1200} height={1200} />
      </div>
    </div>
  );
}
