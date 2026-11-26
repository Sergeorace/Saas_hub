import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  DOMAIN_EVENTS,
  REQUIRED_DOMAIN_EVENTS,
  TABLE_STATUSES,
  isDomainEventEnvelope,
  isDomainEventName,
} from '../index.js';

test('le registre ne contient aucun doublon', () => {
  assert.equal(new Set(DOMAIN_EVENTS).size, DOMAIN_EVENTS.length);
});

test('les événements imposés par le cahier des charges sont déclarés', () => {
  for (const name of REQUIRED_DOMAIN_EVENTS) {
    assert.ok(isDomainEventName(name), `${name} doit être déclaré`);
  }
});

test('chaque événement imposé est réellement publié par un service', () => {
  const servicesRoot = join(process.cwd(), '..', '..', 'services');
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'tests') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) sources.push(readFileSync(full, 'utf8'));
    }
  };
  for (const service of readdirSync(servicesRoot)) {
    const src = join(servicesRoot, service, 'src');
    try {
      walk(src);
    } catch {
      // service sans code source : rien à vérifier
    }
  }
  const corpus = sources.join('\n');
  for (const name of REQUIRED_DOMAIN_EVENTS) {
    assert.ok(corpus.includes(`'${name}'`), `${name} doit être émis dans services/*/src`);
  }
});

test('les six statuts de table sont exposés', () => {
  assert.deepEqual(
    [...TABLE_STATUSES],
    ['libre', 'reservee', 'occupee', 'addition', 'nettoyage', 'hors_service'],
  );
});

test('une enveloppe valide est acceptée, une enveloppe incomplète rejetée', () => {
  const valid = {
    id: 'evt_1',
    type: 'OrderCreated',
    tenantId: 'tnt_sahelgrill',
    occurredAt: '2026-11-25T12:00:00.000Z',
    payload: { orderId: 'ord_1' },
  };
  assert.equal(isDomainEventEnvelope(valid), true);
  assert.equal(isDomainEventEnvelope({ ...valid, id: '' }), false);
  assert.equal(isDomainEventEnvelope({ ...valid, type: 'UnknownEvent' }), false);
  assert.equal(isDomainEventEnvelope({ ...valid, occurredAt: 'pas-une-date' }), false);
  assert.equal(isDomainEventEnvelope({ ...valid, tenantId: 42 }), false);
});
