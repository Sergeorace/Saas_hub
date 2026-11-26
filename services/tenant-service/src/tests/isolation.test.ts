import { createHmac } from 'node:crypto';
import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createEventInboxRoute,
  createIntrospectionAuthenticator,
  createServiceClient,
  generateTotp,
  runTests,
  startServer,
  waitFor,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildIdentityApp } from '@resto-hub/identity-service/app';
import { createIdentityStore } from '@resto-hub/identity-service/store';
import type { IdentityConfig } from '@resto-hub/identity-service/config';
import { buildTenantApp } from '../app.js';
import { createTenantStore } from '../store.js';
import type { TenantConfig } from '../config.js';

const INTERNAL_KEY = 'test-internal-key';
const BILLING_SECRET = 'test-billing-secret';

async function main() {
  const identityConfig: IdentityConfig = {
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
  const identityStore = createIdentityStore();
  const identityApp = buildIdentityApp({ store: identityStore, config: identityConfig });
  const identitySubscribers: string[] = [];
  const identityBus = createEventBus({
    name: 'identity-test',
    internalKey: INTERNAL_KEY,
    subscribers: identitySubscribers,
  });
  identityBus.on('TenantSuspended', async (envelope) => {
    const tenantId = String(envelope.payload.tenantId ?? '');
    if (tenantId)
      identityStore.revokeTenantSessions(tenantId, 'tenant-service', 'tenant_suspended');
  });
  const identityServer = await startServer(
    {
      name: 'identity-service-test',
      routes: [...identityApp.routes, createEventInboxRoute(identityBus)],
      authenticate: identityApp.authenticate,
      internalKey: INTERNAL_KEY,
    },
    0,
  );

  await api(
    identityServer.url,
    'POST',
    '/internal/provision-platform-user',
    {
      name: 'Super Admin',
      email: 'admin@test.tg',
      password: 'Admin#2026',
      platformRole: 'super_admin',
    },
    { internalKey: INTERNAL_KEY },
  );

  const tenantConfig: TenantConfig = {
    port: 0,
    internalKey: INTERNAL_KEY,
    identityUrl: identityServer.url,
    catalogUrl: 'http://127.0.0.1:1',
    corsOrigin: '*',
    eventSubscribers: [identityServer.url],
    billingWebhookSecret: BILLING_SECRET,
    demoBilling: true,
    trialDays: 14,
    demoSeed: false,
  };
  const tenantStore = createTenantStore();
  const tenantBus = createEventBus({
    name: 'tenant-test',
    internalKey: INTERNAL_KEY,
    subscribers: [identityServer.url],
  });
  const identityClient = createServiceClient({
    baseUrl: identityServer.url,
    internalKey: INTERNAL_KEY,
  });
  const tenantRoutes = buildTenantApp({
    store: tenantStore,
    config: tenantConfig,
    identity: identityClient,
    publish: (type, tenantId, payload) => tenantBus.publish(type, tenantId, payload),
  });
  const tenantServer = await startServer(
    {
      name: 'tenant-service-test',
      routes: [...tenantRoutes, createEventInboxRoute(tenantBus)],
      authenticate: createIntrospectionAuthenticator({
        identityUrl: identityServer.url,
        internalKey: INTERNAL_KEY,
        cacheTtlMs: 0,
      }),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  identitySubscribers.push(tenantServer.url);

  const idBase = identityServer.url;
  const base = tenantServer.url;
  const internal = { internalKey: INTERNAL_KEY };

  const identityLogin = async (email: string, password: string) =>
    api(idBase, 'POST', '/api/v1/auth/email/login', { email, password });

  const adminLogin = await identityLogin('admin@test.tg', 'Admin#2026');
  assertStatus(adminLogin, 200, 'Connexion super-admin');
  const adminToken: string = adminLogin.body.accessToken;

  const publicUserRegister = await api(idBase, 'POST', '/api/v1/auth/email/register', {
    name: 'Visiteur',
    email: 'visiteur@test.tg',
    password: 'Visiteur#2026',
  });
  assertStatus(publicUserRegister, 201, 'Inscription publique identité');
  const visitorToken: string = publicUserRegister.body.accessToken;

  type AppSeed = {
    brandName: string;
    legalName: string;
    email: string;
    phone: string;
    password: string;
    plan: 'starter' | 'pro' | 'enterprise';
  };

  const createApplication = async (seed: AppSeed) => {
    const created = await api(base, 'POST', '/api/v1/applications', {
      establishment: {
        legalName: seed.legalName,
        brandName: seed.brandName,
        type: 'both',
        nif: '1001234567',
        rccm: 'TG-LOM-2025-B-0001',
        address: { street: 'Rue 12', district: 'Bè', city: 'Lomé', country: 'Togo' },
        contact: { phone: seed.phone, email: seed.email },
        hours: [{ day: 'lun', open: '11:00', close: '23:00' }],
      },
      manager: {
        name: `Gérant ${seed.brandName}`,
        email: seed.email,
        phone: seed.phone,
        password: seed.password,
      },
      plan: seed.plan,
      languages: ['fr', 'en'],
      acceptTerms: false,
    });
    assertStatus(created, 201, `Création demande ${seed.brandName}`);
    return {
      id: created.body.applicationId as string,
      token: created.body.applicationToken as string,
      reference: created.body.reference as string,
    };
  };

  const uploadDoc = (id: string, token: string, type: string, fileName: string) =>
    api(
      base,
      'POST',
      `/api/v1/applications/${id}/documents`,
      {
        type,
        fileName,
        mimeType: 'application/pdf',
        dataBase64: Buffer.from(`Document ${type} — ${fileName}`).toString('base64'),
      },
      { headers: { 'x-application-token': token } },
    );

  const submit = (id: string, token: string) =>
    api(
      base,
      'POST',
      `/api/v1/applications/${id}/submit`,
      {},
      { headers: { 'x-application-token': token } },
    );

  const patchApplication = (id: string, token: string, body: unknown) =>
    api(base, 'PATCH', `/api/v1/applications/${id}`, body, {
      headers: { 'x-application-token': token },
    });

  const approve = async (id: string) => {
    const result = await api(
      base,
      'POST',
      `/api/v1/admin/applications/${id}/review`,
      { action: 'approve' },
      { token: adminToken },
    );
    assertStatus(result, 200, `Validation ${id}`);
    return result.body;
  };

  const accountByTenant = async (tenantId: string, email: string, password: string) => {
    const created = await api(
      idBase,
      'POST',
      '/internal/provision-user',
      { tenantId, roleCode: 'accountant', name: `Compta ${tenantId}`, email, password },
      internal,
    );
    assertStatus(created, 201, `Provision comptable ${email}`);
    const login = await identityLogin(email, password);
    assertStatus(login, 200, `Connexion comptable ${email}`);
    return { userId: created.body.userId as string, token: login.body.accessToken as string };
  };

  const loginOwnerWithMfa = undefined;
  void loginOwnerWithMfa;

  const alphaSeed: AppSeed = {
    brandName: 'Alpha Grill',
    legalName: 'ALPHA GRILL SARL',
    email: 'gerant@alpha.tg',
    phone: '+22891000101',
    password: 'Gerant#2026',
    plan: 'pro',
  };
  const betaSeed: AppSeed = {
    brandName: 'Beta Bar',
    legalName: 'BETA BAR SARL',
    email: 'gerant@beta.tg',
    phone: '+22892000202',
    password: 'BetaGerant#2026',
    plan: 'starter',
  };
  const gammaSeed: AppSeed = {
    brandName: 'Gamma Café',
    legalName: 'GAMMA CAFE SARL',
    email: 'gerant@gamma.tg',
    phone: '+22893000303',
    password: 'Gamma#2026',
    plan: 'starter',
  };

  const alpha = await createApplication(alphaSeed);
  const beta = await createApplication(betaSeed);
  const gamma = await createApplication(gammaSeed);
  assert(gamma.reference !== alpha.reference, 'Références uniques attendues');

  assertStatus(await patchApplication(beta.id, beta.token, { acceptTerms: true }), 200, 'CGU Beta');
  assertStatus(await uploadDoc(beta.id, beta.token, 'nif', 'NIF-Beta.txt'), 201, 'NIF Beta');
  assertStatus(await uploadDoc(beta.id, beta.token, 'rccm', 'RCCM-Beta.txt'), 201, 'RCCM Beta');
  assertStatus(await submit(beta.id, beta.token), 200, 'Soumission Beta');

  let alphaTenantId = '';
  let betaTenantId = '';
  let alphaAccountantToken = '';
  let betaAccountantToken = '';
  let ownerAToken = '';
  let ownerASecret = '';
  let betaInvoiceId = '';

  const cases: TestCase[] = [
    {
      name: 'Parcours public : brouillon multi-étapes, pièces justificatives, soumission',
      async run() {
        const patched = await patchApplication(alpha.id, alpha.token, {
          acceptTerms: true,
          manager: { name: 'Kossi Amegah' },
        });
        assertStatus(patched, 200, 'Étape 2 de la demande');
        const badToken = await api(base, 'GET', `/api/v1/applications/${alpha.id}`, undefined, {
          headers: { 'x-application-token': 'mauvais-jeton' },
        });
        assertStatus(badToken, 403, 'Jeton de demande invalide');
        assertStatus(
          await uploadDoc(alpha.id, alpha.token, 'nif', 'NIF-Alpha.txt'),
          201,
          'Pièce NIF',
        );
        assertStatus(
          await uploadDoc(alpha.id, alpha.token, 'rccm', 'RCCM-Alpha.txt'),
          201,
          'Pièce RCCM',
        );
        const submitted = await submit(alpha.id, alpha.token);
        assertStatus(submitted, 200, 'Soumission Alpha');
        assertEqual(submitted.body.application.status, 'submitted', 'Statut soumis attendu');
        const tracking = await api(base, 'GET', `/api/v1/applications/${alpha.id}`, undefined, {
          headers: { 'x-application-token': alpha.token },
        });
        assertStatus(tracking, 200, 'Suivi public');
        assertEqual(tracking.body.application.status, 'submitted', 'Suivi : statut soumis');
        assert(
          !JSON.stringify(tracking.body).includes('Gerant#2026'),
          'Le mot de passe ne doit jamais être exposé',
        );
      },
    },
    {
      name: 'Sécurité : un simple utilisateur ne peut pas ouvrir le back-office plateforme',
      async run() {
        const list = await api(base, 'GET', '/api/v1/admin/applications', undefined, {
          token: visitorToken,
        });
        assertStatus(list, 403, 'Liste des demandes par un visiteur');
        const tenants = await api(base, 'GET', '/api/v1/admin/tenants', undefined, {
          token: visitorToken,
        });
        assertStatus(tenants, 403, 'Liste des établissements par un visiteur');
      },
    },
    {
      name: 'Validation : une demande incomplète ne peut pas être soumise',
      async run() {
        const rejected = await submit(gamma.id, gamma.token);
        assertStatus(rejected, 422, 'Soumission sans pièces');
        assertEqual(
          rejected.body.error.code,
          'application_incomplete',
          'Code d’incomplétude attendu',
        );
        assert(
          rejected.body.error.details.missing.includes('pièce NIF'),
          'Pièce NIF manquante signalée',
        );
        assertStatus(
          await uploadDoc(gamma.id, gamma.token, 'nif', 'NIF-Gamma.txt'),
          201,
          'Pièce NIF Gamma',
        );
        assertStatus(
          await uploadDoc(gamma.id, gamma.token, 'rccm', 'RCCM-Gamma.txt'),
          201,
          'Pièce RCCM Gamma',
        );
        assertStatus(
          await patchApplication(gamma.id, gamma.token, { acceptTerms: true }),
          200,
          'CGU Gamma',
        );
        assertStatus(await submit(gamma.id, gamma.token), 200, 'Soumission Gamma');
      },
    },
    {
      name: 'KYC : la validation par le super-admin crée l’espace, l’abonnement et le site principal',
      async run() {
        const result = await approve(alpha.id);
        alphaTenantId = result.tenant.id;
        assertEqual(result.tenant.slug, 'alpha-grill', 'Sous-domaine attendu');
        assertEqual(result.tenant.status, 'active', 'Établissement actif attendu');
        assertEqual(result.subscription.status, 'trialing', 'Essai gratuit attendu');
        assert(
          result.tenant.subdomain.endsWith('.resto-hub.tg'),
          'Sous-domaine plateforme attendu',
        );
        assertEqual(result.credentials.email, 'gerant@alpha.tg', 'Accès gérant attendu');
        const detail = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}`, undefined, {
          token: adminToken,
        });
        assertStatus(detail, 200, 'Détail établissement Alpha');
        assertEqual(detail.body.sites.length, 1, 'Site principal automatique');
        const duplicate = await api(
          base,
          'POST',
          `/api/v1/admin/applications/${alpha.id}/review`,
          { action: 'approve' },
          { token: adminToken },
        );
        assertStatus(duplicate, 409, 'Double validation refusée');
        const betaApproved = await approve(beta.id);
        betaTenantId = betaApproved.tenant.id;
        assertEqual(betaApproved.subscription.status, 'trialing', 'Essai Beta attendu');
        assert(alphaTenantId !== betaTenantId, 'Identifiants distincts par établissement');
      },
    },
    {
      name: 'Refus : la décision est motivée, tracée et définitive',
      async run() {
        const refused = await api(
          base,
          'POST',
          `/api/v1/admin/applications/${gamma.id}/review`,
          { action: 'reject', reason: 'RCCM non conforme' },
          { token: adminToken },
        );
        assertStatus(refused, 200, 'Refus de la demande');
        assertEqual(refused.body.application.status, 'rejected', 'Statut refusé attendu');
        assertEqual(refused.body.application.review.reason, 'RCCM non conforme', 'Motif conservé');
        const retry = await api(
          base,
          'POST',
          `/api/v1/admin/applications/${gamma.id}/review`,
          { action: 'approve' },
          { token: adminToken },
        );
        assertStatus(retry, 409, 'Demande refusée non réactivable');
        const noReason = await api(
          base,
          'POST',
          `/api/v1/admin/applications/${alpha.id}/review`,
          { action: 'reject' },
          { token: adminToken },
        );
        assertStatus(noReason, 409, 'Demande déjà validée');
      },
    },
    {
      name: 'Isolation : chaque comptable ne voit que son établissement (lectures croisées refusées)',
      async run() {
        const alphaAccountant = await accountByTenant(
          alphaTenantId,
          'compta@alpha.tg',
          'Compta#2026',
        );
        const betaAccountant = await accountByTenant(betaTenantId, 'compta@beta.tg', 'Compta#2026');
        alphaAccountantToken = alphaAccountant.token;
        betaAccountantToken = betaAccountant.token;

        const mine = await api(base, 'GET', '/api/v1/tenants/mine', undefined, {
          token: alphaAccountantToken,
        });
        assertStatus(mine, 200, 'Établissements du comptable Alpha');
        assertEqual(mine.body.items.length, 1, 'Un seul établissement visible');
        assertEqual(mine.body.items[0].id, alphaTenantId, 'Seul Alpha visible');
        assert(!JSON.stringify(mine.body).includes(betaTenantId), 'Beta ne doit jamais apparaître');

        const own = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}`, undefined, {
          token: alphaAccountantToken,
        });
        assertStatus(own, 200, 'Alpha accessible au comptable Alpha');

        const attempts: Array<[string, string, unknown]> = [
          ['GET', `/api/v1/tenants/${betaTenantId}`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/sites`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/subscription`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/audit`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/onboarding`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/team`, undefined],
          ['GET', `/api/v1/tenants/${betaTenantId}/export?format=json`, undefined],
          ['PATCH', `/api/v1/tenants/${betaTenantId}/branding`, { primaryColor: '#000000' }],
          [
            'POST',
            `/api/v1/tenants/${betaTenantId}/sites`,
            { name: 'Site pirate', address: 'Nulle part' },
          ],
        ];
        for (const [method, path, body] of attempts) {
          const result = await api(base, method, path, body, { token: alphaAccountantToken });
          assertStatus(result, 403, `${method} ${path} depuis Alpha`);
          assertEqual(result.body.error.code, 'tenant_scope_denied', `Code d’isolation ${path}`);
        }

        const betaOwn = await api(base, 'GET', `/api/v1/tenants/${betaTenantId}`, undefined, {
          token: betaAccountantToken,
        });
        assertStatus(betaOwn, 200, 'Beta accessible à son comptable');
        const betaSites = await api(
          base,
          'GET',
          `/api/v1/tenants/${betaTenantId}/sites`,
          undefined,
          { token: betaAccountantToken },
        );
        assertStatus(betaSites, 200, 'Sites Beta');
        const crossAudit = await api(
          base,
          'GET',
          `/api/v1/tenants/${alphaTenantId}/audit`,
          undefined,
          { token: betaAccountantToken },
        );
        assertStatus(crossAudit, 403, 'Audit Alpha depuis Beta');
      },
    },
    {
      name: 'MFA : le gérant Alpha active son MFA obligatoire',
      async run() {
        const step = await identityLogin('gerant@alpha.tg', 'Gerant#2026');
        assertStatus(step, 200, 'Connexion gérant Alpha');
        assert(step.body.mfaSetupRequired === true, 'Activation MFA exigée');
        const enroll = await api(idBase, 'POST', '/api/v1/auth/mfa/enroll', {
          ticket: step.body.ticket,
        });
        assertStatus(enroll, 200, 'Enrôlement MFA');
        ownerASecret = enroll.body.secret;
        const confirm = await api(idBase, 'POST', '/api/v1/auth/mfa/confirm', {
          ticket: step.body.ticket,
          code: generateTotp(ownerASecret),
        });
        assertStatus(confirm, 200, 'Activation MFA');
        ownerAToken = confirm.body.accessToken;
        const me = await api(base, 'GET', '/api/v1/tenants/mine', undefined, {
          token: ownerAToken,
        });
        assertStatus(me, 200, 'Accès gérant Alpha après MFA');
        assertEqual(me.body.items[0].role, 'owner', 'Rôle gérant attendu');
      },
    },
    {
      name: 'Personnalisation : couleurs/langues par établissement, validations et audit',
      async run() {
        const cross = await api(
          base,
          'PATCH',
          `/api/v1/tenants/${betaTenantId}/branding`,
          { primaryColor: '#111111' },
          { token: ownerAToken },
        );
        assertStatus(cross, 403, 'Personnalisation de Beta depuis Alpha');

        const updated = await api(
          base,
          'PATCH',
          `/api/v1/tenants/${alphaTenantId}/branding`,
          {
            logoUrl: 'https://cdn.resto-hub.tg/alpha-grill/logo.svg',
            primaryColor: '#B45309',
            secondaryColor: '#115E59',
            languages: ['fr', 'en'],
            currency: 'XOF',
            brandName: 'Alpha Grill & Bar',
          },
          { token: ownerAToken },
        );
        assertStatus(updated, 200, 'Personnalisation Alpha');
        assertEqual(
          updated.body.tenant.settings.primaryColor,
          '#B45309',
          'Couleur primaire appliquée',
        );
        assertEqual(updated.body.tenant.brandName, 'Alpha Grill & Bar', 'Nom commercial appliqué');

        const invalidColor = await api(
          base,
          'PATCH',
          `/api/v1/tenants/${alphaTenantId}/branding`,
          { primaryColor: 'orange' },
          { token: ownerAToken },
        );
        assertStatus(invalidColor, 422, 'Couleur invalide refusée');
        const invalidLanguage = await api(
          base,
          'PATCH',
          `/api/v1/tenants/${alphaTenantId}/branding`,
          { languages: ['de'] },
          { token: ownerAToken },
        );
        assertStatus(invalidLanguage, 422, 'Langue non supportée refusée');

        const audit = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}/audit`, undefined, {
          token: ownerAToken,
        });
        assertStatus(audit, 200, 'Audit Alpha');
        assert(
          audit.body.items.some(
            (entry: { action: string }) => entry.action === 'tenant.branding_updated',
          ),
          'Changement de personnalisation audité',
        );
        assert(
          audit.body.items.every(
            (entry: { tenantId: string | null }) => entry.tenantId === alphaTenantId,
          ),
          'Aucune entrée d’un autre établissement',
        );
      },
    },
    {
      name: 'Multi-sites : la limite du plan Starter/Pro est appliquée côté serveur',
      async run() {
        const first = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/sites`,
          { name: 'Alpha Grill — Agoè', address: 'Route d’Agoè, Lomé' },
          { token: ownerAToken },
        );
        assertStatus(first, 201, 'Deuxième site Alpha');
        const second = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/sites`,
          { name: 'Alpha Grill — Aéroport', address: 'Boulevard de l’aéroport, Lomé' },
          { token: ownerAToken },
        );
        assertStatus(second, 201, 'Troisième site Alpha');
        const overflow = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/sites`,
          { name: 'Alpha Grill — Kpalimé', address: 'Kpalimé centre' },
          { token: ownerAToken },
        );
        assertStatus(overflow, 422, 'Quatrième site refusé (plan Pro = 3)');
        assertEqual(overflow.body.error.code, 'plan_site_limit', 'Code de limite de plan attendu');
        const sites = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}/sites`, undefined, {
          token: ownerAToken,
        });
        assertEqual(sites.body.items.length, 3, 'Trois sites conservés');
        const primary = sites.body.items.find((site: { isPrimary: boolean }) => site.isPrimary);
        const deletePrimary = await api(
          base,
          'DELETE',
          `/api/v1/tenants/${alphaTenantId}/sites/${primary.id}`,
          undefined,
          { token: ownerAToken },
        );
        assertStatus(deletePrimary, 422, 'Suppression du site principal refusée');
      },
    },
    {
      name: 'Onboarding : la checklist reflète la configuration réelle sans fuite inter-tenant',
      async run() {
        const onboarding = await api(
          base,
          'GET',
          `/api/v1/tenants/${alphaTenantId}/onboarding`,
          undefined,
          {
            token: ownerAToken,
          },
        );
        assertStatus(onboarding, 200, 'Checklist Alpha');
        const items = onboarding.body.items as Array<{
          key: string;
          done: boolean;
          detail?: string;
        }>;
        assertEqual(items.find((item) => item.key === 'space')?.done, true, 'Espace créé');
        assertEqual(
          items.find((item) => item.key === 'branding')?.done,
          true,
          'Personnalisation détectée',
        );
        assertEqual(items.find((item) => item.key === 'hours')?.done, true, 'Horaires détectés');
        assertEqual(items.find((item) => item.key === 'team')?.done, true, 'Équipe détectée');
        assertEqual(
          items.find((item) => item.key === 'catalog')?.done,
          false,
          'Catalogue pas encore créé',
        );
        assert(onboarding.body.progress > 50, 'Progression attendue supérieure à 50 %');
        const cross = await api(
          base,
          'GET',
          `/api/v1/tenants/${betaTenantId}/onboarding`,
          undefined,
          {
            token: alphaAccountantToken,
          },
        );
        assertStatus(cross, 403, 'Checklist Beta depuis Alpha');
      },
    },
    {
      name: 'Abonnement : facture XOF, paiement démo, activation et idempotence',
      async run() {
        const checkout = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/subscription/checkout`,
          { plan: 'pro' },
          { token: ownerAToken },
        );
        assertStatus(checkout, 201, 'Création de facture');
        assertEqual(checkout.body.invoice.amountXof, 35000, 'Montant XOF du plan Pro');
        assertEqual(checkout.body.invoice.status, 'pending', 'Facture en attente');
        const paid = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/subscription/invoices/${checkout.body.invoice.id}/pay-demo`,
          {},
          { token: ownerAToken },
        );
        assertStatus(paid, 200, 'Paiement démo');
        assertEqual(paid.body.invoice.status, 'paid', 'Facture payée');
        const replay = await api(
          base,
          'POST',
          `/api/v1/tenants/${alphaTenantId}/subscription/invoices/${checkout.body.invoice.id}/pay-demo`,
          {},
          { token: ownerAToken },
        );
        assertStatus(replay, 200, 'Rejeu du paiement');
        assertEqual(replay.body.alreadyProcessed, true, 'Paiement idempotent');
        const subscription = await api(
          base,
          'GET',
          `/api/v1/tenants/${alphaTenantId}/subscription`,
          undefined,
          {
            token: ownerAToken,
          },
        );
        assertStatus(subscription, 200, 'Abonnement Alpha');
        assertEqual(subscription.body.subscription.status, 'active', 'Abonnement actif');
        assert(
          subscription.body.invoices.some(
            (invoice: { status: string }) => invoice.status === 'paid',
          ),
          'Facture payée listée',
        );
      },
    },
    {
      name: 'Webhook de facturation : signature HMAC requise et idempotence',
      async run() {
        const checkout = await api(
          base,
          'POST',
          `/api/v1/tenants/${betaTenantId}/subscription/checkout`,
          { plan: 'starter' },
          { token: adminToken },
        );
        assertStatus(checkout, 201, 'Facture Beta');
        betaInvoiceId = checkout.body.invoice.id;
        const payload = { invoiceId: betaInvoiceId, provider: 'cinetpay', reference: 'CP-TEST-01' };
        const badSignature = await api(base, 'POST', '/internal/webhooks/billing', payload, {
          headers: { 'x-billing-signature': 'deadbeef' },
        });
        assertStatus(badSignature, 401, 'Signature invalide');
        const signature = createHmac('sha256', BILLING_SECRET)
          .update(JSON.stringify(payload))
          .digest('hex');
        const ok = await api(base, 'POST', '/internal/webhooks/billing', payload, {
          headers: { 'x-billing-signature': signature },
        });
        assertStatus(ok, 200, 'Webhook signé accepté');
        assertEqual(ok.body.invoice.status, 'paid', 'Facture Beta payée');
        const replay = await api(base, 'POST', '/internal/webhooks/billing', payload, {
          headers: { 'x-billing-signature': signature },
        });
        assertStatus(replay, 200, 'Webhook rejoué');
        assertEqual(replay.body.alreadyProcessed, true, 'Webhook idempotent');
      },
    },
    {
      name: 'Exports : données cloisonnées, format CSV et traçabilité',
      async run() {
        const json = await api(
          base,
          'GET',
          `/api/v1/tenants/${alphaTenantId}/export?format=json`,
          undefined,
          {
            token: ownerAToken,
          },
        );
        assertStatus(json, 200, 'Export JSON Alpha');
        assertEqual(json.body.tenant.id, alphaTenantId, 'Établissement Alpha exporté');
        assert(
          !JSON.stringify(json.body).includes(betaTenantId),
          'Aucune donnée Beta dans l’export',
        );
        assert(
          !JSON.stringify(json.body).includes('gerant@beta.tg'),
          'Aucun contact Beta dans l’export',
        );
        const csv = await api(
          base,
          'GET',
          `/api/v1/tenants/${alphaTenantId}/export?format=csv`,
          undefined,
          {
            token: ownerAToken,
          },
        );
        assertStatus(csv, 200, 'Export CSV Alpha');
        assert(String(csv.body).includes('alpha-grill'), 'Contenu CSV Alpha attendu');
        const audit = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}/audit`, undefined, {
          token: ownerAToken,
        });
        assert(
          audit.body.items.some(
            (entry: { action: string; meta: { format?: string } }) =>
              entry.action === 'tenant.exported',
          ),
          'Export audité',
        );
      },
    },
    {
      name: 'Supervision : agrégats plateforme et chaîne d’audit intègre',
      async run() {
        const overview = await api(base, 'GET', '/api/v1/admin/overview', undefined, {
          token: adminToken,
        });
        assertStatus(overview, 200, 'Vue d’ensemble plateforme');
        assertEqual(overview.body.tenants.active, 2, 'Deux établissements actifs');
        assert(
          overview.body.billing.collectedXof >= 35000 + 15000,
          'Encaissements cumulés attendus',
        );
        assertEqual(overview.body.audit.integrity, true, 'Chaîne d’audit intègre');
        const forbidden = await api(base, 'GET', '/api/v1/admin/overview', undefined, {
          token: alphaAccountantToken,
        });
        assertStatus(forbidden, 403, 'Vue d’ensemble réservée à la plateforme');
      },
    },
    {
      name: 'Suspension : décision plateforme, suspension réelle et révocation des sessions par événement',
      async run() {
        const suspend = await api(
          base,
          'POST',
          `/api/v1/admin/tenants/${alphaTenantId}/suspend`,
          { reason: 'Litige client en cours d’instruction' },
          { token: adminToken },
        );
        assertStatus(suspend, 200, 'Suspension Alpha');
        assertEqual(suspend.body.tenant.status, 'suspended', 'Statut suspendu');
        await waitFor(async () => {
          const introspect = await api(
            idBase,
            'POST',
            '/internal/introspect',
            { token: ownerAToken },
            internal,
          );
          return introspect.status === 401;
        }, 5000);
        await waitFor(async () => {
          const introspect = await api(
            idBase,
            'POST',
            '/internal/introspect',
            { token: alphaAccountantToken },
            internal,
          );
          return introspect.status === 401;
        }, 5000);
        const blocked = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}`, undefined, {
          token: ownerAToken,
        });
        assertStatus(blocked, 401, 'Session gérant révoquée après suspension');
        const betaStillWorks = await api(
          base,
          'GET',
          `/api/v1/tenants/${betaTenantId}`,
          undefined,
          { token: betaAccountantToken },
        );
        assertStatus(betaStillWorks, 200, 'Beta non affectée par la suspension d’Alpha');
      },
    },
    {
      name: 'Réactivation, reconnexion MFA et relance des impayés (dunning)',
      async run() {
        const reactivate = await api(
          base,
          'POST',
          `/api/v1/admin/tenants/${alphaTenantId}/reactivate`,
          { note: 'Litige clos' },
          { token: adminToken },
        );
        assertStatus(reactivate, 200, 'Réactivation Alpha');
        assertEqual(reactivate.body.tenant.status, 'active', 'Statut actif rétabli');
        const relogin = await identityLogin('gerant@alpha.tg', 'Gerant#2026');
        assertStatus(relogin, 200, 'Reconnexion gérant');
        assertEqual(relogin.body.mfaRequired, true, 'MFA exigé à la reconnexion');
        const verify = await api(idBase, 'POST', '/api/v1/auth/mfa/verify', {
          ticket: relogin.body.ticket,
          code: generateTotp(ownerASecret),
        });
        assertStatus(verify, 200, 'Vérification MFA');
        const access = await api(base, 'GET', `/api/v1/tenants/${alphaTenantId}`, undefined, {
          token: verify.body.accessToken,
        });
        assertStatus(access, 200, 'Accès rétabli après réactivation');

        const betaCheckout = await api(
          base,
          'POST',
          `/api/v1/tenants/${betaTenantId}/subscription/checkout`,
          { plan: 'starter' },
          { token: adminToken },
        );
        assertStatus(betaCheckout, 201, 'Nouvelle facture Beta');
        betaInvoiceId = betaCheckout.body.invoice.id;
        const betaInvoice = tenantStore.invoices.get(betaInvoiceId);
        assert(betaInvoice, 'Facture Beta attendue');
        betaInvoice.dueAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const dunning = await api(
          base,
          'POST',
          '/internal/billing/run-dunning',
          { graceDays: 0 },
          internal,
        );
        assertStatus(dunning, 200, 'Relance des impayés');
        assertEqual(dunning.body.suspendedTenants, 1, 'Beta suspendue pour impayé');
        const betaDetail = await api(base, 'GET', `/api/v1/admin/tenants`, undefined, {
          token: adminToken,
        });
        const betaRow = betaDetail.body.items.find(
          (tenant: { id: string }) => tenant.id === betaTenantId,
        );
        assertEqual(betaRow.status, 'suspended', 'Beta suspendue dans le back-office');
        await waitFor(async () => {
          const introspect = await api(
            idBase,
            'POST',
            '/internal/introspect',
            { token: betaAccountantToken },
            internal,
          );
          return introspect.status === 401;
        }, 5000);
        const overview = await api(base, 'GET', '/api/v1/admin/overview', undefined, {
          token: adminToken,
        });
        assertEqual(
          overview.body.audit.integrity,
          true,
          'Audit intègre après opérations sensibles',
        );
        assert(overview.body.audit.entries > 10, 'Journal d’audit alimenté');
      },
    },
    {
      name: 'Découverte publique : seuls les établissements actifs sont exposés, sans fuite de données privées',
      async run() {
        const list = await api(base, 'GET', '/api/v1/public/establishments');
        assertStatus(list, 200, 'Annuaire public');
        const ids = (list.body.items as Array<{ id: string }>).map((item) => item.id);
        assert(ids.includes(alphaTenantId), 'Alpha actif listé publiquement');
        assert(!ids.includes(betaTenantId), 'Beta suspendue absente de l’annuaire');
        const payload = JSON.stringify(list.body);
        assert(!payload.includes('gerant@alpha.tg'), 'Aucun e-mail gérant exposé');
        assert(!payload.includes('compta@alpha.tg'), 'Aucun compte employé exposé');
        assert(!payload.includes('GERANT'), 'Aucune donnée d’application exposée');

        const search = await api(base, 'GET', '/api/v1/public/establishments?q=alpha');
        assertStatus(search, 200, 'Recherche publique');
        assertEqual(search.body.items.length, 1, 'Une seule correspondance pour « alpha »');
        assertEqual(search.body.items[0].slug, 'alpha-grill', 'Slug public attendu');

        const city = await api(base, 'GET', '/api/v1/public/establishments?city=kpalim');
        assertStatus(city, 200, 'Filtre ville sans résultat');
        assertEqual(city.body.items.length, 0, 'Aucune adresse hors Lomé');

        const kind = await api(base, 'GET', '/api/v1/public/establishments?kind=bar');
        assertStatus(kind, 200, 'Filtre par type');
        assert(
          !(kind.body.items as Array<{ id: string }>).some((item) => item.id === alphaTenantId),
          'Alpha (les deux) sans type déclaré exclu du filtre bar',
        );

        const invalidKind = await api(base, 'GET', '/api/v1/public/establishments?kind=club');
        assertStatus(invalidKind, 422, 'Type inconnu refusé');

        const detail = await api(base, 'GET', '/api/v1/public/establishments/alpha-grill');
        assertStatus(detail, 200, 'Détail public par slug');
        assertEqual(detail.body.establishment.id, alphaTenantId, 'Établissement attendu');
        const detailById = await api(base, 'GET', `/api/v1/public/establishments/${alphaTenantId}`);
        assertStatus(detailById, 200, 'Détail public par identifiant');
        assertEqual(detail.body.establishment.slug, 'alpha-grill', 'Slug exposé');

        const suspendedDetail = await api(
          base,
          'GET',
          `/api/v1/public/establishments/${betaTenantId}`,
        );
        assertStatus(suspendedDetail, 404, 'Établissement suspendu invisible');
        const unknown = await api(base, 'GET', '/api/v1/public/establishments/inexistant');
        assertStatus(unknown, 404, 'Établissement inconnu');
      },
    },
  ];

  await runTests(
    'TENANT-SERVICE — demandes, espaces, abonnements et isolation multi-tenant',
    cases,
  );
  await tenantBus.flush();
  await identityBus.flush();
  await tenantServer.close();
  await identityServer.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
