import {
  Badge,
  BottomNav,
  Button,
  Icon,
  Logo,
  formatXof,
  useI18n,
} from '@resto-hub/design-system';
import type { DemoMenuItem, JourneyItem } from '../data/types';

interface JourneyDemo {
  table: string;
  menu: string;
  cart: string;
  total: string;
  pay: string;
  track: string;
  items: DemoMenuItem[];
}

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
  const demo = tm<JourneyDemo>('journeys.demo');
  const bottomItems = tm<Record<string, string>>('design.bottomItems');

  const client = items.find((item) => item.key === 'client');
  const others = items.filter((item) => item.key !== 'client');
  const total = demo.items.reduce((sum, item) => sum + item.price, 0);

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

              <div className="phone-demo">
                <div className="phone-demo__frame">
                  <div className="phone-demo__notch" aria-hidden="true" />
                  <div className="phone-demo__status" aria-hidden="true">
                    <span>21:04</span>
                    <span className="phone-demo__status-icons">
                      <Icon name="wifi-off" size="sm" />
                      <Icon name="zap" size="sm" />
                    </span>
                  </div>
                  <div className="phone-demo__app">
                    <div className="phone-demo__head">
                      <Logo withWordmark size={22} />
                      <Badge tone="primary" icon="qr">
                        {demo.table}
                      </Badge>
                    </div>
                    <div className="phone-demo__intro">
                      <span>{demo.menu}</span>
                      <h4>{demo.cart}</h4>
                    </div>
                    <ul className="phone-demo__items">
                      {demo.items.map((item) => (
                        <li key={item.name}>
                          <span className="phone-demo__thumb" aria-hidden="true">
                            <Icon name="utensils" size="sm" />
                          </span>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.meta}</span>
                          </div>
                          <span className="phone-demo__price">
                            {formatXof(item.price, locale)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="phone-demo__total">
                      <span>{demo.total}</span>
                      <strong>{formatXof(total, locale)}</strong>
                    </div>
                    <Button fullWidth iconLeft="smartphone">
                      {demo.pay}
                    </Button>
                    <p className="phone-demo__track">
                      <span className="preview__live-dot" aria-hidden="true" />
                      {demo.track}
                    </p>
                  </div>
                  <BottomNav
                    ariaLabel={t('design.bottomLabel')}
                    items={[
                      { id: 'floor', label: bottomItems.floor, icon: 'grid', active: true },
                      { id: 'orders', label: bottomItems.orders, icon: 'receipt', badge: 3 },
                      { id: 'kds', label: bottomItems.kds, icon: 'chef' },
                      { id: 'stats', label: bottomItems.stats, icon: 'chart' },
                    ]}
                  />
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
