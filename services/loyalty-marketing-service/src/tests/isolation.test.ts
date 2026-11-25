import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createServiceClient,
  runTests,
  startServer,
  type AuthClaims,
  type Route,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildLoyaltyApp, handleLoyaltyEvent } from '../app.js';
import { accountKey, createLoyaltyStore, entriesFor, seedLoyaltyDemo } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const TENANT = 'tnt_sahelgrill';

function claims(sub: string, name: string, tenantPermissions: Record<string, string[]>): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: false,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

async function main() {
  const store = createLoyaltyStore();
  seedLoyaltyDemo(store);
  const bus = createEventBus({ name: 'loyalty-test', internalKey: INTERNAL_KEY, subscribers: [] });

  const orders = new Map<string, Record<string, unknown>>([
    [
      'ord_paid_1',
      { id: 'ord_paid_1', number: 'CMD-2026-000101', tenantId: TENANT, paymentStatus: 'payee', totalXof: 12500 },
    ],
    [
      'ord_paid_big',
      { id: 'ord_paid_big', number: 'CMD-2026-000102', tenantId: TENANT, paymentStatus: 'payee', totalXof: 125000 },
    ],
    [
      'ord_unpaid',
      { id: 'ord_unpaid', number: 'CMD-2026-000103', tenantId: TENANT, paymentStatus: 'impayee', totalXof: 8000 },
    ],
  ]);
  const orderRoutes: Route[] = [
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/orders/:orderId',
      service: true,
      handler: (ctx) => {
        const order = orders.get(ctx.params.orderId ?? '');
        if (!order || order.tenantId !== ctx.params.tenantId) {
          return { status: 404, body: { error: { code: 'order_not_found', message: 'Commande introuvable.' } } };
        }
        return { body: { order } };
      },
    },
  ];
  const orderServer = await startServer(
    {
      name: 'order-stub',
      routes: orderRoutes,
      authenticate: async () => undefined,
      internalKey: INTERNAL_KEY,
    },
    0,
  );

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const clientA = register('token-client-a', claims('usr_client_a', 'Akouvi Mensah', {}));
  const clientB = register('token-client-b', claims('usr_client_b', 'Kossi Adjo', {}));
  const clientC = register('token-client-c', claims('usr_client_c', 'Sena Adjovi', {}));
  const managerA = register(
    'token-manager-a',
    claims('usr_manager_a', 'Manager Sahel', { [TENANT]: ['loyalty:view', 'loyalty:manage'] }),
  );
  const managerB = register(
    'token-manager-b',
    claims('usr_manager_b', 'Manager Baobab', { tnt_baobab: ['loyalty:view', 'loyalty:manage'] }),
  );
  const waiterA = register(
    'token-waiter-a',
    claims('usr_waiter_a', 'Serveur Sahel', { [TENANT]: ['floor:view', 'floor:status'] }),
  );

  const server = await startServer(
    {
      name: 'loyalty-service-test',
      routes: buildLoyaltyApp({
        store,
        order: createServiceClient({ baseUrl: orderServer.url, internalKey: INTERNAL_KEY }),
        publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
      }),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;

  let clientReviewId = '';

  const cases: TestCase[] = [
    {
      name: 'Public : programme de fidélité et avis approuvés uniquement',
      run: async () => {
        const program = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/loyalty`);
        assertStatus(program, 200, 'Programme public');
        assertEqual(program.body.program.pointsPerXof, 500, '1 point / 500 F CFA');
        assertEqual(program.body.program.rewards.length, 3, 'Trois récompenses');
        assertEqual(program.body.program.tiers.length, 4, 'Quatre niveaux');

        const reviews = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/reviews`);
        assertStatus(reviews, 200, 'Avis publics');
        assertEqual(reviews.body.aggregate.count, 3, 'Trois avis approuvés dans la démo');
        assertEqual(reviews.body.aggregate.average, 4.7, 'Moyenne des avis approuvés');
        assertEqual(reviews.body.items.length, 3, 'Avis en attente masqués');
        assert(
          !reviews.body.items.some((review: { status: string }) => review.status !== 'approved'),
          'Aucun avis non modéré exposé',
        );
        const limited = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/reviews?limit=2`);
        assertEqual(limited.body.items.length, 2, 'Limite respectée');
        const otherTenant = await api(base, 'GET', '/api/v1/public/tenants/tnt_baobab/reviews');
        assertEqual(otherTenant.body.aggregate.count, 2, 'Agrégats cloisonnés par établissement');
      },
    },
    {
      name: 'Favoris : ajout idempotent, suppression et isolation entre comptes',
      run: async () => {
        const added = await api(base, 'POST', '/api/v1/me/favorites', { tenantId: TENANT }, { token: clientA });
        assertStatus(added, 201, 'Favori ajouté');
        assertEqual(added.body.alreadySaved, false, 'Nouveau favori');
        const again = await api(base, 'POST', '/api/v1/me/favorites', { tenantId: TENANT }, { token: clientA });
        assertStatus(again, 200, 'Rejeu idempotent');
        assertEqual(again.body.alreadySaved, true, 'Favori déjà présent');
        const mine = await api(base, 'GET', '/api/v1/me/favorites', undefined, { token: clientA });
        assertEqual(mine.body.items.length, 1, 'Un favori pour Akouvi');
        const otherMine = await api(base, 'GET', '/api/v1/me/favorites', undefined, { token: clientB });
        assertEqual(otherMine.body.items.length, 0, 'Aucun favori pour Kossi');
        const removed = await api(base, 'DELETE', `/api/v1/me/favorites/${TENANT}`, undefined, { token: clientB });
        assertEqual(removed.body.removed, false, 'Suppression sans effet pour un autre compte');
        const removedMine = await api(base, 'DELETE', `/api/v1/me/favorites/${TENANT}`, undefined, { token: clientA });
        assertEqual(removedMine.body.removed, true, 'Suppression effective');
        const anonymous = await api(base, 'GET', '/api/v1/me/favorites');
        assertStatus(anonymous, 401, 'Favoris réservés aux utilisateurs connectés');
      },
    },
    {
      name: 'Avis : dépôt en attente, modération cloisonnée et republication',
      run: async () => {
        const created = await api(
          base,
          'POST',
          '/api/v1/me/reviews',
          { tenantId: TENANT, rating: 5, comment: 'Service impeccable et terrasse agréable.' },
          { token: clientA },
        );
        assertStatus(created, 201, 'Avis déposé');
        assertEqual(created.body.review.status, 'pending', 'Modération avant publication');
        clientReviewId = created.body.review.id;
        const publicBefore = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/reviews`);
        assertEqual(publicBefore.body.aggregate.count, 3, 'Avis en attente non publié');

        const staff = await api(base, 'GET', `/api/v1/tenants/${TENANT}/reviews?status=pending`, undefined, {
          token: managerA,
        });
        assertStatus(staff, 200, 'File de modération');
        assert(staff.body.items.some((review: { id: string }) => review.id === clientReviewId), 'Avis visible en salle');
        const cross = await api(base, 'GET', `/api/v1/tenants/${TENANT}/reviews`, undefined, { token: managerB });
        assertStatus(cross, 403, 'Modération Alpha interdite à Beta');
        const forbidden = await api(
          base,
          'POST',
          `/api/v1/tenants/${TENANT}/reviews/${clientReviewId}/moderate`,
          { action: 'approve' },
          { token: waiterA },
        );
        assertStatus(forbidden, 403, 'Modération réservée aux permissions fidélité');

        const approved = await api(
          base,
          'POST',
          `/api/v1/tenants/${TENANT}/reviews/${clientReviewId}/moderate`,
          { action: 'approve', note: 'Merci pour le retour' },
          { token: managerA },
        );
        assertStatus(approved, 200, 'Avis approuvé');
        assertEqual(approved.body.review.status, 'approved', 'Statut publié');
        const publicAfter = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/reviews`);
        assertEqual(publicAfter.body.aggregate.count, 4, 'Avis publié dans l’agrégat');
        assert(
          bus.outbox().some((event) => event.type === 'ReviewModerated' && event.payload.status === 'approved'),
          'Événement ReviewModerated publié',
        );
        const invalidRating = await api(
          base,
          'POST',
          '/api/v1/me/reviews',
          { tenantId: TENANT, rating: 9 },
          { token: clientA },
        );
        assertStatus(invalidRating, 422, 'Note hors barème refusée');
        const updated = await api(
          base,
          'POST',
          '/api/v1/me/reviews',
          { tenantId: TENANT, rating: 4, comment: 'Toujours bien, un peu d’attente.' },
          { token: clientA },
        );
        assertStatus(updated, 200, 'Avis mis à jour');
        assertEqual(updated.body.updated, true, 'Mise à jour détectée');
        assertEqual(updated.body.review.status, 'pending', 'Repasse en modération');
        const own = await api(base, 'GET', '/api/v1/me/reviews', undefined, { token: clientA });
        assertEqual(own.body.items.length, 1, 'Un seul avis par établissement et par client');
      },
    },
    {
      name: 'Fidélité : réclamation de points idempotente, commande non payée et rédemption',
      run: async () => {
        const claim = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/claims',
          { tenantId: TENANT, orderId: 'ord_paid_1' },
          { token: clientB },
        );
        assertStatus(claim, 201, 'Points réclamés');
        assertEqual(claim.body.account.points, 25, '12500 F CFA → 25 points');
        assertEqual(claim.body.account.tier.code, 'bronze', 'Niveau bronze');
        const replay = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/claims',
          { tenantId: TENANT, orderId: 'ord_paid_1' },
          { token: clientB },
        );
        assertStatus(replay, 200, 'Rappel idempotent');
        assertEqual(replay.body.alreadyCredited, true, 'Aucun double crédit');
        assertEqual(replay.body.account.points, 25, 'Solde inchangé');

        const unpaid = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/claims',
          { tenantId: TENANT, orderId: 'ord_unpaid' },
          { token: clientB },
        );
        assertStatus(unpaid, 409, 'Commande impayée refusée');
        const unknown = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/claims',
          { tenantId: TENANT, orderId: 'ord_inexistant' },
          { token: clientB },
        );
        assertStatus(unknown, 404, 'Commande inconnue refusée');

        const bigClaim = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/claims',
          { tenantId: TENANT, orderId: 'ord_paid_big' },
          { token: clientB },
        );
        assertStatus(bigClaim, 201, 'Deuxième commande créditée');
        assertEqual(bigClaim.body.account.points, 275, 'Solde cumulé');
        const redeem = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/redeem',
          { tenantId: TENANT, rewardId: 'rw_dessert' },
          { token: clientB },
        );
        assertStatus(redeem, 201, 'Récompense échangée');
        assertEqual(redeem.body.account.points, 25, 'Points déduits');
        assertEqual(redeem.body.entry.type, 'redeem', 'Historique de dépense');
        const again = await api(
          base,
          'POST',
          '/api/v1/me/loyalty/redeem',
          { tenantId: TENANT, rewardId: 'rw_dessert' },
          { token: clientB },
        );
        assertStatus(again, 422, 'Solde insuffisant');
        assertEqual(again.body.error.code, 'loyalty_insufficient_points', 'Code explicite');

        const crossAccount = await api(base, 'GET', `/api/v1/me/loyalty?tenantId=${TENANT}`, undefined, {
          token: clientA,
        });
        assertEqual(crossAccount.body.account.points, 0, 'Chaque client ne voit que son solde');
        const staffAccounts = await api(base, 'GET', `/api/v1/tenants/${TENANT}/loyalty/accounts`, undefined, {
          token: managerA,
        });
        assertStatus(staffAccounts, 200, 'Comptes fidélité côté salle');
        assert(
          staffAccounts.body.items.some((account: { userId: string }) => account.userId === 'usr_client_b'),
          'Compte de Kossi visible par le manager',
        );
        const crossStaff = await api(base, 'GET', `/api/v1/tenants/${TENANT}/loyalty/accounts`, undefined, {
          token: managerB,
        });
        assertStatus(crossStaff, 403, 'Comptes Sahel invisibles à Baobab');
      },
    },
    {
      name: 'Événement OrderPaid : crédit automatique attribué et dédupliqué',
      run: async () => {
        handleLoyaltyEvent(store, {
          type: 'OrderPaid',
          tenantId: TENANT,
          payload: {
            tenantId: TENANT,
            customerUserId: 'usr_client_c',
            orderId: 'ord_evt_1',
            number: 'CMD-2026-000200',
            totalXof: 6000,
          },
        });
        const account = store.accounts.get(accountKey('usr_client_c', TENANT));
        assert(account, 'Compte créé par événement');
        assertEqual(account!.points, 12, '6000 F CFA → 12 points');
        handleLoyaltyEvent(store, {
          type: 'OrderPaid',
          tenantId: TENANT,
          payload: {
            tenantId: TENANT,
            customerUserId: 'usr_client_c',
            orderId: 'ord_evt_1',
            number: 'CMD-2026-000200',
            totalXof: 6000,
          },
        });
        assertEqual(account!.points, 12, 'Rejeu d’événement sans double crédit');
        assertEqual(entriesFor(store, 'usr_client_c', TENANT).length, 1, 'Une seule écriture');
        handleLoyaltyEvent(store, {
          type: 'OrderPaid',
          tenantId: TENANT,
          payload: { tenantId: TENANT, orderId: 'ord_anonyme', totalXof: 6000 },
        });
        assertEqual(entriesFor(store, 'usr_client_c', TENANT).length, 1, 'Commande anonyme ignorée');
      },
    },
    {
      name: 'Promotions et codes : période, minimum, doublons et cloisonnement',
      run: async () => {
        const iso = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

        const publicPromos = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/promotions`);
        assertStatus(publicPromos, 200, 'Promotions publiques');
        assertEqual(publicPromos.body.items.length, 2, 'Deux promotions actives seedées');
        assert(publicPromos.body.items.every((entry: { status: string }) => entry.status === 'active'), 'Seules les actives exposées');

        const list = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/promotions`, undefined, { token: managerA });
        assertStatus(list, 200, 'Promotions gérant');
        assertEqual(list.body.counts.active, 2, 'Deux actives');

        const invalid = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/promotions`, {
          name: 'Remise folle',
          type: 'percent',
          value: 150,
          startAt: iso(-1),
          endAt: iso(10),
        }, { token: managerA });
        assertStatus(invalid, 422, 'Pourcentage > 100 refusé');

        const created = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/promotions`, {
          name: 'Brunch du dimanche',
          description: '−20 % sur les formules brunch.',
          type: 'percent',
          value: 20,
          minOrderXof: 5000,
          startAt: iso(-1),
          endAt: iso(30),
        }, { token: managerA });
        assertStatus(created, 201, 'Promotion créée');
        assertEqual(created.body.promotion.status, 'active', 'Statut actif calculé');
        const promoId = created.body.promotion.id as string;

        const cross = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/promotions`, {
          name: 'Intrusion',
          type: 'amount',
          value: 1000,
          startAt: iso(0),
          endAt: iso(5),
        }, { token: managerB });
        assertStatus(cross, 403, 'Création croisée refusée');

        const disabled = await api(base, 'PATCH', `/api/v1/tenants/${TENANT}/marketing/promotions/${promoId}`, {
          active: false,
        }, { token: managerA });
        assertStatus(disabled, 200, 'Promotion désactivée');
        assertEqual(disabled.body.promotion.status, 'desactivee', 'Statut désactivée');
        const publicAfter = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/promotions`);
        assertEqual(publicAfter.body.items.length, 2, 'Promotion désactivée retirée du public');

        const duplicate = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/promo-codes`, {
          code: 'bienvenue10',
          type: 'percent',
          value: 5,
          startAt: iso(0),
          endAt: iso(5),
        }, { token: managerA });
        assertStatus(duplicate, 409, 'Code en doublon refusé');

        const testCode = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/promo-codes`, {
          code: 'TEST1',
          type: 'percent',
          value: 20,
          minOrderXof: 1000,
          maxUses: 1,
          perUserLimit: 5,
          startAt: iso(-1),
          endAt: iso(10),
        }, { token: managerA });
        assertStatus(testCode, 201, 'Code TEST1 créé');
        assertEqual(testCode.body.promoCode.code, 'TEST1', 'Code normalisé');

        const belowMin = await api(base, 'POST', `/api/v1/public/tenants/${TENANT}/promo-codes/BIENVENUE10/validate`, {
          orderTotalXof: 2500,
        });
        assertStatus(belowMin, 200, 'Validation publique');
        assertEqual(belowMin.body.valid, false, 'Montant minimum bloquant');
        assertEqual(belowMin.body.reason, 'promo_code_min_order', 'Motif explicite');
        const validCode = await api(base, 'POST', `/api/v1/public/tenants/${TENANT}/promo-codes/BIENVENUE10/validate`, {
          orderTotalXof: 5000,
        });
        assertEqual(validCode.body.valid, true, 'Code valide');
        assertEqual(validCode.body.discountXof, 500, '10 % de 5 000 F CFA');
        const unknownCode = await api(base, 'POST', `/api/v1/public/tenants/${TENANT}/promo-codes/INCONNU/validate`, {
          orderTotalXof: 5000,
        });
        assertEqual(unknownCode.body.valid, false, 'Code inconnu rejeté');

        const redeemed = await api(base, 'POST', '/api/v1/me/promo-codes/redeem', {
          tenantId: TENANT,
          code: 'BIENVENUE10',
          orderId: 'ord_paid_1',
        }, { token: clientB });
        assertStatus(redeemed, 201, 'Code appliqué à la commande');
        assertEqual(redeemed.body.redemption.discountXof, 1250, '10 % de 12 500 F CFA');
        const replay = await api(base, 'POST', '/api/v1/me/promo-codes/redeem', {
          tenantId: TENANT,
          code: 'BIENVENUE10',
          orderId: 'ord_paid_1',
        }, { token: clientB });
        assertStatus(replay, 200, 'Rejeu idempotent');
        assertEqual(replay.body.alreadyRedeemed, true, 'Aucun double décompte');
        const overLimit = await api(base, 'POST', '/api/v1/me/promo-codes/redeem', {
          tenantId: TENANT,
          code: 'BIENVENUE10',
          orderId: 'ord_paid_big',
        }, { token: clientB });
        assertStatus(overLimit, 422, 'Limite par client appliquée');
        assertEqual(overLimit.body.error.code, 'promo_code_user_limit', 'Code limite client');

        const firstUse = await api(base, 'POST', '/api/v1/me/promo-codes/redeem', {
          tenantId: TENANT,
          code: 'TEST1',
          orderId: 'ord_paid_1',
        }, { token: clientA });
        assertStatus(firstUse, 201, 'Première utilisation TEST1');
        assertEqual(firstUse.body.redemption.discountXof, 2500, '20 % de 12 500 F CFA');
        const exhausted = await api(base, 'POST', '/api/v1/me/promo-codes/redeem', {
          tenantId: TENANT,
          code: 'TEST1',
          orderId: 'ord_paid_1',
        }, { token: clientC });
        assertStatus(exhausted, 422, 'Quota global épuisé');
        assertEqual(exhausted.body.error.code, 'promo_code_exhausted', 'Code quota épuisé');

        const codes = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/promo-codes`, undefined, { token: managerA });
        assertStatus(codes, 200, 'Codes gérant');
        const test = codes.body.items.find((entry: { code: string }) => entry.code === 'TEST1');
        assertEqual(test.remainingUses, 0, 'Quota consommé exposé');
        assert(codes.body.totals.redemptions >= 3, 'Historique des utilisations');
        assert(codes.body.totals.discountXof >= 3750, 'Remise cumulée valorisée');
        assert(bus.outbox().some((event) => event.type === 'PromoCodeRedeemed'), 'PromoCodeRedeemed publié');
      },
    },
    {
      name: 'Campagnes : audience par segment, envoi compté, annulation et cloisonnement',
      run: async () => {
        const list = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/campaigns`, undefined, { token: managerA });
        assertStatus(list, 200, 'Campagnes gérant');
        assertEqual(list.body.channels.length, 3, 'SMS, e-mail et push');
        assert(list.body.audience.all > 0, 'Audience globale calculée');

        const invalid = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns`, {
          name: 'Canal invalide',
          channel: 'fax',
          segment: 'all',
          message: 'Test',
        }, { token: managerA });
        assertStatus(invalid, 422, 'Canal inconnu refusé');

        const created = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns`, {
          name: 'Soirée jazz',
          channel: 'email',
          segment: 'all',
          message: 'Soirée jazz vendredi dès 20h, entrée libre.',
        }, { token: managerA });
        assertStatus(created, 201, 'Campagne créée');
        assertEqual(created.body.campaign.status, 'brouillon', 'Brouillon sans planification');
        const campaignId = created.body.campaign.id as string;

        const beforeSend = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/campaigns`, undefined, { token: managerA });
        const sent = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns/${campaignId}/send`, {}, { token: managerA });
        assertStatus(sent, 200, 'Campagne envoyée');
        assertEqual(sent.body.campaign.status, 'envoyee', 'Statut envoyée');
        assertEqual(sent.body.campaign.recipients, beforeSend.body.audience.all, 'Destinataires comptés');
        assert(sent.body.campaign.sentAt !== null, 'Horodatage de l’envoi');
        assert(bus.outbox().some((event) => event.type === 'CampaignSent'), 'CampaignSent publié');
        const twice = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns/${campaignId}/send`, {}, { token: managerA });
        assertStatus(twice, 409, 'Double envoi refusé');

        const scheduled = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns`, {
          name: 'Rappel week-end',
          channel: 'push',
          segment: 'argent',
          message: 'Vos points doublent ce week-end.',
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        }, { token: managerA });
        assertStatus(scheduled, 201, 'Campagne planifiée');
        assertEqual(scheduled.body.campaign.status, 'planifiee', 'Statut planifiée');
        const cancelled = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns/${scheduled.body.campaign.id}/cancel`, {}, { token: managerA });
        assertStatus(cancelled, 200, 'Campagne annulée');
        assertEqual(cancelled.body.campaign.status, 'annulee', 'Statut annulée');
        const sendCancelled = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns/${scheduled.body.campaign.id}/send`, {}, { token: managerA });
        assertStatus(sendCancelled, 409, 'Envoi d’une campagne annulée refusé');

        const cross = await api(base, 'POST', `/api/v1/tenants/${TENANT}/marketing/campaigns/${campaignId}/send`, {}, { token: managerB });
        assertStatus(cross, 403, 'Envoi croisé refusé');
      },
    },
    {
      name: 'Avis : réponse du gérant, remplacement et isolation',
      run: async () => {
        const replied = await api(base, 'POST', `/api/v1/tenants/${TENANT}/reviews/rev_demo_2/reply`, {
          message: 'Merci Kossi, nos tarifs week-end incluent le service live.',
        }, { token: managerA });
        assertStatus(replied, 200, 'Réponse publiée');
        assertEqual(replied.body.review.reply.by, 'usr_manager_a', 'Auteur tracé');
        assertEqual(replied.body.review.reply.byName, 'Manager Sahel', 'Nom affiché');
        assert(replied.body.aggregate.replied >= 2, 'Taux de réponse mis à jour');

        const replaced = await api(base, 'POST', `/api/v1/tenants/${TENANT}/reviews/rev_demo_2/reply`, {
          message: 'Merci Kossi ! Le service live est offert chaque samedi.',
        }, { token: managerA });
        assertStatus(replaced, 200, 'Réponse remplacée');
        assert(replaced.body.review.reply.message.includes('samedi'), 'Nouveau message conservé');

        const pub = await api(base, 'GET', `/api/v1/public/tenants/${TENANT}/reviews`);
        const withReply = pub.body.items.find((review: { id: string }) => review.id === 'rev_demo_2');
        assert(withReply.reply !== null, 'Réponse exposée publiquement');

        const forbidden = await api(base, 'POST', `/api/v1/tenants/${TENANT}/reviews/rev_demo_2/reply`, {
          message: 'Test',
        }, { token: waiterA });
        assertStatus(forbidden, 403, 'Réponse réservée à loyalty:manage');

        const cross = await api(base, 'POST', '/api/v1/tenants/tnt_baobab/reviews/rev_demo_2/reply', {
          message: 'Intrusion',
        }, { token: managerB });
        assertStatus(cross, 404, 'Avis d’un autre établissement introuvable');
        assert(bus.outbox().some((event) => event.type === 'ReviewReplied'), 'ReviewReplied publié');
      },
    },
    {
      name: 'Programme et tableau de bord marketing : indicateurs et RBAC',
      run: async () => {
        const program = await api(base, 'GET', `/api/v1/tenants/${TENANT}/loyalty/program`, undefined, { token: managerA });
        assertStatus(program, 200, 'Programme gérant');
        assertEqual(program.body.program.tiers.length, 4, 'Quatre niveaux');
        assert(program.body.stats.members > 0, 'Membres comptés');
        assert(program.body.stats.pointsOutstanding >= 0, 'Points en circulation');

        const dashboard = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/dashboard`, undefined, { token: managerA });
        assertStatus(dashboard, 200, 'Tableau de bord marketing');
        const tierSum = Object.values(dashboard.body.tiers as Record<string, number>).reduce((sum, value) => sum + value, 0);
        assertEqual(tierSum, dashboard.body.members, 'Répartition par niveau cohérente');
        assert(dashboard.body.promoCodes.redemptions >= 3, 'Utilisations de codes comptées');
        assert(dashboard.body.promoCodes.discountXof > 0, 'Remises valorisées');
        assert(dashboard.body.campaigns.envoyees >= 2, 'Campagnes envoyées comptées');
        assert(dashboard.body.reviews.pending >= 1, 'Avis en attente signalés');

        const denied = await api(base, 'GET', `/api/v1/tenants/${TENANT}/marketing/dashboard`, undefined, { token: waiterA });
        assertStatus(denied, 403, 'Tableau de bord réservé à loyalty:view');
        const cross = await api(base, 'GET', `/api/v1/tenants/${TENANT}/loyalty/program`, undefined, { token: managerB });
        assertStatus(cross, 403, 'Programme cloisonné');

        const audit = await api(base, 'GET', `/api/v1/tenants/${TENANT}/loyalty/audit`, undefined, { token: managerA });
        assertStatus(audit, 200, 'Journal marketing');
        assertEqual(audit.body.integrity, true, 'Chaîne intacte');
        const actions = audit.body.entries.map((entry: { action: string }) => entry.action);
        for (const expected of [
          'marketing.promotion.created',
          'marketing.promo_code.redeemed',
          'marketing.campaign.sent',
          'loyalty.review.replied',
        ]) {
          assert(actions.includes(expected), `Action auditée : ${expected}`);
        }
        assert(audit.body.entries.every((entry: { tenantId: string }) => entry.tenantId === TENANT), 'Filtré par tenant');
      },
    },
  ];

  await runTests('LOYALTY-MARKETING-SERVICE — fidélité, avis, promotions et campagnes', cases);
  await server.close();
  await orderServer.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
