import { createHmac } from 'node:crypto';
import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createEventInboxRoute,
  runTests,
  startServer,
  type ApiResult,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildPaymentApp, handlePaymentEvent } from '../app.js';
import { PROVIDERS } from '../providers.js';
import { createPaymentStore, type PaymentStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const TENANT = 'tnt_alpha';
const TENANT_B = 'tnt_beta';
const WEBHOOK_SECRET = 'whsec_sandbox';

function claims(sub: string, tenantPermissions: Record<string, string[]>, platform = false): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name: sub,
    mfa: false,
    platformRoles: platform ? ['super_admin'] : [],
    platformPermissions: platform
      ? ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']
      : [],
    tenantPermissions,
  };
}

interface FakeOrder {
  id: string;
  number: string;
  tenantId: string;
  status: string;
  totalXof: number;
  paidXof: number;
  paymentStatus: string;
  invoiceNumber: string | null;
}

async function main() {
  const store = createPaymentStore();
  const bus = createEventBus({ name: 'payment-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const events: Array<{ type: string; tenantId: string | null; payload: Record<string, unknown> }> = [];
  bus.on('OrderPaid', (envelope) => {
    handlePaymentEvent(store, envelope.tenantId ?? String(envelope.payload.tenantId ?? ''), envelope);
  });
  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };

  const ALL = ['payment:view', 'payment:refund', 'payment:manage', 'report:export', 'audit:view'];
  const managerA = register('token-manager-a', claims('usr_manager_a', { [TENANT]: ALL }));
  const cashierA = register('token-cashier-a', claims('usr_cashier_a', { [TENANT]: ['payment:view'] }));
  const managerB = register('token-manager-b', claims('usr_manager_b', { [TENANT_B]: ALL }));
  const platformAdmin = register('token-platform', claims('usr_platform', {}, true));
  const actor = (n: number) => register(`token-actor-${n}`, claims(`usr_actor_${n}`, { [TENANT]: ALL }));

  const orders = new Map<string, FakeOrder>([
    ['ord_1', { id: 'ord_1', number: 'CMD-TEST-0001', tenantId: TENANT, status: 'recue', totalXof: 12_500, paidXof: 0, paymentStatus: 'impayee', invoiceNumber: null }],
    ['ord_2', { id: 'ord_2', number: 'CMD-TEST-0002', tenantId: TENANT, status: 'recue', totalXof: 8_000, paidXof: 0, paymentStatus: 'impayee', invoiceNumber: null }],
    ['ord_3', { id: 'ord_3', number: 'CMD-TEST-0003', tenantId: TENANT, status: 'recue', totalXof: 6_000, paidXof: 0, paymentStatus: 'impayee', invoiceNumber: null }],
    ['ord_paid', { id: 'ord_paid', number: 'CMD-TEST-0004', tenantId: TENANT, status: 'servie', totalXof: 5_000, paidXof: 5_000, paymentStatus: 'payee', invoiceNumber: 'FA-TEST-0000' }],
  ]);
  const seenReferences = new Set<string>();
  let invoiceSeq = 100;

  const deps = {
    tenant: {
      get: async <T>(): Promise<T> =>
        ({ plan: 'pro', brandName: 'Sahel Grill', id: TENANT }) as T,
    },
    order: {
      get: async <T>(path: string): Promise<T> => {
        const orderId = decodeURIComponent(path.split('/').pop() ?? '');
        const order = orders.get(orderId);
        if (!order) throw new Error('Commande introuvable.');
        return { order } as T;
      },
      post: async <T>(path: string, body?: unknown): Promise<T> => {
        const orderId = decodeURIComponent(path.split('/').slice(-2)[0] ?? '');
        const order = orders.get(orderId);
        if (!order) throw new Error('Commande introuvable.');
        const payload = (body ?? {}) as { reference?: string; amountXof?: number };
        const reference = payload.reference ?? '';
        if (seenReferences.has(reference)) {
          return { order, replayed: true } as T;
        }
        const amount = payload.amountXof ?? 0;
        order.paidXof += amount;
        order.paymentStatus = order.paidXof >= order.totalXof ? 'payee' : 'partielle';
        if (order.paymentStatus === 'payee' && !order.invoiceNumber) {
          invoiceSeq += 1;
          order.invoiceNumber = `FA-TEST-${String(invoiceSeq).padStart(4, '0')}`;
        }
        seenReferences.add(reference);
        return {
          orders: undefined,
          order,
          replayed: false,
          invoiceIssued: Boolean(order.invoiceNumber),
        } as T;
      },
    },
  };

  const server = await startServer(
    {
      name: 'payment-service-test',
      routes: [
        ...buildPaymentApp({
          store,
          sandbox: true,
          providerKeys: {},
          webhookSecrets: Object.fromEntries(PROVIDERS.map((provider) => [provider.id, WEBHOOK_SECRET])),
          deps,
          publish: async (type, tenantId, payload) => {
            events.push({ type, tenantId, payload });
          },
        }),
        createEventInboxRoute(bus),
      ],
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const A = `/api/v1/tenants/${TENANT}/payments`;
  const B = `/api/v1/tenants/${TENANT_B}/payments`;
  const P = '/api/v1/platform/payments';

  const createIntent = (token: string, body: Record<string, unknown>) =>
    api<Record<string, any>>(base, 'POST', `${A}/transactions`, body, { token });
  const sandbox = (token: string, id: string, outcome: string) =>
    api<Record<string, any>>(base, 'POST', `${A}/transactions/${id}/sandbox`, { outcome }, { token });
  const webhookSignature = (timestamp: string, eventId: string, type: string, reference: string, amount?: number) =>
    `sha256=${createHmac('sha256', WEBHOOK_SECRET)
      .update(`${timestamp}.${eventId}.${type}.${reference}.${amount ?? ''}`)
      .digest('hex')}`;
  const sendWebhook = (provider: string, body: Record<string, unknown>, overrideSignature?: string) => {
    const timestamp = String(Date.now());
    const signature = overrideSignature ?? webhookSignature(
      timestamp,
      String(body.eventId),
      String(body.type),
      String(body.reference),
      body.amountXof as number | undefined,
    );
    return api(base, 'POST', `/api/v1/webhooks/providers/${provider}`, body, {
      headers: { 'x-restohub-timestamp': timestamp, 'x-restohub-signature': signature },
    });
  };

  const confirmed: Array<{ id: string; amountXof: number }> = [];

  const tests: TestCase[] = [
    {
      name: 'Isolation : un gérant ne voit ni ne mesure les paiements d’un autre établissement',
      run: async () => {
        assertStatus(await api(base, 'GET', B + '/overview', undefined, { token: managerA }), 403, 'overview Beta par A');
        assertStatus(await api(base, 'GET', B + '/transactions', undefined, { token: managerA }), 403, 'liste Beta par A');
        assertStatus(await api(base, 'GET', B + '/transactions', undefined, { token: managerB }), 200, 'liste Beta par B');
        assertStatus(await api(base, 'GET', `${P}/summary`, undefined, { token: managerA }), 403, 'supervision par gérant');
        const summary = await api<Record<string, any>>(base, 'GET', `${P}/summary`, undefined, { token: platformAdmin });
        assertStatus(summary, 200, 'supervision par admin');
        assertEqual(summary.body.tenantsWithWallet, 0, 'aucun portefeuille au départ');
      },
    },
    {
      name: 'Intention : routage au meilleur coût, frais et commission ventilés, portefeuille intact',
      run: async () => {
        const response = await createIntent(managerA, { orderId: 'ord_1', method: 'mobile_money', provider: 'tmoney' });
        assertStatus(response, 201, 'création intention');
        const transaction = response.body.transaction;
        assertEqual(transaction.status, 'en_attente', 'statut initial');
        assertEqual(transaction.provider, 'tmoney', 'fournisseur préféré');
        assertEqual(transaction.routing.switched, false, 'pas de bascule');
        assertEqual(transaction.amountXof, 12_500, 'montant de la commande');
        assertEqual(transaction.fees.providerFeeXof, 188, 'frais T-Money 1,5 %');
        assertEqual(transaction.fees.commissionPercent, 1.8, 'commission plan Pro');
        assertEqual(transaction.fees.commissionXof, 225, 'commission 1,8 %');
        assertEqual(transaction.fees.netXof, 12_087, 'net établissement');
        assertEqual(response.body.wallet.availableXof, 0, 'portefeuille non crédité avant confirmation');
        assert(transaction.providerReference.startsWith('TMN_'), 'référence fournisseur sandbox');
      },
    },
    {
      name: 'Routage : bascule automatique quand le fournisseur préféré est indisponible',
      run: async () => {
        assertStatus(
          await api(base, 'POST', `${A}/providers/tmoney/health`, { status: 'down' }, { token: managerA }),
          200,
          'mise hors service T-Money',
        );
        const response = await createIntent(managerA, { orderId: 'ord_1', method: 'mobile_money', provider: 'tmoney' });
        assertStatus(response, 201, 'intention avec bascule');
        const transaction = response.body.transaction;
        assertEqual(transaction.provider, 'moov_money', 'bascule vers Moov Money');
        assertEqual(transaction.routing.switched, true, 'bascule signalée');
        assert(transaction.routing.reason.includes('bascule'), 'motif de bascule');
        assertStatus(
          await api(base, 'POST', `${A}/providers/tmoney/health`, { status: 'up' }, { token: managerA }),
          200,
          'retour en service',
        );
      },
    },
    {
      name: 'Cycle : confirmation, facture commande, portefeuille et grand livre équilibré',
      run: async () => {
        const created = await createIntent(managerA, { orderId: 'ord_1', method: 'mobile_money', provider: 'tmoney' });
        assertStatus(created, 201, 'intention');
        const id = created.body.transaction.id;
        const confirmedResponse = await sandbox(managerA, id, 'confirme');
        assertStatus(confirmedResponse, 200, 'confirmation sandbox');
        const transaction = confirmedResponse.body.transaction;
        assertEqual(transaction.status, 'confirmee', 'statut confirmé');
        assert(Boolean(transaction.invoiceNumber), 'facture émise par order-service');
        assertEqual(confirmedResponse.body.orderSynced, true, 'synchronisation commande');
        const wallet = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        assertEqual(wallet.body.wallet.availableXof, 12_087, 'net crédité au portefeuille');
        const ledger = await api<Record<string, any>>(base, 'GET', `${A}/ledger`, undefined, { token: managerA });
        assertEqual(ledger.body.integrity.ok, true, 'chaîne comptable intègre');
        assert(
          ledger.body.entries.some((entry: Record<string, any>) =>
            entry.lines.some((line: Record<string, any>) => line.account === 'platform_commission'),
          ),
          'écriture de commission présente',
        );
        assert(events.some((event) => event.type === 'PaymentConfirmed'), 'PaymentConfirmed publié');
        const order = await api(base, 'GET', `${A}/transactions/${id}`, undefined, { token: managerA });
        assertEqual(order.body.transaction.orderNumber, 'CMD-TEST-0001', 'numéro de commande synchronisé');
        confirmed.push({ id, amountXof: 12_500 });
      },
    },
    {
      name: 'Webhook signé et idempotent : signature invalide refusée, rejeu sans double écriture',
      run: async () => {
        const created = await createIntent(managerA, { orderId: 'ord_2', method: 'mobile_money', provider: 'cinetpay' });
        assertStatus(created, 201, 'intention CinetPay');
        const transaction = created.body.transaction;
        const before = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        const body = {
          eventId: `evt_${Date.now()}`,
          type: 'payment.confirmed',
          reference: transaction.providerReference,
          amountXof: 8_000,
        };
        const forged = await sendWebhook('cinetpay', body, 'sha256=deadbeef');
        assertStatus(forged, 401, 'signature invalide');
        const ok = await sendWebhook('cinetpay', body);
        assertStatus(ok, 200, 'webhook valide');
        assertEqual(ok.body.transaction.status, 'confirmee', 'transaction confirmée par webhook');
        const after = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        assertEqual(after.body.wallet.availableXof - before.body.wallet.availableXof, 7_656, 'net CinetPay crédité');
        const replay = await sendWebhook('cinetpay', body);
        assertStatus(replay, 200, 'rejeu accepté');
        assertEqual(replay.body.replayed, true, 'rejeu détecté');
        const afterReplay = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        assertEqual(afterReplay.body.wallet.availableXof, after.body.wallet.availableXof, 'aucune double écriture');
        const unknown = await sendWebhook('tmoney', {
          eventId: `evt_unknown_${Date.now()}`,
          type: 'payment.confirmed',
          reference: 'TMN_INCONNU',
          amountXof: 1_000,
        });
        assertStatus(unknown, 202, 'référence inconnue acceptée sans traitement');
        assertEqual(unknown.body.accepted, false, 'référence inconnue signalée');
        confirmed.push({ id: transaction.id, amountXof: 8_000 });
      },
    },
    {
      name: 'Échec, expiration et annulation : statuts et événements',
      run: async () => {
        const failed = await createIntent(actor(10), { orderId: 'ord_2', method: 'mobile_money', provider: 'moov_money' });
        assertStatus(failed, 201, 'intention échec');
        const failedTx = await sandbox(actor(10), failed.body.transaction.id, 'echoue');
        assertEqual(failedTx.body.transaction.status, 'echouee', 'statut échec');
        assert(events.some((event) => event.type === 'PaymentFailed'), 'PaymentFailed publié');
        const expired = await createIntent(actor(11), { method: 'mobile_money', amountXof: 1_500 });
        assertStatus(expired, 201, 'intention expiration');
        const expiredTx = await sandbox(actor(11), expired.body.transaction.id, 'expire');
        assertEqual(expiredTx.body.transaction.status, 'expiree', 'statut expiration');
        const cancelled = await createIntent(actor(12), { method: 'mobile_money', amountXof: 1_200 });
        assertStatus(cancelled, 201, 'intention annulation');
        const cancelResponse = await api(base, 'POST', `${A}/transactions/${cancelled.body.transaction.id}/cancel`, undefined, { token: actor(12) });
        assertStatus(cancelResponse, 200, 'annulation');
        assertEqual(cancelResponse.body.transaction.status, 'annulee', 'statut annulé');
        assert(events.some((event) => event.type === 'PaymentCancelled'), 'PaymentCancelled publié');
      },
    },
    {
      name: 'Remboursement partiel puis total : écritures inversées, plafond respecté',
      run: async () => {
        const target = confirmed[0];
        const partial = await api<Record<string, any>>(base, 'POST', `${A}/transactions/${target.id}/refund`, {
          amountXof: 2_000,
          reason: 'Client mécontent',
        }, { token: managerA });
        assertStatus(partial, 201, 'remboursement partiel');
        assertEqual(partial.body.transaction.status, 'remboursee_partielle', 'statut partiel');
        assertEqual(partial.body.transaction.refundedXof, 2_000, 'montant remboursé');
        assertEqual(partial.body.wallet.availableXof, 17_809, 'net repris proportionnellement');
        const excessive = await api(base, 'POST', `${A}/transactions/${target.id}/refund`, {
          amountXof: 20_000,
          reason: 'Trop',
        }, { token: managerA });
        assertStatus(excessive, 422, 'remboursement au-delà du restant');
        const rest = await api(base, 'POST', `${A}/transactions/${target.id}/refund`, {
          reason: 'Solde remboursé',
        }, { token: managerA });
        assertStatus(rest, 201, 'remboursement du solde');
        assertEqual(rest.body.transaction.status, 'remboursee', 'statut total');
        const ledger = await api<Record<string, any>>(base, 'GET', `${A}/ledger`, undefined, { token: managerA });
        assertEqual(ledger.body.integrity.ok, true, 'grand livre toujours équilibré');
        assert(events.some((event) => event.type === 'RefundIssued'), 'RefundIssued publié');
        const pending = await createIntent(actor(13), { method: 'mobile_money', amountXof: 1_000 });
        const refused = await api(base, 'POST', `${A}/transactions/${pending.body.transaction.id}/refund`, {
          reason: 'Pas confirmée',
        }, { token: managerA });
        assertStatus(refused, 409, 'remboursement d’une transaction en attente refusé');
      },
    },
    {
      name: 'Paiement fractionné : parts confirmées, commande soldée, SplitCompleted publié',
      run: async () => {
        const split = await api<Record<string, any>>(base, 'POST', `${A}/splits`, {
          orderId: 'ord_3',
          parts: [
            { label: 'Awa', amountXof: 3_000, method: 'mobile_money', provider: 'tmoney' },
            { label: 'Koffi', amountXof: 3_000, method: 'mobile_money', provider: 'moov_money' },
          ],
        }, { token: actor(14) });
        assertStatus(split, 201, 'création du partage');
        assertEqual(split.body.split.parts.length, 2, 'deux convives');
        for (const part of split.body.split.parts) {
          const result = await sandbox(actor(14), part.transactionId, 'confirme');
          assertStatus(result, 200, 'confirmation d’une part');
        }
        const snapshot = await api<Record<string, any>>(base, 'GET', `${A}/splits/${split.body.split.id}`, undefined, { token: actor(14) });
        assertEqual(snapshot.body.split.status, 'confirmee', 'partage soldé');
        assert(events.some((event) => event.type === 'SplitCompleted'), 'SplitCompleted publié');
        const mismatch = await api(base, 'POST', `${A}/splits`, {
          orderId: 'ord_3',
          parts: [
            { amountXof: 2_000, method: 'mobile_money' },
            { amountXof: 2_000, method: 'mobile_money' },
          ],
        }, { token: actor(15) });
        assertStatus(mismatch, 422, 'somme des parts incohérente');
      },
    },
    {
      name: 'Pourboires répartis entre employés et événement TipDistributed',
      run: async () => {
        const created = await createIntent(actor(16), {
          method: 'mobile_money',
          amountXof: 4_000,
          tipXof: 501,
          tipStaffIds: ['stf_1', 'stf_2'],
        });
        assertStatus(created, 201, 'intention avec pourboire');
        const allocations = created.body.transaction.tipAllocations;
        assertEqual(allocations.length, 2, 'deux employés');
        assertEqual(allocations[0].amountXof + allocations[1].amountXof, 501, 'pourboire intégralement réparti');
        assert(allocations[0].amountXof - allocations[1].amountXof <= 1, 'répartition équitable');
        await sandbox(actor(16), created.body.transaction.id, 'confirme');
        const tipEvent = events.find((event) => event.type === 'TipDistributed');
        assert(tipEvent, 'TipDistributed publié');
        assertEqual((tipEvent?.payload.allocations as unknown[]).length, 2, 'allocations transmises');
      },
    },
    {
      name: 'Carte bancaire : 3-D Secure exigé puis confirmé',
      run: async () => {
        const created = await createIntent(actor(17), { method: 'carte', amountXof: 4_000, provider: 'cinetpay' });
        assertStatus(created, 201, 'intention carte');
        assertEqual(created.body.transaction.requires3ds, true, '3-D Secure exigé');
        assert(String(created.body.transaction.threeDsUrl).includes('sandbox'), 'URL 3DS sandbox');
        const done = await api<Record<string, any>>(base, 'POST', `${A}/transactions/${created.body.transaction.id}/confirm-3ds`, undefined, { token: actor(17) });
        assertStatus(done, 200, 'confirmation 3DS');
        assertEqual(done.body.transaction.status, 'confirmee', 'transaction confirmée');
      },
    },
    {
      name: 'Reversements : lot soumis à approbation plateforme, instantané immédiat, solde contrôlé',
      run: async () => {
        const before = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        const available = before.body.wallet.availableXof as number;
        assert(available > 6_000, 'solde suffisant pour le test');
        const batch = await api<Record<string, any>>(base, 'POST', `${A}/settlements`, {
          amountXof: 5_000,
          mode: 'batch',
          destination: 'Compte bancaire principal',
        }, { token: managerA });
        assertStatus(batch, 201, 'demande de lot');
        assertEqual(batch.body.settlement.status, 'en_attente', 'lot en attente');
        assertEqual(batch.body.wallet.availableXof, available, 'solde inchangé avant approbation');
        const approve = await api<Record<string, any>>(base, 'POST', `${P}/settlements/${batch.body.settlement.id}/approve`, { note: 'Lot validé' }, { token: platformAdmin });
        assertStatus(approve, 200, 'approbation plateforme');
        assertEqual(approve.body.settlement.status, 'payee', 'lot payé');
        assert(events.some((event) => event.type === 'SettlementPaid'), 'SettlementPaid publié');
        const instant = await api<Record<string, any>>(base, 'POST', `${A}/settlements`, {
          amountXof: 1_000,
          mode: 'instant',
          destination: 'TMoney 90 11 22 33',
        }, { token: managerA });
        assertStatus(instant, 201, 'reversement instantané');
        assertEqual(instant.body.settlement.status, 'payee', 'instantané payé');
        const excessive = await api(base, 'POST', `${A}/settlements`, {
          amountXof: 9_000_000,
          mode: 'instant',
          destination: 'TMoney 90 11 22 33',
        }, { token: managerA });
        assertStatus(excessive, 422, 'reversement supérieur au solde refusé');
      },
    },
    {
      name: 'Réconciliation : relevé cohérent puis écarts détectés (manquant, montant, orphelin)',
      run: async () => {
        const date = new Date().toISOString().slice(0, 10);
        const clean = await api<Record<string, any>>(base, 'POST', `${A}/reconciliation/run`, { date }, { token: managerA });
        assertStatus(clean, 201, 'réconciliation nominale');
        assertEqual(clean.body.run.balanced, true, 'relevé cohérent');
        assert(clean.body.run.matched > 0, 'transactions rapprochées');
        const anomalies = await api<Record<string, any>>(base, 'POST', `${A}/reconciliation/run`, { date, injectAnomalies: true }, { token: managerA });
        assertStatus(anomalies, 201, 'réconciliation avec anomalies');
        assertEqual(anomalies.body.run.balanced, false, 'écarts détectés');
        assert(anomalies.body.run.missingInStatement.length >= 1, 'ligne manquante');
        assert(anomalies.body.run.amountMismatches.length >= 1, 'écart de montant');
        assert(anomalies.body.run.orphanRows.length >= 1, 'ligne orpheline');
        assert(events.some((event) => event.type === 'ReconciliationCompleted'), 'ReconciliationCompleted publié');
        const audit = await api<Record<string, any>>(base, 'GET', `${A}/audit`, undefined, { token: managerA });
        assertStatus(audit, 200, 'journal d’audit');
        assertEqual(audit.body.integrity, true, 'chaîne d’audit intègre');
      },
    },
    {
      name: 'Anti-fraude : plafond de montant, blocage temporaire et levée par le gérant',
      run: async () => {
        const blocked = await createIntent(actor(18), { method: 'mobile_money', amountXof: 600_000 });
        assertStatus(blocked, 429, 'montant au-delà du plafond');
        assertEqual(blocked.body.error.code, 'fraud_blocked', 'code anti-fraude');
        const blocks = await api<Record<string, any>>(base, 'GET', `${A}/fraud/blocks`, undefined, { token: managerA });
        assertStatus(blocks, 200, 'liste des blocages');
        const active = blocks.body.items.find((item: Record<string, any>) => item.userId === 'usr_actor_18' && item.active);
        assert(active, 'blocage actif');
        const lift = await api<Record<string, any>>(base, 'POST', `${A}/fraud/blocks/${active.id}/lift`, undefined, { token: managerA });
        assertStatus(lift, 200, 'levée de blocage');
        assertEqual(lift.body.block.active, false, 'blocage levé');
        const retry = await createIntent(actor(18), { method: 'mobile_money', amountXof: 1_000 });
        assertStatus(retry, 201, 'création possible après levée');
      },
    },
    {
      name: 'Anti-fraude : vélocité de création bloquée au-delà de 5 tentatives en 10 minutes',
      run: async () => {
        for (let index = 0; index < 5; index += 1) {
          const accepted = await createIntent(actor(19), { method: 'mobile_money', amountXof: 800 + index * 10 });
          assertStatus(accepted, 201, `tentative ${index + 1}`);
        }
        const blocked = await createIntent(actor(19), { method: 'mobile_money', amountXof: 900 });
        assertStatus(blocked, 429, 'sixième tentative bloquée');
        assertEqual(blocked.body.error.details.rule, 'velocite', 'règle de vélocité');
      },
    },
    {
      name: 'RBAC : consultation seule sans création, remboursement, reversement ni export',
      run: async () => {
        assertStatus(await api(base, 'GET', `${A}/transactions`, undefined, { token: cashierA }), 200, 'lecture autorisée');
        assertStatus(await createIntent(cashierA, { method: 'mobile_money', amountXof: 1_000 }), 403, 'création refusée');
        const target = confirmed[0];
        assertStatus(
          await api(base, 'POST', `${A}/transactions/${target.id}/refund`, { reason: 'Test RBAC' }, { token: cashierA }),
          403,
          'remboursement refusé',
        );
        assertStatus(
          await api(base, 'POST', `${A}/settlements`, { amountXof: 1_000, mode: 'instant', destination: 'TMoney' }, { token: cashierA }),
          403,
          'reversement refusé',
        );
        assertStatus(await api(base, 'GET', `${A}/exports/transactions.csv`, undefined, { token: cashierA }), 403, 'export refusé');
        const csv = await api<string>(base, 'GET', `${A}/exports/transactions.csv`, undefined, { token: managerA });
        assertStatus(csv, 200, 'export CSV');
        assert(String(csv.body).includes('Montant XOF'), 'en-têtes CSV');
        const xls = await api<string>(base, 'GET', `${A}/exports/transactions.xls`, undefined, { token: managerA });
        assertStatus(xls, 200, 'export Excel');
        assert(String(xls.body).includes('<Workbook'), 'classeur SpreadsheetML');
        const pdf = await api<string>(base, 'GET', `${A}/exports/transactions.pdf`, undefined, { token: managerA });
        assertStatus(pdf, 200, 'export PDF');
        assert(String(pdf.body).length > 500, 'PDF non vide');
      },
    },
    {
      name: 'Litiges plateforme : ouverture, résolution avec remboursement, audit',
      run: async () => {
        const target = confirmed[1];
        const opened = await api<Record<string, any>>(base, 'POST', `${P}/disputes`, {
          tenantId: TENANT,
          transactionId: target.id,
          reason: 'Double débit signalé',
          description: 'Le client affirme avoir été débité deux fois.',
        }, { token: platformAdmin });
        assertStatus(opened, 201, 'ouverture du litige');
        assertEqual(opened.body.dispute.status, 'ouverte', 'litige ouvert');
        const resolved = await api<Record<string, any>>(base, 'POST', `${P}/disputes/${opened.body.dispute.id}/resolve`, {
          outcome: 'acceptee',
          refundAmountXof: 1_500,
          note: 'Geste commercial',
        }, { token: platformAdmin });
        assertStatus(resolved, 200, 'résolution du litige');
        assertEqual(resolved.body.dispute.status, 'resolue', 'litige résolu');
        assert(Boolean(resolved.body.dispute.refundId), 'remboursement rattaché');
        const list = await api<Record<string, any>>(base, 'GET', `${P}/disputes?status=resolue`, undefined, { token: platformAdmin });
        assertStatus(list, 200, 'liste des litiges');
        assertEqual(list.body.items.length, 1, 'un litige résolu');
        assert(events.some((event) => event.type === 'DisputeOpened'), 'DisputeOpened publié');
        assert(events.some((event) => event.type === 'DisputeResolved'), 'DisputeResolved publié');
        const globalLedger = await api<Record<string, any>>(base, 'GET', `${P}/ledger`, undefined, { token: platformAdmin });
        assertStatus(globalLedger, 200, 'grand livre plateforme');
        assertEqual(globalLedger.body.integrity.ok, true, 'intégrité globale');
        const debitTotal = globalLedger.body.balances.reduce((sum: number, row: Record<string, any>) => sum + row.debitXof, 0);
        const creditTotal = globalLedger.body.balances.reduce((sum: number, row: Record<string, any>) => sum + row.creditXof, 0);
        assertEqual(debitTotal, creditTotal, 'partie double équilibrée');
      },
    },
    {
      name: 'Caisse : encaissement OrderPaid enregistré en miroir comptable sans impact portefeuille',
      run: async () => {
        const walletBefore = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        const eventResponse = await api(base, 'POST', '/internal/events', {
          id: 'evt_cash_1',
          type: 'OrderPaid',
          tenantId: TENANT,
          occurredAt: new Date().toISOString(),
          payload: {
            tenantId: TENANT,
            orderId: 'ord_paid',
            number: 'CMD-TEST-0004',
            invoiceNumber: 'FA-TEST-0100',
            method: 'especes',
            totalXof: 5_000,
            at: new Date().toISOString(),
          },
        }, { internalKey: INTERNAL_KEY });
        assertStatus(eventResponse, 202, 'événement caisse accepté');
        const walletAfter = await api<{ wallet: Record<string, any> }>(base, 'GET', `${A}/wallet`, undefined, { token: managerA });
        assertEqual(walletAfter.body.wallet.availableXof, walletBefore.body.wallet.availableXof, 'portefeuille inchangé');
        const list = await api<Record<string, any>>(base, 'GET', `${A}/transactions?q=CASH-CMD-TEST-0004`, undefined, { token: managerA });
        assertEqual(list.body.items[0]?.source, 'caisse', 'transaction miroir présente');
      },
    },
  ];

  try {
    await runTests('payment-service — tests d’isolation et de cycle de paiement', tests);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
