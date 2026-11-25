import { useState } from 'react';
import {
  Badge,
  Button,
  Icon,
  SegmentedControl,
  cx,
  formatXof,
  useI18n,
} from '@resto-hub/design-system';
import type { PlanItem } from '../data/types';

type Billing = 'monthly' | 'annual';

export function Pricing() {
  const { t, tm, locale } = useI18n();
  const [billing, setBilling] = useState<Billing>('monthly');
  const plans = tm<PlanItem[]>('pricing.plans') ?? [];

  return (
    <section className="section section--alt" id="pricing" aria-labelledby="pricing-title">
      <div className="site-container">
        <header className="section__head section__head--center">
          <div>
            <p className="rh-eyebrow">{t('pricing.eyebrow')}</p>
            <h2 className="rh-display section__title" id="pricing-title">
              {t('pricing.title')}
            </h2>
            <p className="section__lead">{t('pricing.lead')}</p>
          </div>
          <SegmentedControl<Billing>
            ariaLabel={t('pricing.eyebrow')}
            value={billing}
            onChange={setBilling}
            options={[
              { value: 'monthly', label: t('pricing.monthly') },
              { value: 'annual', label: t('pricing.annual') },
            ]}
          />
        </header>

        <div className="pricing-grid">
          {plans.map((plan) => {
            const highlighted = plan.key === 'pro';
            const monthly =
              plan.price === null
                ? null
                : billing === 'annual'
                  ? Math.round(plan.price * 0.8)
                  : plan.price;
            return (
              <article
                className={cx('plan', highlighted && 'plan--highlight')}
                key={plan.key}
                aria-label={plan.name}
              >
                {highlighted && plan.badge && (
                  <span className="plan__badge">
                    <Badge tone="accent" icon="sparkles">
                      {t('pricing.popular')}
                    </Badge>
                  </span>
                )}
                <header className="plan__head">
                  <h3>{plan.name}</h3>
                  <p>{plan.tagline}</p>
                </header>
                <div className="plan__price">
                  {monthly === null ? (
                    <strong>{t('pricing.quote')}</strong>
                  ) : (
                    <>
                      <strong>{formatXof(monthly, locale)}</strong>
                      <span>{t('pricing.perMonth')}</span>
                    </>
                  )}
                </div>
                {billing === 'annual' && monthly !== null && (
                  <p className="plan__billing">{t('pricing.annualNote')}</p>
                )}
                <ul className="plan__features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Icon name="check" size="sm" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <p className="plan__commission">{plan.commission}</p>
                <Button
                  fullWidth
                  variant={highlighted ? 'primary' : 'outline'}
                  iconRight={highlighted ? 'arrow-right' : undefined}
                >
                  {plan.cta}
                </Button>
              </article>
            );
          })}
        </div>

        <p className="pricing__note">
          <Icon name="info" size="sm" />
          {t('pricing.vat')}
        </p>
      </div>
    </section>
  );
}
