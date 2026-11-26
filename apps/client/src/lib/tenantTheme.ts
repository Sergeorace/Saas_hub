import { useEffect } from 'react';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(input: string | null | undefined, fallback: string): Rgb {
  const value = (input ?? '').trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return parseHex(fallback, '#c2410c');
  let hex = match[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((part) => part + part)
      .join('');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

const toCss = ({ r, g, b }: Rgb) => `rgb(${r}, ${g}, ${b})`;

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * weight),
    g: Math.round(a.g + (b.g - a.g) * weight),
    b: Math.round(a.b + (b.b - a.b) * weight),
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readableInk(background: Rgb): string {
  const dark = { r: 26, g: 18, b: 8 };
  return contrast(background, dark) >= contrast(background, WHITE) ? '#1a1208' : '#ffffff';
}

const THEME_STYLE_ID = 'restohub-tenant-theme';
const DEFAULT_THEME_COLOR = '#c2410c';

export interface TenantColors {
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

export function applyTenantTheme(colors: TenantColors | null | undefined): void {
  if (!colors?.primaryColor) {
    resetTenantTheme();
    return;
  }
  const root = document.documentElement;
  const primary = parseHex(colors.primaryColor, '#c2410c');
  const secondary = parseHex(colors.secondaryColor, '#0f766e');
  const primaryDark = mix(primary, WHITE, 0.55);
  const secondaryDark = mix(secondary, WHITE, 0.55);

  const css = `
:root {
  --primary: ${toCss(primary)};
  --primary-hover: ${toCss(mix(primary, BLACK, 0.14))};
  --primary-soft: ${toCss(mix(primary, WHITE, 0.9))};
  --primary-ink: ${toCss(mix(primary, BLACK, 0.35))};
  --primary-contrast-ink: ${toCss(primary)};
  --on-primary: ${readableInk(primary)};
  --secondary: ${toCss(secondary)};
  --secondary-soft: ${toCss(mix(secondary, WHITE, 0.9))};
  --secondary-ink: ${toCss(mix(secondary, BLACK, 0.35))};
  --focus-ring: ${toCss(primary)};
  --tenant-primary: ${toCss(primary)};
  --tenant-secondary: ${toCss(secondary)};
  --tenant-glow: ${toCss(mix(primary, WHITE, 0.72))};
}
[data-theme='dark'] {
  --primary: ${toCss(primaryDark)};
  --primary-hover: ${toCss(mix(primaryDark, WHITE, 0.12))};
  --primary-soft: rgba(${primary.r}, ${primary.g}, ${primary.b}, 0.22);
  --primary-ink: ${toCss(mix(primaryDark, WHITE, 0.25))};
  --primary-contrast-ink: ${toCss(primaryDark)};
  --on-primary: ${readableInk(primaryDark)};
  --secondary: ${toCss(secondaryDark)};
  --secondary-soft: rgba(${secondary.r}, ${secondary.g}, ${secondary.b}, 0.2);
  --secondary-ink: ${toCss(mix(secondaryDark, WHITE, 0.25))};
  --focus-ring: ${toCss(primaryDark)};
  --tenant-primary: ${toCss(primaryDark)};
  --tenant-secondary: ${toCss(secondaryDark)};
  --tenant-glow: ${toCss(mix(primary, BLACK, 0.55))};
  color-scheme: dark;
}
html[data-theme='dark'] body { background-color: ${toCss(mix(primary, BLACK, 0.86))}; }
`;
  let style = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
  root.style.setProperty('--tenant-app-tint', toCss(mix(primary, WHITE, 0.92)));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', toCss(primary));
}

export function resetTenantTheme(): void {
  document.getElementById(THEME_STYLE_ID)?.remove();
  document.documentElement.style.removeProperty('--tenant-app-tint');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', DEFAULT_THEME_COLOR);
}

export function useTenantTheme(colors: TenantColors | null | undefined): void {
  const primary = colors?.primaryColor ?? null;
  const secondary = colors?.secondaryColor ?? null;
  useEffect(() => {
    if (!primary) return;
    applyTenantTheme({ primaryColor: primary, secondaryColor: secondary });
    return () => resetTenantTheme();
  }, [primary, secondary]);
}
