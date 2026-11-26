import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composite, contrast, parseColor } from './color.mjs';

export const TEXT_PAIRS = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink-2', 'bg'],
  ['ink-2', 'surface-2'],
  ['ink-3', 'surface'],
  ['on-primary', 'primary'],
  ['on-secondary', 'secondary'],
  ['on-inverse', 'surface-inverse'],
  ['primary-ink', 'primary-soft'],
  ['secondary-ink', 'secondary-soft'],
  ['accent-ink', 'accent-soft'],
  ['success-ink', 'success-soft'],
  ['warning-ink', 'warning-soft'],
  ['danger-ink', 'danger-soft'],
  ['info-ink', 'info-soft'],
  ['toast-fg', 'toast-bg'],
  ['nav-item-active-ink', 'nav-item-active'],
  ['table-free-ink', 'table-free-soft'],
  ['table-reserved-ink', 'table-reserved-soft'],
  ['table-occupied-ink', 'table-occupied-soft'],
  ['table-bill-ink', 'table-bill-soft'],
  ['table-cleaning-ink', 'table-cleaning-soft'],
  ['table-out-ink', 'table-out-soft'],
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

export function themeContrast(themeName, foreground, background) {
  const colors = tokens[themeName].colors;
  const fg = colors[foreground];
  const bgRaw = colors[background];
  if (!fg || !bgRaw) throw new Error(`Token manquant (${themeName}) : ${foreground} / ${background}`);
  const parsedBg = parseColor(bgRaw);
  const base = parsedBg.a < 1 ? composite(parsedBg, colors.bg) : parsedBg;
  return { ratio: contrast(fg, base), foreground: fg, background: bgRaw };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Contraste texte AA (≥ 4.5:1) — cibles mesurées\n');
  console.log('Thème | Avant-plan → Fond | Ratio | Seuil');
  for (const themeName of ['light', 'dark']) {
    for (const [fg, bg] of TEXT_PAIRS) {
      const { ratio } = themeContrast(themeName, fg, bg);
      const status = ratio >= 4.5 ? 'ok' : 'ÉCHEC';
      console.log(`${themeName.padEnd(5)} | ${`${fg} → ${bg}`.padEnd(38)} | ${ratio.toFixed(2).padStart(5)} | 4.5 ${status}`);
    }
    const focus = themeContrast(themeName, 'focus-ring', 'bg').ratio;
    console.log(`${themeName.padEnd(5)} | ${'focus-ring → bg'.padEnd(38)} | ${focus.toFixed(2).padStart(5)} | 3.0 ${focus >= 3 ? 'ok' : 'ÉCHEC'}`);
  }
}
