import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const initSql = readFileSync(join(here, 'init.sql'), 'utf8');

export const TENANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
export const TENANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const USER_A1 = 'a1a1a1a1-1111-4111-8111-111111111111';
const USER_A2 = 'a2a2a2a2-1111-4111-8111-111111111111';
const USER_B1 = 'b1b1b1b1-2222-4222-8222-222222222222';

async function seededDatabase() {
  const db = new PGlite();
  await db.exec(initSql);
  await db.exec(`
    INSERT INTO identity.tenants (id, name) VALUES
      ('${TENANT_A}', 'Sahel Grill'),
      ('${TENANT_B}', 'Le Baobab');
    INSERT INTO identity.users (id, tenant_id, phone, display_name, role) VALUES
      ('${USER_A1}', '${TENANT_A}', '+22890000001', 'Awa Gérante', 'gerant'),
      ('${USER_A2}', '${TENANT_A}', '+22890000002', 'Kossi Serveur', 'serveur'),
      ('${USER_B1}', '${TENANT_B}', '+22890000003', 'Dédé Gérante', 'gerant');
  `);
  return db;
}

async function asTenant(db, tenantId, sql) {
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE resto_app');
  await db.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("SELECT set_config('app.tenant_id', '', false)");
    await db.exec('RESET ROLE');
  }
}

const count = (result) => Number(result.rows[0].count);

const db = await seededDatabase();
process.on('exit', () => void db.close());

test('le rôle applicatif est un rôle simple : ni superutilisateur, ni BYPASSRLS', async () => {
  const { rows } = await db.query(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'resto_app'",
  );
  assert.equal(rows[0].rolsuper, false);
  assert.equal(rows[0].rolbypassrls, false);
});

test('RLS est activée ET forcée sur tenants, users et audit_log', async () => {
  const { rows } = await db.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'identity' AND relname IN ('tenants', 'users', 'audit_log')
      ORDER BY relname`,
  );
  assert.deepEqual(
    rows.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity]),
    [
      ['audit_log', true, true],
      ['tenants', true, true],
      ['users', true, true],
    ],
  );
});

test('fail-closed : sans contexte tenant, aucune ligne n’est visible ni inscriptible', async () => {
  const visible = await asTenant(db, '', 'SELECT count(*)::int AS count FROM identity.users');
  assert.equal(count(visible), 0);
  await assert.rejects(
    asTenant(db, '', `INSERT INTO identity.users (id, tenant_id, phone, display_name, role)
      VALUES ('cccccccc-3333-4333-8333-333333333333', '${TENANT_A}', '+22890000009', 'Intrus', 'serveur')`),
    /row-level security|violates/i,
  );
});

test('isolation en lecture : chaque tenant ne voit que ses utilisateurs', async () => {
  assert.equal(count(await asTenant(db, TENANT_A, 'SELECT count(*)::int AS count FROM identity.users')), 2);
  assert.equal(count(await asTenant(db, TENANT_B, 'SELECT count(*)::int AS count FROM identity.users')), 1);
});

test('lecture croisée par identifiant : la ligne d’un autre tenant reste invisible', async () => {
  const result = await asTenant(
    db,
    TENANT_A,
    `SELECT count(*)::int AS count FROM identity.users WHERE id = '${USER_B1}'`,
  );
  assert.equal(count(result), 0);
});

test('écriture croisée refusée (WITH CHECK) et mise à jour croisée sans effet', async () => {
  await assert.rejects(
    asTenant(db, TENANT_A, `INSERT INTO identity.users (id, tenant_id, phone, display_name, role)
      VALUES ('dddddddd-4444-4444-8444-444444444444', '${TENANT_B}', '+22890000010', 'Fuite', 'serveur')`),
    /row-level security|violates/i,
  );
  const update = await asTenant(
    db,
    TENANT_A,
    `UPDATE identity.users SET display_name = 'Piraté' WHERE id = '${USER_B1}' RETURNING id`,
  );
  assert.equal(update.rows.length, 0);
  const check = await asTenant(db, TENANT_B, `SELECT display_name FROM identity.users WHERE id = '${USER_B1}'`);
  assert.equal(check.rows[0].display_name, 'Dédé Gérante');
});

test('tenant : un établissement ne lit que sa propre fiche', async () => {
  const own = await asTenant(db, TENANT_A, 'SELECT name FROM identity.tenants');
  assert.deepEqual(own.rows.map((row) => row.name), ['Sahel Grill']);
  const other = await asTenant(db, TENANT_A, `SELECT name FROM identity.tenants WHERE id = '${TENANT_B}'`);
  assert.equal(other.rows.length, 0);
});

test('journal d’audit : insertion contextualisée autorisée, mutation toujours refusée', async () => {
  await asTenant(
    db,
    TENANT_A,
    `INSERT INTO identity.audit_log (tenant_id, actor_id, action, hash)
     VALUES ('${TENANT_A}', 'usr_a1', 'user.created', 'hash-1')`,
  );
  const rows = await asTenant(db, TENANT_A, 'SELECT action FROM identity.audit_log');
  assert.deepEqual(rows.rows.map((row) => row.action), ['user.created']);
  const otherTenantView = await asTenant(db, TENANT_B, 'SELECT count(*)::int AS count FROM identity.audit_log');
  assert.equal(count(otherTenantView), 0);

  await assert.rejects(
    asTenant(db, TENANT_A, `UPDATE identity.audit_log SET action = 'traficoté'`),
    /permission denied|immuable/i,
  );
  await assert.rejects(
    asTenant(db, TENANT_A, 'DELETE FROM identity.audit_log'),
    /permission denied|immuable/i,
  );
  // Même le propriétaire / superutilisateur ne peut pas réécrire l'historique.
  await assert.rejects(
    db.query("UPDATE identity.audit_log SET action = 'traficoté'"),
    /immuable/i,
  );
  await assert.rejects(db.query('DELETE FROM identity.audit_log'), /immuable/i);
});

test('le rôle applicatif n’a aucun privilège DDL sur le schéma', async () => {
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE resto_app');
  await assert.rejects(
    db.exec('CREATE TABLE identity.rogue (id int)'),
    /permission denied/i,
  );
  await db.exec('RESET ROLE');
});

test('un superutilisateur contourne silencieusement la RLS : le rôle dédié est obligatoire', async () => {
  await db.exec('RESET ROLE');
  const asSuperuser = await db.query('SELECT count(*)::int AS count FROM identity.users');
  assert.equal(count(asSuperuser), 3, 'superutilisateur voit tout, RLS activée ou non');
  const asApp = await asTenant(db, TENANT_A, 'SELECT count(*)::int AS count FROM identity.users');
  assert.equal(count(asApp), 2, 'sous resto_app, l’isolation s’applique');
});
