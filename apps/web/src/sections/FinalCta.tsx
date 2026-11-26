import { Icon, formatXof, useI18n } from '@resto-hub/design-system';

export function FinalCta() {
  const { t, locale } = useI18n();

  return (
    <section className="section cdownload" aria-labelledby="cta-title">
      <div className="site-container">
        <div className="cdownload__banner">
          <div className="cdownload__glow" aria-hidden="true" />
          <div className="cdownload__art">
            <div className="cdownload__plate">
              <img
                src="/marketing/hero-chicken.webp"
                alt=""
                width={1200}
                height={1200}
                loading="lazy"
              />
            </div>
            <div className="cdownload__order-card">
              <div>
                <strong>{t('landing.download.cardTitle')}</strong>
                <span>{t('landing.download.cardMeta')}</span>
                <em>{formatXof(4500, locale)}</em>
              </div>
              <span className="cdownload__order-btn">
                {t('landing.download.cardCta')}
                <Icon name="plus" size="sm" />
              </span>
            </div>
          </div>

          <div className="cdownload__copy">
            <p className="cdownload__eyebrow">{t('landing.download.eyebrow')}</p>
            <h2 className="cdownload__title" id="cta-title">
              {t('landing.download.title')}
            </h2>
            <p className="cdownload__lead">{t('landing.download.lead')}</p>
            <div className="cdownload__actions">
              <a className="cdownload__btn cdownload__btn--accent" href="#/inscription">
                {t('landing.download.primaryCta')}
                <Icon name="arrow-right" size="sm" />
              </a>
              <a className="cdownload__btn cdownload__btn--ghost" href="#product">
                <Icon name="play" size="sm" />
                {t('landing.download.secondaryCta')}
              </a>
            </div>
            <div className="cdownload__store">
              <span>{t('landing.download.storeLabel')}</span>
              <div className="cdownload__store-pill">
                <Icon name="smartphone" size="sm" />
                <div>
                  <strong>{t('landing.download.web')}</strong>
                  <span>resto-hub.tg</span>
                </div>
              </div>
            </div>
            <p className="cdownload__note">
              <Icon name="check-circle" size="sm" />
              {t('landing.download.note')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
