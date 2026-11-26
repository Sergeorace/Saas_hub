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
  isMoneyXof,
  type DomainEventPayloads,
  type RequiredDomainEventName,
  type TypedDomainEvent,
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

const AT = '2026-11-25T19:30:00.000Z';
const TENANT = 'tnt_sahelgrill';

const PAYLOAD_FIXTURES: { [K in keyof DomainEventPayloads]: DomainEventPayloads[K] } = {
  OrderCreated: {
    tenantId: TENANT,
    orderId: 'ord_1042',
    number: 'CMD-1042',
    channel: 'salle',
    tableCode: 'SAL-004',
    status: 'recue',
  },
  OrderStatusChanged: {
    tenantId: TENANT,
    orderId: 'ord_1042',
    number: 'CMD-1042',
    from: 'recue',
    to: 'en_preparation',
    actorId: 'usr_cuisinier',
  },
  OrderPaid: {
    tenantId: TENANT,
    orderId: 'ord_1042',
    number: 'CMD-1042',
    invoiceNumber: 'FAC-2026-01042',
    method: 'mobile_money',
    amountXof: 18500,
    provider: 'tmoney',
  },
  PaymentFailed: {
    tenantId: TENANT,
    transactionId: 'txn_778',
    orderId: 'ord_1042',
    amountXof: 18500,
    provider: 'tmoney',
    reason: 'solde_insuffisant',
  },
  TableStatusChanged: {
    tenantId: TENANT,
    tableId: 'tbl_004',
    code: 'SAL-004',
    zoneId: 'zone_salle',
    from: 'occupee',
    to: 'addition',
    orderId: 'ord_1042',
    actorId: 'usr_serveur',
    at: AT,
  },
  ReservationCreated: {
    tenantId: TENANT,
    reservationId: 'rsv_31',
    reference: 'RSV-31',
    date: '2026-11-26',
    time: '20:00',
    partySize: 4,
    tableId: 'tbl_014',
    tableCode: 'TER-014',
    source: 'client',
    at: AT,
  },
  PayrollApproved: {
    tenantId: TENANT,
    runId: 'pay_2026_11',
    period: '2026-11',
    totalXof: 1250000,
    headcount: 18,
    approvedBy: 'usr_gerant',
    preparedBy: 'usr_comptable',
    at: AT,
  },
  StockBelowThreshold: {
    tenantId: TENANT,
    itemId: 'itm_poulet',
    name: 'Poulet fermier',
    quantity: 4,
    threshold: 10,
    unit: 'kg',
  },
  CatalogItemUpdated: {
    tenantId: TENANT,
    itemType: 'product',
    itemId: 'prd_attieke',
    change: 'updated',
    at: AT,
  },
};

test('chaque événement imposé possède une charge utile typée', () => {
  assert.deepEqual(Object.keys(PAYLOAD_FIXTURES).sort(), [...REQUIRED_DOMAIN_EVENTS].sort());
});

test('les charges utiles typées forment des enveloppes valides', () => {
  for (const name of REQUIRED_DOMAIN_EVENTS) {
    const envelope: TypedDomainEvent<RequiredDomainEventName> = {
      id: `evt_${name}`,
      type: name,
      tenantId: TENANT,
      occurredAt: AT,
      payload: PAYLOAD_FIXTURES[name],
    };
    assert.equal(isDomainEventEnvelope(envelope), true, `${name} doit être une enveloppe valide`);
  }
});

test('les montants d’événements sont des entiers XOF positifs', () => {
  assert.ok(isMoneyXof({ amountXof: PAYLOAD_FIXTURES.OrderPaid.amountXof }));
  assert.ok(isMoneyXof({ amountXof: PAYLOAD_FIXTURES.PayrollApproved.totalXof }));
  assert.equal(isMoneyXof({ amountXof: 12.5 }), false);
  assert.equal(isMoneyXof({ amountXof: -1 }), false);
});
