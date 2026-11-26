import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync(resolve(__dirname, '..', '..', 'src', 'tenant', 'rls.sql'), 'utf8');
const TENANT_A = 'tnt_sahelgrill';
const TENANT_B = 'tnt_baobab';

const db = new PGlite();
process.on('exit', () => void db.close());

test.before(async () => {
  await db.exec(sql);
});

async function seed(): Promise<void> {
  await db.exec(`
    INSERT INTO app.records (id, tenant_id, label) VALUES
      ('11111111-1111-4111-8111-111111111111', '${TENANT_A}', 'Table SAL-004'),
      ('22222222-2222-4222-8222-222222222222', '${TENANT_A}', 'Table TER-014'),
      ('33333333-3333-4333-8333-333333333333', '${TENANT_B}', 'Table VIP-001');
  `);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE resto_app');
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
  try {
    return await work();
  } finally {
    await db.exec("SELECT set_config('app.tenant_id', '', false)");
    await db.exec('RESET ROLE');
  }
}

async function recordCount(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM app.records',
  );
  return Number(rows[0]?.count ?? -1);
}

test('RLS : rôle applicatif sans superutilisateur ni BYPASSRLS', async () => {
  const { rows } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'resto_app'",
  );
  assert.equal(rows[0]?.rolsuper, false);
  assert.equal(rows[0]?.rolbypassrls, false);
});

test('RLS : activée et forcée sur records et audit_log', async () => {
  const { rows } = await db.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND relname IN ('records', 'audit_log')
      ORDER BY relname`,
  );
  assert.deepEqual(
    rows.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity]),
    [
      ['audit_log', true, true],
      ['records', true, true],
    ],
  );
});

test('RLS : fail-closed sans tenant, aucune ligne visible', async () => {
  await seed();
  assert.equal(await asTenant('', recordCount), 0);
});

test('RLS : chaque établissement ne voit que ses places', async () => {
  const a = await asTenant(TENANT_A, recordCount);
  const b = await asTenant(TENANT_B, recordCount);
  assert.equal(a, 2);
  assert.equal(b, 1);
});

test('RLS : une écriture croisée est refusée', async () => {
  await assert.rejects(
    asTenant(TENANT_A, () =>
      db.query(
        "INSERT INTO app.records (id, tenant_id, label) VALUES ('44444444-4444-4444-8444-444444444444', 'tnt_baobab', 'Intrusion')",
      ),
    ),
    /row-level security|violates/i,
  );
});

test('RLS : journal d’audit immuable (UPDATE et DELETE refusés)', async () => {
  await asTenant(TENANT_A, () =>
    db.query(
      "INSERT INTO app.audit_log (tenant_id, actor_id, action, payload, prev_hash, hash) VALUES ($1, 'usr_1', 'order.cancelled', '{}', 'genesis', 'hash1')",
      [TENANT_A],
    ),
  );
  await assert.rejects(
    asTenant(TENANT_A, () => db.query("UPDATE app.audit_log SET action = 'falsified'")),
    /permission denied|audit_immutable/i,
  );
  await assert.rejects(
    asTenant(TENANT_A, () => db.query('DELETE FROM app.audit_log')),
    /permission denied|audit_immutable/i,
  );
});

test('RLS : le rôle applicatif ne peut pas modifier le schéma', async () => {
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE resto_app');
  try {
    await assert.rejects(
      () => db.exec('DROP TABLE app.records'),
      /permission denied|must be owner/i,
    );
  } finally {
    await db.exec('RESET ROLE');
  }
});
