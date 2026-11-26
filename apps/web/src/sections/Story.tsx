import { Icon, useI18n } from '@resto-hub/design-system';

interface StoryStat {
  value: string;
  label: string;
}

export function Story() {
  const { t, tm } = useI18n();
  const stats = tm<StoryStat[]>('landing.story.stats') ?? [];

  return (
    <section className="section cstory" id="story" aria-labelledby="story-title">
      <div className="site-container">
        <div className="cstory__panel">
          <div className="cstory__media">
            <div className="cstory__photo">
              <img
                src="/marketing/kitchen-chef.webp"
                alt={t('landing.story.imageAlt')}
                width={400}
                height={900}
                loading="lazy"
              />
            </div>
            <p className="cstory__badge">
              <Icon name="pin" size="sm" />
              {t('landing.story.badge')}
            </p>
            <div className="cstory__order" aria-hidden="true">
              <span className="cstory__order-icon">
                <Icon name="utensils" size="sm" />
              </span>
              <div>
                <strong>Poulet braisé · Table 07</strong>
                <span>En cuisine · 21:04</span>
              </div>
              <span className="cstory__order-dot" />
            </div>
          </div>

          <div className="cstory__body">
            <p className="cstory__eyebrow">{t('landing.story.eyebrow')}</p>
            <h2 className="cstory__title" id="story-title">
              {t('landing.story.titleA')} <em>{t('landing.story.titleB')}</em>{' '}
              {t('landing.story.titleC')}
            </h2>
            <p className="cstory__lead">{t('landing.story.lead')}</p>

            <div className="cstory__bottom">
              <a className="chero__btn chero__btn--primary" href="#product">
                {t('landing.story.cta')}
                <span className="chero__btn-icon">
                  <Icon name="arrow-right" size="sm" />
                </span>
              </a>
              <ul className="cstory__stats">
                {stats.map((stat) => (
                  <li key={stat.label}>
                    <strong>{stat.value}</strong>
                    <span>{stat.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
