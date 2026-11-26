#!/usr/bin/env node
/**
 * Génère le fichier Dart `resto_tokens.g.dart` à partir de `tokens.json`.
 * Les jetons restent la source de vérité : ne jamais éditer le fichier généré.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tokens.json');
const target = join(root, '..', '..', 'apps', 'mobile', 'lib', 'theme', 'resto_tokens.g.dart');

const tokens = JSON.parse(readFileSync(source, 'utf8'));
const hex = /^#[0-9a-fA-F]{6}$/;

function colorMap(themeName) {
  const colors = tokens[themeName].colors;
  const entries = Object.entries(colors)
    .filter(([, value]) => hex.test(value))
    .map(([key, value]) => `    '${key}': '${value.toLowerCase()}',`);
  return `  static const Map<String, String> ${themeName}Colors = {\n${entries.join('\n')}\n  };`;
}

function intMap(name, record) {
  const entries = Object.entries(record).map(([key, value]) => `    '${key}': ${value},`);
  return `  static const Map<String, int> ${name} = {\n${entries.join('\n')}\n  };`;
}

function firstFamily(value) {
  return value.split(',')[0].trim().replace(/^'|'$/g, '');
}

const content = `// GENERATED — ne pas éditer. Source : packages/design-tokens/tokens.css
// Regénérer avec : npm run flutter:theme
// ignore_for_file: lines_longer_than_80_chars

/// Jetons de design RESTO-HUB exportés pour Flutter.
class RestoTokens {
  const RestoTokens._();

${colorMap('light')}

${colorMap('dark')}

${intMap('dimensions', tokens.light.dimensions)}

  static const String fontDisplay = "${firstFamily(tokens.light.fontFamilies['font-display'])}";
  static const String fontSans = "${firstFamily(tokens.light.fontFamilies['font-sans'])}";
  static const String fontMono = "${firstFamily(tokens.light.fontFamilies['font-mono'])}";

  static const String defaultCurrency = '${tokens.meta.defaultCurrency}';
  static const List<String> locales = ${JSON.stringify(tokens.meta.locales)};
  static const int minTouchTarget = ${tokens.meta.minTouchTargetPx};
}
`;

const check = process.argv.includes('--check');
if (check) {
  const current = readFileSync(target, 'utf8');
  if (current !== content) {
    console.error('Jetons Flutter désynchronisés : exécuter `npm run flutter:theme`.');
    process.exit(1);
  }
  console.log('Thème Flutter à jour.');
} else {
  writeFileSync(target, content);
  console.log(`Thème Flutter généré : ${target}`);
}
