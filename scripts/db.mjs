#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'help';

function dockerAvailable() {
  const probe = spawnSync('docker', ['compose', 'version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
}

function requireDocker() {
  if (dockerAvailable()) return;
  console.error(
    [
      'Docker n’est pas disponible sur cette machine.',
      'Installez Docker Desktop (https://www.docker.com/products/docker-desktop/) puis relancez :',
      '  npm run db:start',
      '',
      'Les tests RLS ne dépendent pas de Docker : lancez `npm run db:test`.',
    ].join('\n'),
  );
  process.exit(1);
}

function compose(args) {
  requireDocker();
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}

function warnEnv() {
  if (!existsSync(join(root, '.env'))) {
    console.warn(
      '⚠  .env absent : copiez infra/.env.example vers .env avant de démarrer les conteneurs.',
    );
  }
}

switch (command) {
  case 'start':
    warnEnv();
    compose(['up', '-d', 'postgres', 'redis', 'minio']);
    break;
  case 'stop':
    compose(['down']);
    break;
  case 'reset':
    warnEnv();
    console.warn('⚠  db:reset supprime les volumes (données locales perdues).');
    compose(['down', '-v']);
    break;
  case 'logs':
    compose(['logs', '-f', '--tail', '100', ...process.argv.slice(3)]);
    break;
  case 'psql':
    compose(['exec', 'postgres', 'psql', '-U', 'resto_hub', '-d', 'resto_identity']);
    break;
  case 'test': {
    const result = spawnSync(
      process.execPath,
      ['--test', join(root, 'infra/postgres/rls-test.mjs')],
      {
        stdio: 'inherit',
      },
    );
    process.exit(result.status ?? 1);
    break;
  }
  default:
    console.log(
      [
        'Usage : node scripts/db.mjs <commande>',
        '',
        '  start   Démarre PostgreSQL 16, Redis 7 et MinIO (Docker Compose)',
        '  stop    Arrête les conteneurs (volumes conservés)',
        '  reset   Supprime les conteneurs ET les volumes locaux',
        '  logs    Suit les journaux (postgres|redis|minio)',
        '  psql    Ouvre un shell psql sur resto_identity',
        '  test    Vérifie l’isolation RLS multi-tenant (Postgres embarqué, sans Docker)',
      ].join('\n'),
    );
}
