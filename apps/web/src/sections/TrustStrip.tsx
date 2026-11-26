import { useI18n } from '@resto-hub/design-system';

export function TrustStrip() {
  const { t, tm } = useI18n();
  const brands = tm<string[]>('landing.trust.brands') ?? [];

  return (
    <section className="ctrust" aria-label={t('landing.trust.label')}>
      <div className="site-container">
        <p className="ctrust__label">{t('landing.trust.label')}</p>
        <ul className="ctrust__brands">
          {brands.map((brand, index) => (
            <li key={brand}>
              <span className={`ctrust__mark ctrust__mark--${index % 3}`} aria-hidden="true" />
              {brand}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
