import { Icon, useI18n } from '@resto-hub/design-system';

export function FinalCta() {
  const { t } = useI18n();

  return (
    <section className="section" aria-labelledby="cta-title">
      <div className="site-container">
        <div className="final-cta">
          <div className="final-cta__glow" aria-hidden="true" />
          <div className="final-cta__copy">
            <h2 className="rh-display" id="cta-title">
              {t('finalCta.title')}
            </h2>
            <p>{t('finalCta.lead')}</p>
            <div className="final-cta__actions">
              <a className="rh-btn rh-btn--primary rh-btn--lg" href="#/inscription">
                {t('finalCta.primary')}
                <span className="rh-btn__icon">
                  <Icon name="arrow-right" />
                </span>
              </a>
              <a className="rh-btn rh-btn--outline rh-btn--lg" href="#/connexion">
                {t('finalCta.secondary')}
              </a>
            </div>
            <p className="final-cta__note">{t('finalCta.note')}</p>
          </div>
          <div className="final-cta__art" aria-hidden="true">
            <div className="final-cta__card">
              <span className="final-cta__card-icon">
                <Icon name="qr" />
              </span>
              <div>
                <strong>Table 07 · Terrasse</strong>
                <span>lebaobab.resto-hub.tg/qr/07</span>
              </div>
              <Icon name="scan" />
            </div>
            <div className="final-cta__card final-cta__card--offset">
              <span className="final-cta__card-icon final-cta__card-icon--success">
                <Icon name="check-circle" />
              </span>
              <div>
                <strong>OrderPaid · 12 800 FCFA</strong>
                <span>TMoney · signature vérifiée</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
