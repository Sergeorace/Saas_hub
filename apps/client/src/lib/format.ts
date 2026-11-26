import type { Establishment, EstablishmentHours } from './api';

const DAY_ORDER = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] as const;

export function establishmentAddress(establishment: Establishment): string {
  const address = establishment.address;
  if (!address) return establishment.primarySite?.address ?? '';
  return [address.street, address.district, address.city, address.country]
    .filter(Boolean)
    .join(', ');
}

export function shortAddress(establishment: Establishment): string {
  const address = establishment.address;
  if (!address) return establishment.primarySite?.address ?? '';
  return [address.district, address.city].filter(Boolean).join(' · ') || address.street || '';
}

export function telHref(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return `tel:${phone.replace(/\s+/g, '')}`;
}

export function dayKey(date = new Date(), timeZone = 'Africa/Lome'): string {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' });
  const weekday = formatter.format(date);
  const map: Record<string, string> = {
    Sun: 'dim',
    Mon: 'lun',
    Tue: 'mar',
    Wed: 'mer',
    Thu: 'jeu',
    Fri: 'ven',
    Sat: 'sam',
  };
  return map[weekday] ?? DAY_ORDER[date.getDay()];
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function zonedMinutes(date = new Date(), timeZone = 'Africa/Lome'): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = formatter.format(date).split(':').map(Number);
  return (h % 24) * 60 + m;
}

export function hoursFor(hours: EstablishmentHours[], key: string): EstablishmentHours | undefined {
  return hours.find((entry) => entry.day === key);
}

export function isOpenNow(establishment: Establishment, at = new Date()): boolean {
  const hours = establishment.hours ?? [];
  if (hours.length === 0) return true;
  const key = dayKey(at, establishment.timezone);
  const today = hoursFor(hours, key);
  if (!today || today.closed) return false;
  const minutes = zonedMinutes(at, establishment.timezone);
  const open = minutesOf(today.open);
  const close = minutesOf(today.close);
  if (close > open) return minutes >= open && minutes < close;
  // Service après minuit : ouvert jusqu'au lendemain matin.
  return minutes >= open || minutes < close;
}

export function todayLabelKeys(): Array<{
  iso: string;
  dayKey: string;
  day: number;
  month: number;
}> {
  const result: Array<{ iso: string; dayKey: string; day: number; month: number }> = [];
  const now = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    result.push({
      iso,
      dayKey: DAY_ORDER[date.getDay()],
      day: date.getDate(),
      month: date.getMonth() + 1,
    });
  }
  return result;
}

export function ratingLabel(average: number): string {
  return average.toFixed(1).replace('.', ',');
}

export function phoneValid(phone: string): boolean {
  return /^\+?[0-9\s().-]{7,20}$/.test(phone.trim());
}

export function kindKey(kind: Establishment['kind']): 'kindRestaurant' | 'kindBar' | 'kindBoth' {
  if (kind === 'bar') return 'kindBar';
  if (kind === 'both') return 'kindBoth';
  return 'kindRestaurant';
}

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}
