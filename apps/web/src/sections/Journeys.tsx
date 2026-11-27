import { Badge, Icon, formatXof, useI18n } from '@resto-hub/design-system';
import { DeviceStatus } from '../components/DeviceStatus';
import type { JourneyItem } from '../data/types';

const phoneNavIcons = ['home', 'utensils', 'receipt', 'users'] as const;

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="journey__steps">
      {steps.map((step, index) => (
        <li key={step}>
          <span className="journey__step-num">{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

export function Journeys() {
  const { t, tm, locale } = useI18n();
  const items = tm<JourneyItem[]>('journeys.items') ?? [];
  const phone = tm<Record<string, string>>('landing.hero.phone');
  const phoneCategories = tm<string[]>('landing.hero.phone.categories') ?? [];
  const phoneNav = tm<string[]>('landing.hero.phone.nav') ?? [];

  const client = items.find((item) => item.key === 'client');
  const others = items.filter((item) => item.key !== 'client');

  return (
    <section className="section" id="journeys" aria-labelledby="journeys-title">
      <div className="site-container">
        <header className="section__head">
          <div>
            <p className="rh-eyebrow">{t('journeys.eyebrow')}</p>
            <h2 className="rh-display section__title" id="journeys-title">
              {t('journeys.title')}
            </h2>
          </div>
          <p className="section__lead">{t('journeys.lead')}</p>
        </header>

        <div className="journeys">
          {client && (
            <article className="journey journey--feature">
              <div className="journey__copy">
                <Badge tone="primary" icon={client.icon}>
                  {client.role}
                </Badge>
                <h3>{client.title}</h3>
                <p>{client.description}</p>
                <StepList steps={client.steps} />
                <div className="journey__metric">
                  <span>{t('journeys.metricLabel')}</span>
                  <strong>{client.metric}</strong>
                </div>
              </div>

              <div className="phone-demo" aria-hidden="true">
                <div className="phone-demo__float">
                  <div className="phone-demo__device">
                    <span className="phone-demo__key phone-demo__key--power" />
                    <span className="phone-demo__key phone-demo__key--volume-up" />
                    <span className="phone-demo__key phone-demo__key--volume-down" />
                    <div className="phone-demo__frame">
                      <div className="cphone__screen">
                        <div className="phone-demo__island">
                          <span className="phone-demo__lens" />
                        </div>
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
                          {phoneCategories.map((category, index) => (
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
                          {phoneNav.map((label, index) => (
                            <span key={label} className={index === 0 ? 'is-active' : undefined}>
                              <Icon name={phoneNavIcons[index] ?? 'home'} size="sm" />
                              <i>{label}</i>
                            </span>
                          ))}
                        </div>
                        <span className="cphone__home" />
                      </div>
                      <span className="phone-demo__glare" />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          )}

          <div className="journeys__pair">
            {others.map((journey) => (
              <article className="journey" key={journey.key}>
                <Badge tone="neutral" icon={journey.icon}>
                  {journey.role}
                </Badge>
                <h3>{journey.title}</h3>
                <p>{journey.description}</p>
                <StepList steps={journey.steps} />
                <div className="journey__metric">
                  <span>{t('journeys.metricLabel')}</span>
                  <strong>{journey.metric}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
