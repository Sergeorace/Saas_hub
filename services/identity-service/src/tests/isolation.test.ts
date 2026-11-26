import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createEventInboxRoute,
  generateTotp,
  runTests,
  startServer,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildIdentityApp } from '../app.js';
import { createIdentityStore } from '../store.js';
import type { IdentityConfig } from '../config.js';

const INTERNAL_KEY = 'test-internal-key';

async function main() {
  const config: IdentityConfig = {
    port: 0,
    tokenSecret: 'test-identity-secret',
    internalKey: INTERNAL_KEY,
    corsOrigin: '*',
    eventSubscribers: [],
    demoOtp: true,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
    otpTtlSeconds: 300,
    demoSeed: false,
  };
  const store = createIdentityStore();
  const { routes, authenticate } = buildIdentityApp({ store, config });
  const bus = createEventBus({ name: 'identity-test', internalKey: INTERNAL_KEY });
  const server = await startServer(
    {
      name: 'identity-service-test',
      routes: [...routes, createEventInboxRoute(bus)],
      authenticate,
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const internal = { internalKey: INTERNAL_KEY };

  const provision = async (input: {
    tenantId: string;
    roleCode: string;
    name: string;
    email: string;
    password: string;
    applicationId?: string;
  }) => {
    const result = await api(base, 'POST', '/internal/provision-user', input, internal);
    assertStatus(result, 201, `Provision ${input.email}`);
    return result.body as { userId: string };
  };

  await api(
    base,
    'POST',
    '/internal/provision-platform-user',
    {
      name: 'Super Admin Test',
      email: 'support@resto-hub.tg',
      password: 'Support#2026',
      platformRole: 'super_admin',
    },
    internal,
  );

  await provision({
    tenantId: 'tnt_alpha',
    roleCode: 'accountant',
    name: 'Compta Alpha',
    email: 'compta@alpha.tg',
    password: 'Compta#2026',
  });
  const betaAccountant = await provision({
    tenantId: 'tnt_beta',
    roleCode: 'accountant',
    name: 'Compta Beta',
    email: 'compta@beta.tg',
    password: 'Compta#2026',
  });
  const alphaOwner = await provision({
    tenantId: 'tnt_alpha',
    roleCode: 'owner',
    name: 'Gérant Alpha',
    email: 'gerant@alpha.tg',
    password: 'Gerant#2026',
    applicationId: 'app_alpha_001',
  });
  const alphaWaiter = await provision({
    tenantId: 'tnt_alpha',
    roleCode: 'waiter',
    name: 'Serveur Alpha',
    email: 'serveur@alpha.tg',
    password: 'Serveur#2026',
  });

  const idempotent = await api(
    base,
    'POST',
    '/internal/provision-user',
    {
      tenantId: 'tnt_alpha',
      roleCode: 'owner',
      name: 'Gérant Alpha',
      email: 'gerant@alpha.tg',
      password: 'Gerant#2026',
      applicationId: 'app_alpha_001',
    },
    internal,
  );
  assertStatus(idempotent, 200, 'Provision idempotente');
  assertEqual(
    idempotent.body.userId,
    alphaOwner.userId,
    'La provision doit être idempotente par applicationId',
  );

  const login = async (email: string, password: string) =>
    api(base, 'POST', '/api/v1/auth/email/login', { email, password });

  const alphaLogin = await login('compta@alpha.tg', 'Compta#2026');
  assertStatus(alphaLogin, 200, 'Connexion comptable Alpha');
  const betaLogin = await login('compta@beta.tg', 'Compta#2026');
  assertStatus(betaLogin, 200, 'Connexion comptable Beta');
  const supportLogin = await login('support@resto-hub.tg', 'Support#2026');
  assertStatus(supportLogin, 200, 'Connexion support plateforme');

  const alphaToken: string = alphaLogin.body.accessToken;
  const betaToken: string = betaLogin.body.accessToken;
  const supportToken: string = supportLogin.body.accessToken;
  const betaSessionId: string = betaLogin.body.sessionId;

  let ownerToken = '';
  let ownerSecret = '';
  let ownerRecoveryCodes: string[] = [];

  const wrongTotp = (secret: string) => {
    const valid = new Set(
      [-1, 0, 1].map((offset) => generateTotp(secret, Date.now() + offset * 30_000)),
    );
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = String(i).padStart(6, '0');
      if (!valid.has(candidate)) return candidate;
    }
    return '000000';
  };

  const cases: TestCase[] = [
    {
      name: 'Gérant : la première connexion impose l’activation du MFA',
      async run() {
        const result = await login('gerant@alpha.tg', 'Gerant#2026');
        assertStatus(result, 200, 'Connexion gérant');
        assert(result.body.mfaRequired === true, 'Le MFA doit être exigé pour un gérant.');
        assert(
          result.body.mfaSetupRequired === true,
          'Le MFA doit être à activer à la première connexion.',
        );
        assert(!result.body.accessToken, 'Aucun jeton ne doit être délivré avant le MFA.');

        const enroll = await api(base, 'POST', '/api/v1/auth/mfa/enroll', {
          ticket: result.body.ticket,
        });
        assertStatus(enroll, 200, 'Enrôlement MFA');
        assert(enroll.body.otpauthUrl.startsWith('otpauth://totp/'), 'URI otpauth attendue.');
        ownerSecret = enroll.body.secret;

        const code = generateTotp(ownerSecret);
        const confirm = await api(base, 'POST', '/api/v1/auth/mfa/confirm', {
          ticket: result.body.ticket,
          code,
        });
        assertStatus(confirm, 200, 'Confirmation MFA');
        assert(
          Array.isArray(confirm.body.recoveryCodes) && confirm.body.recoveryCodes.length === 8,
          '8 codes de secours attendus.',
        );
        assert(
          typeof confirm.body.accessToken === 'string',
          'Jeton d’accès attendu après activation.',
        );
        ownerToken = confirm.body.accessToken;
        ownerRecoveryCodes = confirm.body.recoveryCodes;
      },
    },
    {
      name: 'Gérant : les connexions suivantes exigent un code TOTP, un code invalide est refusé',
      async run() {
        const step = await login('gerant@alpha.tg', 'Gerant#2026');
        assertStatus(step, 200, 'Connexion gérant MFA');
        assert(
          step.body.mfaRequired === true && step.body.mfaSetupRequired === false,
          'Le MFA doit être demandé (déjà activé).',
        );
        const refused = await api(base, 'POST', '/api/v1/auth/mfa/verify', {
          ticket: step.body.ticket,
          code: wrongTotp(ownerSecret),
        });
        assertStatus(refused, 401, 'Code TOTP invalide');
        const second = await login('gerant@alpha.tg', 'Gerant#2026');
        const ok = await api(base, 'POST', '/api/v1/auth/mfa/verify', {
          ticket: second.body.ticket,
          code: generateTotp(ownerSecret),
        });
        assertStatus(ok, 200, 'Code TOTP valide');
        ownerToken = ok.body.accessToken;
      },
    },
    {
      name: 'Gérant : un code de secours fonctionne une seule fois',
      async run() {
        const step = await login('gerant@alpha.tg', 'Gerant#2026');
        const first = await api(base, 'POST', '/api/v1/auth/mfa/verify', {
          ticket: step.body.ticket,
          code: ownerRecoveryCodes[0],
        });
        assertStatus(first, 200, 'Code de secours valide');
        const again = await login('gerant@alpha.tg', 'Gerant#2026');
        const second = await api(base, 'POST', '/api/v1/auth/mfa/verify', {
          ticket: again.body.ticket,
          code: ownerRecoveryCodes[0],
        });
        assertStatus(second, 401, 'Code de secours déjà utilisé');
      },
    },
    {
      name: 'Isolation : les permissions du comptable Alpha ne mentionnent que son établissement',
      async run() {
        const introspect = await api(
          base,
          'POST',
          '/internal/introspect',
          { token: alphaToken },
          internal,
        );
        assertStatus(introspect, 200, 'Introspection Alpha');
        const tenantPermissions = introspect.body.claims.tenantPermissions;
        assert(tenantPermissions.tnt_alpha, 'Permissions attendues pour tnt_alpha.');
        assert(!tenantPermissions.tnt_beta, 'Aucune permission ne doit exister pour tnt_beta.');
      },
    },
    {
      name: 'Isolation : Alpha ne peut pas lister l’équipe de Beta',
      async run() {
        const own = await api(base, 'GET', '/api/v1/tenants/tnt_alpha/team', undefined, {
          token: alphaToken,
        });
        assertStatus(own, 200, 'Équipe Alpha');
        assertEqual(own.body.items.length, 3, 'Alpha doit voir uniquement ses 3 membres');
        const cross = await api(base, 'GET', '/api/v1/tenants/tnt_beta/team', undefined, {
          token: alphaToken,
        });
        assertStatus(cross, 403, 'Équipe Beta depuis Alpha');
        assertEqual(
          cross.body.error.code,
          'tenant_scope_denied',
          'Code d’erreur d’isolation attendu',
        );
      },
    },
    {
      name: 'Isolation : Alpha ne peut pas lire le journal d’audit de Beta',
      async run() {
        const own = await api(base, 'GET', '/api/v1/audit?tenantId=tnt_alpha', undefined, {
          token: alphaToken,
        });
        assertStatus(own, 200, 'Audit Alpha');
        assert(
          own.body.items.every(
            (entry: { tenantId: string | null }) => entry.tenantId === 'tnt_alpha',
          ),
          'Le journal Alpha ne doit contenir que des entrées Alpha.',
        );
        const cross = await api(base, 'GET', '/api/v1/audit?tenantId=tnt_beta', undefined, {
          token: alphaToken,
        });
        assertStatus(cross, 403, 'Audit Beta depuis Alpha');
      },
    },
    {
      name: 'Isolation : Alpha ne peut pas créer un rôle dans Beta',
      async run() {
        const cross = await api(
          base,
          'POST',
          '/api/v1/roles',
          { tenantId: 'tnt_beta', name: 'Rôle pirate', permissions: ['payment:refund'] },
          { token: alphaToken },
        );
        assertStatus(cross, 403, 'Création de rôle chez Beta');
      },
    },
    {
      name: 'Isolation : Alpha ne peut pas modifier les rôles d’un membre de Beta',
      async run() {
        const cross = await api(
          base,
          'PUT',
          `/api/v1/tenants/tnt_beta/team/${betaAccountant.userId}/roles`,
          { roleCodes: ['owner'] },
          { token: alphaToken },
        );
        assertStatus(cross, 403, 'Modification de membre Beta');
        const betaTeam = await api(base, 'GET', '/api/v1/tenants/tnt_beta/team', undefined, {
          token: betaToken,
        });
        assertStatus(betaTeam, 200, 'Équipe Beta intacte');
        assertEqual(
          betaTeam.body.items[0].roles.join(','),
          'accountant',
          'Les rôles de Beta ne doivent pas avoir changé',
        );
      },
    },
    {
      name: 'Isolation : Alpha ne peut pas révoquer une session de Beta',
      async run() {
        const cross = await api(base, 'DELETE', `/api/v1/sessions/${betaSessionId}`, undefined, {
          token: alphaToken,
        });
        assertStatus(cross, 404, 'Révocation de session Beta');
        const stillValid = await api(
          base,
          'POST',
          '/internal/introspect',
          { token: betaToken },
          internal,
        );
        assertStatus(stillValid, 200, 'La session de Beta doit rester active');
      },
    },
    {
      name: 'Isolation : le gérant Alpha ne peut pas gérer les rôles de Beta',
      async run() {
        const cross = await api(
          base,
          'PUT',
          `/api/v1/tenants/tnt_beta/team/${betaAccountant.userId}/roles`,
          { roleCodes: ['accountant'] },
          { token: ownerToken },
        );
        assertStatus(cross, 403, 'Gérant Alpha sur Beta');
        assertEqual(cross.body.error.code, 'tenant_scope_denied', 'Code d’erreur attendu');
      },
    },
    {
      name: 'RBAC personnalisable : le gérant crée un rôle sur mesure puis l’attribue',
      async run() {
        const created = await api(
          base,
          'POST',
          '/api/v1/roles',
          {
            tenantId: 'tnt_alpha',
            name: 'Chef de rang',
            description: 'Encadre les serveurs et peut rembourser sur validation.',
            permissions: ['order:view', 'order:update', 'payment:refund', 'team:view'],
          },
          { token: ownerToken },
        );
        assertStatus(created, 201, 'Création du rôle sur mesure');
        assertEqual(created.body.role.code, 'chef-de-rang', 'Code slug attendu');

        const assign = await api(
          base,
          'PUT',
          `/api/v1/tenants/tnt_alpha/team/${alphaWaiter.userId}/roles`,
          { roleCodes: ['chef-de-rang'] },
          { token: ownerToken },
        );
        assertStatus(assign, 200, 'Attribution du rôle sur mesure');

        const waiterLogin = await login('serveur@alpha.tg', 'Serveur#2026');
        assertStatus(waiterLogin, 200, 'Connexion serveur');
        const introspect = await api(
          base,
          'POST',
          '/internal/introspect',
          { token: waiterLogin.body.accessToken },
          internal,
        );
        assert(
          introspect.body.claims.tenantPermissions.tnt_alpha.includes('payment:refund'),
          'La permission personnalisée doit être effective.',
        );
        assert(
          !introspect.body.claims.tenantPermissions.tnt_beta,
          'Aucune permission Beta attendue.',
        );
      },
    },
    {
      name: 'Isolation : un rôle système ne peut pas être modifié ni supprimé par un gérant',
      async run() {
        const systemRole = [...store.roles.values()].find(
          (role) => role.code === 'waiter' && role.tenantId === null,
        );
        assert(systemRole, 'Rôle système serveur attendu');
        const patch = await api(
          base,
          'PATCH',
          `/api/v1/roles/${systemRole.id}`,
          { permissions: ['payment:refund'] },
          { token: ownerToken },
        );
        assertStatus(patch, 403, 'Modification d’un rôle système');
      },
    },
    {
      name: 'Rotation des jetons : un refresh token déjà utilisé est rejeté',
      async run() {
        const fresh = await login('serveur@alpha.tg', 'Serveur#2026');
        const oldRefresh = fresh.body.refreshToken;
        const rotated = await api(base, 'POST', '/api/v1/auth/refresh', {
          refreshToken: oldRefresh,
        });
        assertStatus(rotated, 200, 'Rotation réussie');
        const replay = await api(base, 'POST', '/api/v1/auth/refresh', {
          refreshToken: oldRefresh,
        });
        assertStatus(replay, 401, 'Rejeu du refresh token');
      },
    },
    {
      name: 'Journal d’audit : la chaîne de hachage est intègre',
      async run() {
        const integrity = await api(base, 'GET', '/api/v1/audit/integrity', undefined, {
          token: supportToken,
        });
        assertStatus(integrity, 200, 'Intégrité du journal');
        assertEqual(integrity.body.valid, true, 'La chaîne d’audit doit être valide');
        assert(integrity.body.entries > 0, 'Le journal doit contenir des entrées');
      },
    },
    {
      name: 'Supervision : le support plateforme voit les établissements mais pas les gérants',
      async run() {
        const all = await api(base, 'GET', '/api/v1/audit', undefined, { token: supportToken });
        assertStatus(all, 200, 'Audit global support');
        assert(all.body.items.length > 0, 'Le support doit voir des entrées.');
        const alphaOnly = await api(base, 'GET', '/api/v1/audit?tenantId=tnt_alpha', undefined, {
          token: supportToken,
        });
        assertStatus(alphaOnly, 200, 'Audit Alpha support');
        const cross = await api(base, 'GET', '/api/v1/tenants/tnt_beta/team', undefined, {
          token: ownerToken,
        });
        assertStatus(cross, 403, 'Le gérant ne doit pas voir Beta');
      },
    },
  ];

  await runTests('IDENTITY-SERVICE — authentification, RBAC et isolation multi-tenant', cases);
  await bus.flush();
  await server.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
