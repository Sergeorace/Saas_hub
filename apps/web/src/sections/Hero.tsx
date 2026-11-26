import { Icon, useI18n } from '@resto-hub/design-system';
import { ClientPhone } from '../components/ClientPhone';

const features = [
  { key: 'featureQuick', icon: 'smartphone' },
  { key: 'featureTracking', icon: 'clock' },
  { key: 'featurePayment', icon: 'wallet' },
] as const;

export function Hero() {
  const { t } = useI18n();

  return (
    <section className="chero" id="product">
      <div className="site-container">
        <div className="chero__panel">
          <div className="chero__grid">
            <div className="chero__copy">
              <p className="chero__badge">
                <span className="chero__badge-dot" aria-hidden="true" />
                {t('landing.hero.eyebrow')}
              </p>

              <h1 className="chero__title">
                <span>{t('landing.hero.titleA')}</span>
                <span className="is-muted">{t('landing.hero.titleAccent')}</span>
                <span>
                  {t('landing.hero.titleB')}
                  <svg
                    className="chero__spark"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M12 1.5l1.9 7.1 7.1-1.9-4.6 5.3 4.6 5.3-7.1-1.9L12 22.5l-1.9-7.1-7.1 1.9 4.6-5.3-4.6-5.3 7.1 1.9z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
              </h1>

              <p className="chero__lead">{t('landing.hero.lead')}</p>

              <div className="chero__actions">
                <a className="chero__btn chero__btn--primary" href="#/inscription">
                  {t('landing.hero.primaryCta')}
                  <span className="chero__btn-icon">
                    <Icon name="arrow-right" size="sm" />
                  </span>
                </a>
                <a className="chero__btn chero__btn--ghost" href="#journeys">
                  <Icon name="play" size="sm" />
                  {t('landing.hero.secondaryCta')}
                </a>
              </div>

              <ul className="chero__features">
                {features.map((feature) => (
                  <li key={feature.key}>
                    <span className="chero__feature-icon">
                      <Icon name={feature.icon} size="sm" />
                    </span>
                    {t(`landing.hero.${feature.key}`)}
                  </li>
                ))}
              </ul>

              <p className="chero__note">
                <Icon name="check-circle" size="sm" />
                {t('landing.hero.note')}
              </p>
            </div>

            <div className="chero__visual">
              <span className="chero__ring" aria-hidden="true" />
              <ClientPhone />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
