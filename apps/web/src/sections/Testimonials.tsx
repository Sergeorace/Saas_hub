import { Icon, useI18n } from '@resto-hub/design-system';

export function Testimonials() {
  const { t } = useI18n();

  return (
    <section className="section cvoice" id="testimonials" aria-labelledby="voice-title">
      <div className="site-container">
        <div className="cvoice__head">
          <p className="cstory__eyebrow">{t('landing.testimonials.eyebrow')}</p>
          <h2 className="cvoice__title" id="voice-title">
            {t('landing.testimonials.titleA')} <em>{t('landing.testimonials.titleB')}</em>
          </h2>
          <p className="cvoice__lead">{t('landing.testimonials.lead')}</p>
        </div>

        <div className="cvoice__card">
          <div className="cvoice__quote">
            <span className="cvoice__mark" aria-hidden="true">
              “
            </span>
            <blockquote>
              <p>{t('landing.testimonials.quote')}</p>
            </blockquote>
            <div className="cvoice__author">
              <span className="cvoice__avatar" aria-hidden="true">
                AK
              </span>
              <div>
                <strong>{t('landing.testimonials.author')}</strong>
                <span>{t('landing.testimonials.role')}</span>
              </div>
            </div>
            <div className="cvoice__rating">
              <span className="cvoice__stars" aria-hidden="true">
                <i>★</i>
                <i>★</i>
                <i>★</i>
                <i>★</i>
                <i>★</i>
              </span>
              <strong>{t('landing.testimonials.rating')}</strong>
              <span>{t('landing.testimonials.ratingLabel')}</span>
            </div>
          </div>

          <figure className="cvoice__dish">
            <img
              src="/marketing/dish-potatoes.webp"
              alt={t('landing.testimonials.dishAlt')}
              width={900}
              height={900}
              loading="lazy"
            />
            <figcaption>
              <div>
                <strong>{t('landing.testimonials.dishName')}</strong>
                <span>{t('landing.testimonials.dishMeta')}</span>
              </div>
              <a className="cvoice__dish-link" href="#pricing">
                {t('landing.testimonials.dishCta')}
                <Icon name="arrow-right" size="sm" />
              </a>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
