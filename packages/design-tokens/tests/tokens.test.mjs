import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT_PAIRS, themeContrast } from '../scripts/contrast.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));

const TABLE_STATUSES = ['libre', 'reservee', 'occupee', 'addition', 'nettoyage', 'hors-service'];
const TABLE_TOKEN_BY_STATUS = {
  libre: 'table-free',
  reservee: 'table-reserved',
  occupee: 'table-occupied',
  addition: 'table-bill',
  nettoyage: 'table-cleaning',
  'hors-service': 'table-out',
};

test('les deux thèmes exposent exactement les mêmes couleurs', () => {
  const lightKeys = Object.keys(tokens.light.colors).sort();
  const darkKeys = Object.keys(tokens.dark.colors).sort();
  assert.deepEqual(darkKeys, lightKeys);
  assert.ok(lightKeys.length >= 100, `attendu ≥ 100 couleurs, reçu ${lightKeys.length}`);
});

test('chaque couleur est un hexadécimal ou un rgb(a) exploitable par Flutter', () => {
  for (const themeName of ['light', 'dark']) {
    for (const [name, value] of Object.entries(tokens[themeName].colors)) {
      assert.match(value, /^(#[0-9a-f]{3,8}|rgba?\([^)]+\))$/i, `${themeName}.${name} = ${value}`);
    }
  }
});

test('les six statuts de table ont leurs quatre variantes dans les deux thèmes', () => {
  for (const themeName of ['light', 'dark']) {
    for (const status of TABLE_STATUSES) {
      const base = TABLE_TOKEN_BY_STATUS[status];
      for (const suffix of ['', '-soft', '-border', '-ink']) {
        assert.ok(
          tokens[themeName].colors[`${base}${suffix}`],
          `manquant : ${themeName}.${base}${suffix} (${status})`,
        );
      }
    }
  }
});

test('contraste AA (4.5:1) sur chaque paire texte/fond, clair et sombre', () => {
  const failures = [];
  for (const themeName of ['light', 'dark']) {
    for (const [fg, bg] of TEXT_PAIRS) {
      const { ratio } = themeContrast(themeName, fg, bg);
      if (ratio < 4.5) failures.push(`${themeName} ${fg} → ${bg} = ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('anneau de focus ≥ 3:1 sur le fond, clair et sombre', () => {
  for (const themeName of ['light', 'dark']) {
    const { ratio } = themeContrast(themeName, 'focus-ring', 'bg');
    assert.ok(ratio >= 3, `${themeName} focus-ring = ${ratio.toFixed(2)}`);
  }
});

test('cible tactile ≥ 44 px et échelle typographique croissante', () => {
  for (const themeName of ['light', 'dark']) {
    assert.ok(tokens[themeName].dimensions['touch-target'] >= 44);
  }
  const scale = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'].map(
    (step) => tokens.light.dimensions[`text-${step}`],
  );
  for (let index = 1; index < scale.length; index += 1) {
    assert.ok(scale[index] > scale[index - 1], `échelle non croissante à l'index ${index}`);
  }
  assert.equal(scale[0], 12);
  assert.equal(scale[scale.length - 1], 56);
});

test('familles typographiques et métadonnées produit', () => {
  const fonts = tokens.light.fontFamilies;
  assert.match(fonts['font-display'], /Fraunces/);
  assert.match(fonts['font-sans'], /Inter/);
  assert.match(fonts['font-mono'], /JetBrains Mono/);
  assert.deepEqual(tokens.meta.locales, ['fr', 'en']);
  assert.equal(tokens.meta.defaultCurrency, 'XOF');
  assert.equal(tokens.meta.minTouchTargetPx, 44);
});

test('les thèmes sombres couvrent toutes les dimensions du thème clair', () => {
  assert.deepEqual(
    Object.keys(tokens.dark.dimensions).sort(),
    Object.keys(tokens.light.dimensions).sort(),
  );
  assert.deepEqual(
    Object.keys(tokens.dark.fontFamilies).sort(),
    Object.keys(tokens.light.fontFamilies).sort(),
  );
  assert.deepEqual(tokens.dark.motion, tokens.light.motion);
});
