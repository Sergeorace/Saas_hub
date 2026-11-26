import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  runTests,
  startServer,
  type AuthClaims,
  type EventEnvelope,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildPlatformAdminApp } from '../app.js';
import {
  applyPlatformEvent,
  createPlatformAdminStore,
  seedPlatformDemo,
  type PlatformAdminStore,
} from '../store.js';
import { applyHealthResult } from '../supervision.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';

function claims(
  sub: string,
  name: string,
  platformPermissions: string[] = [],
  tenantPermissions: Record<string, string[]> = {},
): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: true,
    platformRoles: platformPermissions.length ? ['super_admin'] : [],
    platformPermissions,
    tenantPermissions,
  };
}

function envelope(
  id: string,
  type: string,
  tenantId: string | null,
  payload: Record<string, unknown>,
): EventEnvelope {
  return { id, type, tenantId, occurredAt: new Date().toISOString(), payload };
}

async function main() {
  const store: PlatformAdminStore = createPlatformAdminStore();
  seedPlatformDemo(store, [
    { name: 'identity-service', url: 'http://127.0.0.1:1' },
    { name: 'tenant-service', url: 'http://127.0.0.1:2' },
    { name: 'payment-service', url: 'http://127.0.0.1:3' },
    { name: 'reporting-service', url: 'http://127.0.0.1:4' },
  ]);

  const bus = createEventBus({ name: 'platform-admin-test', internalKey: INTERNAL_KEY });
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const publish = async (
    type: string,
    _tenantId: string | null,
    payload: Record<string, unknown>,
  ) => {
    published.push({ type, payload });
    return bus.publish(type, _tenantId, payload);
  };

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };

  const admin = register(
    'token-admin',
    claims('usr_platform_admin', 'Awa Kossi', [
      'platform:establishments:review',
      'platform:subscriptions:manage',
      'platform:disputes:manage',
      'platform:settings:manage',
      'platform:logs:view',
      'platform:users:manage',
      'platform:operate',
      'tenant:view',
    ]),
  );
  const support = register(
    'token-support',
    claims('usr_support', 'Support', ['platform:establishments:review', 'platform:logs:view']),
  );
  const owner = register(
    'token-owner',
    claims('usr_gerant_sahel', 'Gérant Sahel', [], {
      [SAHEL]: [
        'report:view',
        'report:export',
        'payment:view',
        'payment:manage',
        'audit:view',
        'tenant:view',
      ],
    }),
  );
  const baobabOwner = register(
    'token-baobab',
    claims('usr_baobab', 'Gérant Baobab', [], {
      [BAOBAB]: ['report:view', 'payment:view'],
    }),
  );

  const server = await startServer(
    {
      name: 'platform-admin-service-test',
      routes: buildPlatformAdminApp({
        store,
        publish,
      }),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;

  const cases: TestCase[] = [
    {
      name: 'Santé du service et tableau de bord plateforme',
      run: async () => {
        const health = await api(base, 'GET', '/health');
        assertStatus(health, 200, 'Endpoint de santé');
        assertEqual(health.body.service, 'platform-admin-service-test', 'Nom du service exposé');
        assertEqual(health.body.status, 'ok', 'Statut de santé');

        const dashboard = await api(base, 'GET', '/api/v1/platform/dashboard', undefined, {
          token: admin,
        });
        assertStatus(dashboard, 200, 'Tableau de bord');
        assertEqual(dashboard.body.establishments.total, 3, 'Trois établissements annuaires');
        assertEqual(dashboard.body.establishments.suspended, 1, 'Un établissement suspendu');
        assertEqual(dashboard.body.establishments.byPlan.pro, 1, 'Un abonnement Pro');
        assert(dashboard.body.finance.volume30dXof > 200000, 'Volume 30 jours significatif');
        assert(dashboard.body.finance.commissions30dXof > 0, 'Commissions perçues');
        assert(dashboard.body.finance.mrrXof > 0, 'MRR calculé');
        assertEqual(dashboard.body.finance.openDisputes, 1, 'Un litige ouvert');
        assert(dashboard.body.finance.averageCommissionRatePct > 0, 'Taux moyen calculé');
      },
    },
    {
      name: 'RBAC : un gérant ne peut pas atteindre le back-office plateforme',
      run: async () => {
        const routes = [
          '/api/v1/platform/dashboard',
          '/api/v1/platform/establishments',
          `/api/v1/platform/establishments/${SAHEL}`,
          '/api/v1/platform/commissions',
          '/api/v1/platform/transactions',
          '/api/v1/platform/disputes',
          '/api/v1/platform/supervision',
          '/api/v1/platform/supervision/logs',
          '/api/v1/platform/settings',
          '/api/v1/platform/audit',
        ];
        for (const route of routes) {
          const result = await api(base, 'GET', route, undefined, { token: owner });
          assertStatus(result, 403, `Accès gérant refusé sur ${route}`);
          assertEqual(
            result.body.error.code,
            'platform_scope_denied',
            'Code d’erreur de périmètre',
          );
        }
        const crossTenant = await api(
          base,
          'GET',
          `/api/v1/platform/establishments/${BAOBAB}`,
          undefined,
          {
            token: baobabOwner,
          },
        );
        assertStatus(crossTenant, 403, 'Lecture croisée d’un autre établissement refusée');
        const anonymous = await api(base, 'GET', '/api/v1/platform/dashboard');
        assertStatus(anonymous, 401, 'Accès anonyme refusé');
        const supportWrite = await api(
          base,
          'POST',
          '/api/v1/platform/supervision/check',
          {},
          { token: support },
        );
        assertStatus(supportWrite, 403, 'Le support ne peut pas lancer un contrôle');
        const supportSettings = await api(base, 'GET', '/api/v1/platform/settings', undefined, {
          token: support,
        });
        assertStatus(supportSettings, 403, 'Le support ne lit pas les paramètres globaux');
      },
    },
    {
      name: 'Annuaire des établissements : filtres, recherche et agrégats financiers par tenant',
      run: async () => {
        const active = await api(
          base,
          'GET',
          '/api/v1/platform/establishments?status=active',
          undefined,
          {
            token: admin,
          },
        );
        assertStatus(active, 200, 'Annuaire actif');
        assertEqual(active.body.items.length, 2, 'Deux établissements actifs');
        assert(
          active.body.items.every((item: { status: string }) => item.status === 'active'),
          'Statut filtré',
        );
        const search = await api(
          base,
          'GET',
          '/api/v1/platform/establishments?q=sahel',
          undefined,
          {
            token: admin,
          },
        );
        assertEqual(search.body.items.length, 1, 'Recherche Sahel');
        const sahel = search.body.items[0];
        assert(sahel.volume30dXof > 0, 'Volume Sahel sur 30 jours');
        assert(sahel.commission30dXof > 0, 'Commissions Sahel sur 30 jours');
        const detail = await api(
          base,
          'GET',
          `/api/v1/platform/establishments/${SAHEL}`,
          undefined,
          { token: admin },
        );
        assertStatus(detail, 200, 'Fiche annuaire');
        assert(detail.body.transactions.length > 0, 'Transactions projetées présentes');
        assert(
          detail.body.transactions.every(
            (transaction: { tenantId: string }) => transaction.tenantId === SAHEL,
          ),
          'Aucune fuite de transaction inter-tenant',
        );
        const unknown = await api(
          base,
          'GET',
          '/api/v1/platform/establishments/tnt_inexistant',
          undefined,
          {
            token: admin,
          },
        );
        assertStatus(unknown, 404, 'Établissement inconnu');
      },
    },
    {
      name: 'Commissions : agrégats cohérents, regroupements et période',
      run: async () => {
        const result = await api(base, 'GET', '/api/v1/platform/commissions?days=30', undefined, {
          token: admin,
        });
        assertStatus(result, 200, 'Commissions 30 jours');
        const groups = result.body.groups;
        const tenantSum = groups.tenant.reduce(
          (sum: number, row: { volumeXof: number }) => sum + row.volumeXof,
          0,
        );
        assertEqual(tenantSum, result.body.summary.volumeXof, 'Somme par tenant égale au total');
        const commissionSum = groups.provider.reduce(
          (sum: number, row: { commissionXof: number }) => sum + row.commissionXof,
          0,
        );
        assertEqual(
          commissionSum,
          result.body.summary.commissionXof,
          'Somme par fournisseur cohérente',
        );
        assert(
          groups.tenant.every((row: { key: string }) =>
            ['tnt_sahelgrill', 'tnt_baobab', 'tnt_akwaba'].includes(row.key),
          ),
          'Aucun établissement étranger',
        );
        const methodKeys = groups.method.map((row: { key: string }) => row.key);
        assert(methodKeys.includes('mobile_money'), 'Mobile money représenté');
        assert(groups.day.length >= 5, 'Série journalière présente');
        assert(result.body.transactions.length > 0, 'Dernières transactions listées');
        assert(
          result.body.transactions.every((entry: { tenantId: string }) =>
            ['tnt_sahelgrill', 'tnt_baobab', 'tnt_akwaba'].includes(entry.tenantId),
          ),
          'Transactions cloisonnées',
        );
        const week = await api(base, 'GET', '/api/v1/platform/commissions?days=7', undefined, {
          token: admin,
        });
        assert(
          week.body.summary.volumeXof <= result.body.summary.volumeXof,
          'Période courte plus petite',
        );
        const forbidden = await api(base, 'GET', '/api/v1/platform/commissions', undefined, {
          token: owner,
        });
        assertStatus(forbidden, 403, 'Commissions interdites au gérant');
      },
    },
    {
      name: 'Projection d’événements : établissement, paiement, litiges et idempotence',
      run: async () => {
        applyPlatformEvent(
          store,
          envelope('evt_test_tenant', 'TenantApproved', 'tnt_test', {
            tenantId: 'tnt_test',
            slug: 'test-kitchen',
            plan: 'pro',
            trial: false,
          }),
        );
        assertEqual(
          store.directory.get('tnt_test')?.brandName,
          'Test Kitchen',
          'Annuaire enrichi par événement',
        );

        const payment = envelope('evt_test_payment', 'PaymentConfirmed', 'tnt_test', {
          tenantId: 'tnt_test',
          transactionId: 'pay_test_1',
          amountXof: 10000,
          commissionXof: 200,
          netXof: 9800,
          method: 'mobile_money',
          provider: 'tmoney',
          invoiceNumber: 'FA-TEST-1',
          at: new Date().toISOString(),
        });
        applyPlatformEvent(store, payment);
        applyPlatformEvent(store, payment);
        const tenantRows = store.commissions.filter((entry) => entry.tenantId === 'tnt_test');
        assertEqual(tenantRows.length, 1, 'Événement idempotent : une seule commission');
        assertEqual(tenantRows[0].netXof, 9800, 'Net conservé depuis l’événement');

        applyPlatformEvent(
          store,
          envelope('evt_test_failed', 'PaymentFailed', 'tnt_test', {
            tenantId: 'tnt_test',
            transactionId: 'pay_test_failed',
            amountXof: 4200,
            provider: 'moov',
            reason: 'solde insuffisant',
          }),
        );
        assert(
          store.transactions.some(
            (entry) => entry.tenantId === 'tnt_test' && entry.kind === 'failed',
          ),
          'Échec de paiement projeté',
        );

        applyPlatformEvent(
          store,
          envelope('evt_test_dispute_open', 'DisputeOpened', 'tnt_test', {
            tenantId: 'tnt_test',
            disputeId: 'dsp_test',
            transactionId: 'pay_test_1',
            reason: 'Montant contesté',
          }),
        );
        assertEqual(store.disputes.get('dsp_test')?.status, 'open', 'Litige ouvert');
        applyPlatformEvent(
          store,
          envelope('evt_test_dispute_resolved', 'DisputeResolved', 'tnt_test', {
            tenantId: 'tnt_test',
            disputeId: 'dsp_test',
            resolution: 'Remboursé',
          }),
        );
        assertEqual(store.disputes.get('dsp_test')?.status, 'resolved', 'Litige résolu');
        const isolation = await api(
          base,
          'GET',
          '/api/v1/platform/commissions?days=30',
          undefined,
          { token: admin },
        );
        const testRow = isolation.body.groups.tenant.find(
          (row: { key: string }) => row.key === 'tnt_test',
        );
        assert(
          testRow && testRow.volumeXof === 10000,
          'Nouvel établissement isolé dans son groupe',
        );
        const sahelOnly = await api(
          base,
          'GET',
          `/api/v1/platform/transactions?tenantId=${SAHEL}&limit=200`,
          undefined,
          {
            token: admin,
          },
        );
        assert(
          sahelOnly.body.items.every((entry: { tenantId: string }) => entry.tenantId === SAHEL),
          'Filtre tenant strict sur les transactions',
        );
      },
    },
    {
      name: 'Supervision : contrôles, alertes et journal technique',
      run: async () => {
        const supervision = await api(base, 'GET', '/api/v1/platform/supervision', undefined, {
          token: support,
        });
        assertStatus(supervision, 200, 'Supervision accessible au support');
        assertEqual(supervision.body.services.length, 4, 'Quatre services supervisés');
        assert(
          supervision.body.services.every(
            (service: { status: string }) => service.status === 'unknown',
          ),
          'Statut initial inconnu',
        );
        assert(supervision.body.logs.length >= 3, 'Journaux de démonstration');

        const check = await api(
          base,
          'POST',
          '/api/v1/platform/supervision/check',
          {},
          { token: admin },
        );
        assertStatus(check, 200, 'Contrôle manuel');
        assert(
          store.audit.some((entry) => entry.action === 'supervision.checked'),
          'Contrôle audité',
        );

        const failing = store.services.get('payment-service');
        assert(failing, 'Service paiement enregistré');
        applyHealthResult(store, {
          name: 'payment-service',
          ok: false,
          latencyMs: 120,
          status: null,
          error: 'timeout',
        });
        applyHealthResult(store, {
          name: 'payment-service',
          ok: false,
          latencyMs: 90,
          status: null,
          error: 'timeout',
        });
        const alert = [...store.alerts.values()].find(
          (entry) => entry.service === 'payment-service' && entry.code === 'service_unreachable',
        );
        assert(alert, 'Alerte critique créée après deux échecs');
        assertEqual(alert?.status, 'open', 'Alerte ouverte');
        const ack = await api(
          base,
          'PATCH',
          `/api/v1/platform/supervision/alerts/${alert?.id}`,
          { action: 'acknowledge' },
          { token: admin },
        );
        assertStatus(ack, 200, 'Alerte prise en compte');
        assertEqual(ack.body.alert.status, 'acknowledged', 'Statut acquitté');
        const resolved = await api(
          base,
          'PATCH',
          `/api/v1/platform/supervision/alerts/${alert?.id}`,
          { action: 'resolve' },
          { token: admin },
        );
        assertStatus(resolved, 200, 'Alerte résolue');
        assertEqual(resolved.body.alert.status, 'resolved', 'Statut résolu');
        const double = await api(
          base,
          'PATCH',
          `/api/v1/platform/supervision/alerts/${alert?.id}`,
          { action: 'resolve' },
          { token: admin },
        );
        assertStatus(double, 409, 'Alerte déjà close');
        applyHealthResult(store, {
          name: 'payment-service',
          ok: true,
          latencyMs: 22,
          status: 200,
          error: null,
        });
        assertEqual(store.services.get('payment-service')?.status, 'up', 'Service rétabli');

        const logs = await api(
          base,
          'GET',
          '/api/v1/platform/supervision/logs?level=error',
          undefined,
          {
            token: support,
          },
        );
        assertStatus(logs, 200, 'Journaux filtrés');
        assert(
          logs.body.items.every((entry: { level: string }) => entry.level === 'error'),
          'Filtre niveau respecté',
        );
        const invalidLevel = await api(
          base,
          'GET',
          '/api/v1/platform/supervision/logs?level=trace',
          undefined,
          {
            token: support,
          },
        );
        assertStatus(invalidLevel, 400, 'Niveau invalide rejeté');
      },
    },
    {
      name: 'Paramètres globaux : validation, audit immuable et événement publié',
      run: async () => {
        const current = await api(base, 'GET', '/api/v1/platform/settings', undefined, {
          token: admin,
        });
        assertStatus(current, 200, 'Lecture des paramètres');
        const settings = current.body.settings;
        assertEqual(settings.currency, 'XOF', 'Devise plateforme XOF');
        assert(
          settings.languages.includes('fr') && settings.languages.includes('en'),
          'FR et EN activés',
        );
        assert(settings.providers.length >= 7, 'Fournisseurs configurés');

        const nextProviders = settings.providers.map(
          (provider: { code: string; enabled: boolean }) =>
            provider.code === 'stripe' ? { ...provider, enabled: true } : provider,
        );
        const nextTaxes = settings.taxes.map((tax: { code: string; ratePct: number }) =>
          tax.code === 'TG_TVA_18' ? { ...tax, ratePct: 18.5 } : tax,
        );
        const payload = {
          languages: ['fr', 'en'],
          defaultLanguage: 'fr',
          supportEmail: 'assistance@resto-hub.tg',
          supportPhone: '+228 92 12 34 56',
          timezone: 'Africa/Lome',
          countries: settings.countries,
          taxes: nextTaxes,
          providers: nextProviders,
        };
        const updated = await api(base, 'PUT', '/api/v1/platform/settings', payload, {
          token: admin,
        });
        assertStatus(updated, 200, 'Mise à jour des paramètres');
        assertEqual(
          updated.body.settings.supportEmail,
          'assistance@resto-hub.tg',
          'E-mail support mis à jour',
        );
        assertEqual(
          updated.body.settings.taxes.find((tax: { code: string }) => tax.code === 'TG_TVA_18')
            .ratePct,
          18.5,
          'Taux TVA ajusté',
        );
        assertEqual(
          updated.body.settings.providers.find(
            (provider: { code: string }) => provider.code === 'stripe',
          ).enabled,
          true,
          'Fournisseur activé',
        );
        assertEqual(updated.body.audit.action, 'platform.settings.updated', 'Action auditée');
        assert(
          published.some((entry) => entry.type === 'PlatformSettingsUpdated'),
          'Événement publié',
        );
        assert(
          store.audit.some((entry) => entry.action === 'platform.settings.updated'),
          'Journal d’audit mis à jour',
        );

        const allDisabled = payload.providers.map((provider: { enabled: boolean }) => ({
          ...provider,
          enabled: false,
        }));
        const rejectedProviders = await api(
          base,
          'PUT',
          '/api/v1/platform/settings',
          { ...payload, providers: allDisabled },
          { token: admin },
        );
        assertStatus(rejectedProviders, 422, 'Aucun fournisseur actif refusé');
        const rejectedLanguage = await api(
          base,
          'PUT',
          '/api/v1/platform/settings',
          { ...payload, languages: ['en'], defaultLanguage: 'fr' },
          { token: admin },
        );
        assertStatus(rejectedLanguage, 422, 'Langue par défaut non activée refusée');
        const rejectedTax = await api(
          base,
          'PUT',
          '/api/v1/platform/settings',
          {
            ...payload,
            countries: payload.countries.map((country: { code: string }) =>
              country.code === 'TG' ? { ...country, defaultTaxCode: 'INCONNUE' } : country,
            ),
          },
          { token: admin },
        );
        assertStatus(rejectedTax, 422, 'Taxe inconnue refusée');
        const forbidden = await api(base, 'PUT', '/api/v1/platform/settings', payload, {
          token: owner,
        });
        assertStatus(forbidden, 403, 'Écriture réservée au super-admin');

        const audit = await api(base, 'GET', '/api/v1/platform/audit', undefined, { token: admin });
        assertStatus(audit, 200, 'Journal d’audit lisible');
        assertEqual(audit.body.chain.valid, true, 'Chaîne d’audit valide');
        store.audit[0].meta = { tampered: true };
        const tampered = await api(base, 'GET', '/api/v1/platform/audit', undefined, {
          token: admin,
        });
        assertEqual(
          tampered.body.chain.valid,
          false,
          'Altération détectée par la chaîne de hachage',
        );
        store.audit[0].meta = { demoSeed: true, services: 4 };
        const restored = await api(base, 'GET', '/api/v1/platform/audit', undefined, {
          token: admin,
        });
        assertEqual(restored.body.chain.valid, true, 'Chaîne restaurée après contrôle');
      },
    },
    {
      name: 'Ingestion de journaux techniques protégée par clé de service',
      run: async () => {
        const anonymous = await api(base, 'POST', '/internal/logs', {
          level: 'info',
          service: 'order-service',
          message: 'test',
        });
        assertStatus(anonymous, 401, 'Clé de service requise');
        const invalid = await api(
          base,
          'POST',
          '/internal/logs',
          { level: 'trace', service: 'order-service', message: 'test' },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(invalid, 422, 'Niveau invalide rejeté à l’ingestion');
        const created = await api(
          base,
          'POST',
          '/internal/logs',
          {
            level: 'error',
            service: 'order-service',
            message: 'Échec de publication KDS',
            meta: { orderId: 'ord_1' },
          },
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(created, 201, 'Journal ingéré');
        const filtered = await api(
          base,
          'GET',
          '/api/v1/platform/supervision/logs?service=order-service',
          undefined,
          {
            token: admin,
          },
        );
        assert(filtered.body.items.length >= 1, 'Journal interrogeable par service');
      },
    },
    {
      name: 'Limitation de débit : 429 après dépassement du quota',
      run: async () => {
        const limited = await startServer(
          {
            name: 'rate-limit-test',
            routes: [
              {
                method: 'GET',
                path: '/ping',
                auth: false,
                handler: () => ({ body: { ok: true } }),
              },
            ],
            rateLimit: { windowMs: 60_000, max: 3 },
          },
          0,
        );
        try {
          for (let i = 0; i < 3; i += 1) {
            const ok = await api(limited.url, 'GET', '/ping');
            assertStatus(ok, 200, `Requête ${i + 1} autorisée`);
          }
          const blocked = await api(limited.url, 'GET', '/ping');
          assertStatus(blocked, 429, 'Quota dépassé');
          assertEqual(blocked.body.error.code, 'rate_limited', 'Code limitation de débit');
          assert(blocked.body.error.details.retryAfterSeconds > 0, 'Délai de réessai fourni');
          const health = await api(limited.url, 'GET', '/health');
          assertStatus(health, 200, 'La sonde de santé reste disponible');
        } finally {
          await limited.close();
        }
      },
    },
  ];

  await runTests('platform-admin-service — isolation, RBAC et supervision', cases);
  await server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
