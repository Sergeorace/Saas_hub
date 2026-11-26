import { useI18n } from '@resto-hub/design-system';

function BrandList({
  brands,
  repeats = brands.length,
  hidden = false,
}: {
  brands: string[];
  repeats?: number;
  hidden?: boolean;
}) {
  return (
    <ul className="ctrust__brands" aria-hidden={hidden || undefined}>
      {brands.map((brand, index) => (
        <li key={`${brand}-${index}`} aria-hidden={index >= repeats || undefined}>
          <span className={`ctrust__mark ctrust__mark--${index % 3}`} aria-hidden="true" />
          {brand}
        </li>
      ))}
    </ul>
  );
}

export function TrustStrip() {
  const { t, tm } = useI18n();
  const brands = tm<string[]>('landing.trust.brands') ?? [];
  const loop = [...brands, ...brands];

  return (
    <section className="ctrust" aria-label={t('landing.trust.label')}>
      <div className="site-container">
        <p className="ctrust__label">{t('landing.trust.label')}</p>
      </div>
      <div className="ctrust__viewport">
        <div className="ctrust__marquee">
          <BrandList brands={loop} repeats={brands.length} />
          <BrandList brands={loop} hidden />
        </div>
      </div>
    </section>
  );
}
