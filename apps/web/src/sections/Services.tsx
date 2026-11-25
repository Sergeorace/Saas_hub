import { Icon, useI18n } from '@resto-hub/design-system';
import type { ServiceItem } from '../data/types';

const groups = [
  { key: 'core', titleKey: 'services.groups.core' },
  { key: 'people', titleKey: 'services.groups.people' },
  { key: 'growth', titleKey: 'services.groups.growth' },
  { key: 'platform', titleKey: 'services.groups.platform' },
] as const;

export function Services() {
  const { t, tm } = useI18n();
  const items = tm<ServiceItem[]>('services.items') ?? [];

  return (
    <section className="section section--alt" id="services" aria-labelledby="services-title">
      <div className="site-container">
        <header className="section__head">
          <div>
            <p className="rh-eyebrow">{t('services.eyebrow')}</p>
            <h2 className="rh-display section__title" id="services-title">
              {t('services.title')}
            </h2>
          </div>
          <p className="section__lead">{t('services.lead')}</p>
        </header>

        <div className="services">
          {groups.map((group) => (
            <div className="services__group" key={group.key}>
              <div className="services__group-head">
                <span>{t(group.titleKey)}</span>
                <span className="services__count">
                  {items.filter((item) => item.group === group.key).length}
                </span>
              </div>
              <div className="services__grid">
                {items
                  .filter((item) => item.group === group.key)
                  .map((service) => (
                    <article className="service-card" key={service.key}>
                      <div className="service-card__top">
                        <span className="service-card__icon">
                          <Icon name={service.icon} />
                        </span>
                        <span className="service-card__port">
                          {t('services.portLabel')} · {service.port}
                        </span>
                      </div>
                      <h3>{service.name}</h3>
                      <p>{service.description}</p>
                      <div className="service-card__event">
                        <Icon name="layers" size="sm" />
                        <span>{t('services.keyEvent')}</span>
                        <code>{service.event}</code>
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <p className="services__note">
          <Icon name="lock" size="sm" />
          {t('services.footnote')}
        </p>
      </div>
    </section>
  );
}
