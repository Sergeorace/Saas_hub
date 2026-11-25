import { Icon, useI18n } from '@resto-hub/design-system';
import type { PaymentFeature, ProviderItem } from '../data/types';

function providerSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function Payments() {
  const { t, tm } = useI18n();
  const providers = tm<ProviderItem[]>('payments.providers') ?? [];
  const features = tm<PaymentFeature[]>('payments.features') ?? [];
  const flow = tm<string[]>('payments.flow') ?? [];

  return (
    <section className="section section--alt" id="payments" aria-labelledby="payments-title">
      <div className="site-container">
        <header className="section__head">
          <div>
            <p className="rh-eyebrow">{t('payments.eyebrow')}</p>
            <h2 className="rh-display section__title" id="payments-title">
              {t('payments.title')}
            </h2>
          </div>
          <p className="section__lead">{t('payments.lead')}</p>
        </header>

        <div className="payments__layout">
          <div className="payments__panel">
            <div className="provider-grid">
              {providers.map((provider) => (
                <div
                  className={`provider provider--${providerSlug(provider.name)}`}
                  key={provider.name}
                >
                  <span className="provider__mark" aria-hidden="true">
                    {provider.name
                      .split(' ')
                      .map((word) => word[0])
                      .join('')
                      .slice(0, 2)}
                  </span>
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{provider.note}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="payments__failover">
              <Icon name="refresh" size="sm" />
              {t('payments.providerNote')}
            </p>

            <ol className="flow" aria-label={t('payments.eyebrow')}>
              {flow.map((step, index) => (
                <li key={step}>
                  <span className="flow__num">{index + 1}</span>
                  <span>{step}</span>
                  {index < flow.length - 1 && (
                    <Icon name="chevron-right" size="sm" className="flow__arrow" />
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="payment-features">
            {features.map((feature) => (
              <div className="payment-feature" key={feature.title}>
                <span className="payment-feature__icon">
                  <Icon name={feature.icon} />
                </span>
                <div>
                  <strong>{feature.title}</strong>
                  <p>{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="payments__note">
          <Icon name="lock" size="sm" />
          {t('payments.note')}
        </p>
      </div>
    </section>
  );
}
