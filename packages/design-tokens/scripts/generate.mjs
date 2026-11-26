import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'tokens.css');
const JSON_TARGET = join(root, 'tokens.json');
const TS_TARGET = join(root, 'src', 'tokens.ts');

const META = {
  name: 'RESTO-HUB',
  version: '0.2.0',
  defaultCurrency: 'XOF',
  locales: ['fr', 'en'],
  minTouchTargetPx: 44,
  source: 'tokens.css',
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function topLevelBlocks(css) {
  const blocks = [];
  let index = 0;
  let selector = '';
  let body = '';
  let depth = 0;
  let atRule = false;
  while (index < css.length) {
    const char = css[index];
    if (depth === 0) {
      if (char === '{') {
        atRule = selector.trim().startsWith('@');
        body = '';
        depth = 1;
      } else {
        selector += char;
      }
    } else if (char === '{') {
      depth += 1;
      body += char;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        if (!atRule) blocks.push({ selector: selector.trim(), body });
        selector = '';
      } else {
        body += char;
      }
    } else {
      body += char;
    }
    index += 1;
  }
  return blocks;
}

function declarations(body) {
  const result = [];
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) continue;
    const property = chunk.slice(0, colon).trim();
    if (!property.startsWith('--')) continue;
    const value = chunk
      .slice(colon + 1)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) continue;
    result.push([property, value]);
  }
  return result;
}

const css = stripComments(readFileSync(SOURCE, 'utf8'));
const blocks = topLevelBlocks(css);
const pick = (matcher) =>
  blocks
    .filter((block) => matcher(block.selector.replace(/\s+/g, ' ')))
    .flatMap((block) => declarations(block.body));

const primitives = Object.fromEntries(pick((s) => s === ':root'));
const lightTheme = Object.fromEntries(pick((s) => s === ":root, [data-theme='light']"));
const darkTheme = Object.fromEntries(pick((s) => s === "[data-theme='dark']"));

if (Object.keys(primitives).length === 0)
  throw new Error('Aucune primitive trouvée dans tokens.css');
if (Object.keys(lightTheme).length === 0) throw new Error('Aucun token de thème clair trouvé');
if (Object.keys(darkTheme).length === 0) throw new Error('Aucun token de thème sombre trouvé');

function resolveValue(value, environment, depth = 0) {
  if (depth > 16) throw new Error(`Référence var() circulaire : ${value}`);
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_, name, fallback) => {
    if (name in environment) return resolveValue(environment[name], environment, depth + 1);
    if (fallback !== undefined) return fallback.trim();
    throw new Error(`Token non résolu : ${name}`);
  });
}

const lightEnvironment = { ...primitives, ...lightTheme };
const darkEnvironment = { ...lightEnvironment, ...darkTheme };

function classify(name, raw) {
  if (name.startsWith('--font-')) return { group: 'fontFamilies', value: raw };
  if (/^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(|hsla?\()/i.test(raw)) {
    return { group: 'colors', value: raw };
  }
  const rem = raw.match(/^(-?\d*\.?\d+)rem$/);
  if (rem) return { group: 'dimensions', value: Math.round(Number(rem[1]) * 16 * 1000) / 1000 };
  const px = raw.match(/^(-?\d*\.?\d+)px$/);
  if (px) return { group: 'dimensions', value: Number(px[1]) };
  const ms = raw.match(/^(-?\d*\.?\d+)ms$/);
  if (ms) return { group: 'motion', value: Number(ms[1]) };
  if (/^-?\d*\.?\d+$/.test(raw)) return { group: 'numbers', value: Number(raw) };
  return { group: 'raw', value: raw };
}

function buildTheme(environment, includeNonColors, reference) {
  const theme = { colors: {}, dimensions: {}, motion: {}, numbers: {}, fontFamilies: {}, raw: {} };
  for (const [name, value] of Object.entries(environment)) {
    const resolved = resolveValue(value, environment);
    const { group, value: typed } = classify(name, resolved);
    const key = name.slice(2);
    if (group === 'colors') {
      theme.colors[key] = typed;
    } else if (includeNonColors) {
      theme[group][key] = typed;
    } else if (reference.colors[key] !== undefined) {
      theme.colors[key] = reference.colors[key];
    }
  }
  return theme;
}

const light = buildTheme(lightEnvironment, true, null);
const dark = buildTheme(darkEnvironment, true, light);

const payload = { meta: META, light, dark };

function serialize(object) {
  return `${JSON.stringify(object, null, 2)}\n`;
}

function generateTs() {
  return `// Généré depuis tokens.css par scripts/generate.mjs — ne pas éditer à la main.
export const designTokens = ${JSON.stringify(payload, null, 2)} as const;

export type DesignTokens = typeof designTokens;
export type ThemeName = keyof Pick<DesignTokens, 'light' | 'dark'>;
export type ColorTokenName = keyof DesignTokens['light']['colors'];
`;
}

const check = process.argv.includes('--check');
const json = serialize(payload);
const ts = generateTs();

if (check) {
  const stale = [];
  if (!existsSync(JSON_TARGET) || readFileSync(JSON_TARGET, 'utf8') !== json)
    stale.push('tokens.json');
  if (!existsSync(TS_TARGET) || readFileSync(TS_TARGET, 'utf8') !== ts) stale.push('src/tokens.ts');
  if (stale.length > 0) {
    console.error(
      `Jetons désynchronisés (${stale.join(', ')}) : lancez npm run build -w @resto-hub/design-tokens.`,
    );
    process.exit(1);
  }
  console.log(`Jetons à jour — ${Object.keys(light.colors).length} couleurs × 2 thèmes.`);
} else {
  writeFileSync(JSON_TARGET, json);
  writeFileSync(TS_TARGET, ts);
  console.log(
    `Généré : ${Object.keys(light.colors).length} couleurs, ${Object.keys(light.dimensions).length} dimensions, ` +
      `${Object.keys(light.motion).length} durées (clair + sombre).`,
  );
}
