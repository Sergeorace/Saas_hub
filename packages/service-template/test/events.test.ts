import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainEventsService, isDomainEventEnvelope } from '../src/events/domain-events.service';

test('événements : publication puis consommation idempotente', async () => {
  const events = new DomainEventsService();
  const received: string[] = [];
  events.on('OrderCreated', (event) => {
    received.push(event.id);
  });
  const event = events.publish('OrderCreated', { orderId: 'cmd_1' }, 'tnt_sahelgrill');
  assert.equal(events.outboxFor('tnt_sahelgrill').length, 1);

  const first = await events.deliver(event);
  const second = await events.deliver(event);
  assert.equal(first.status, 'accepted');
  assert.equal(second.status, 'duplicate');
  assert.deepEqual(received, [event.id]);
});

test('événements : une enveloppe hors contrat est refusée', async () => {
  const events = new DomainEventsService();
  await assert.rejects(() => events.deliver({ id: 'x', type: 'OrderCreated' }), /invalide/);
  assert.equal(isDomainEventEnvelope({ id: '', type: 'OrderCreated' }), false);
  assert.equal(
    isDomainEventEnvelope({
      id: 'evt_1',
      type: 'OrderCreated',
      tenantId: 'tnt_sahelgrill',
      occurredAt: new Date().toISOString(),
      payload: { orderId: 'cmd_1' },
    }),
    true,
  );
});

test('événements : l’outbox est filtrée par tenant', () => {
  const events = new DomainEventsService();
  events.publish('OrderCreated', { orderId: 'cmd_1' }, 'tnt_sahelgrill');
  events.publish('OrderCreated', { orderId: 'cmd_2' }, 'tnt_baobab');
  assert.equal(events.outboxFor('tnt_sahelgrill').length, 1);
  assert.equal(events.outboxFor('tnt_baobab')[0].payload.orderId, 'cmd_2');
});
