import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditService } from '../src/audit/audit.service';

test('audit : la chaîne est valide après plusieurs écritures', () => {
  const audit = new AuditService();
  audit.record('tnt_sahelgrill', 'usr_gerant', 'order.cancelled', { orderId: 'cmd_1' });
  audit.record('tnt_sahelgrill', 'usr_caissier', 'discount.applied', { amountXof: 1500 });
  audit.record('tnt_baobab', 'usr_b', 'price.updated', { productId: 'prd_2' });
  assert.deepEqual(audit.verifyChain(), { valid: true, brokenAt: null });
});

test('audit : toute falsification est détectée', () => {
  const audit = new AuditService();
  audit.record('tnt_sahelgrill', 'usr_gerant', 'payment.refunded', { amountXof: 5000 });
  audit.record('tnt_sahelgrill', 'usr_caissier', 'order.cancelled', { orderId: 'cmd_9' });
  const entries = audit.list('tnt_sahelgrill');
  const tampered = { ...entries[0], payload: { amountXof: 500 } };
  const result = audit.verifyChain([tampered, entries[1]]);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, entries[0].id);
});

test('audit : une chaîne tronquée est détectée', () => {
  const audit = new AuditService();
  audit.record('tnt_sahelgrill', 'usr_gerant', 'price.updated', {});
  audit.record('tnt_sahelgrill', 'usr_gerant', 'price.updated', {});
  const [, last] = audit.list('tnt_sahelgrill');
  assert.deepEqual(audit.verifyChain(), { valid: true, brokenAt: null });
  assert.equal(audit.verifyChain([last]).brokenAt, last.id);
});

test('audit : le tenant est obligatoire', () => {
  const audit = new AuditService();
  assert.throws(() => audit.record('', null, 'unknown'), /tenant_id/);
});
