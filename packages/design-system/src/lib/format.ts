export type Locale = 'fr' | 'en';

const intlLocale = (locale: Locale) => (locale === 'fr' ? 'fr-FR' : 'en-GB');

/** Montant XOF : entier, sans décimale (le franc CFA n'a pas de subdivision). */
export function formatXof(amount: number, locale: Locale = 'fr'): string {
  const value = new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `${value} FCFA`;
}

/** Montant compact pour graphiques / cartes : 1,2 M FCFA. */
export function formatXofCompact(amount: number, locale: Locale = 'fr'): string {
  const value = new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
  return `${value} FCFA`;
}

export function formatNumber(value: number, locale: Locale = 'fr'): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatPercent(value: number, locale: Locale = 'fr'): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(
  date: Date | string,
  locale: Locale = 'fr',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(new Date(date));
}

export function formatTime(date: Date | string, locale: Locale = 'fr'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
