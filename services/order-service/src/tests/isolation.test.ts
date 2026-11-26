import {
  HttpError,
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createEventInboxRoute,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildOrderApp } from '../app.js';
import { createOrderStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';

interface PricingRow {
  id: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  station: 'cuisine' | 'bar';
  priceXof: number;
  available: boolean;
  variants: Array<{ id: string; name: string; priceXof: number }>;
  options: Array<{
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    choices: Array<{ id: string; name: string; priceDeltaXof: number }>;
  }>;
}

function pricingProducts(): PricingRow[] {
  return [
    {
      id: 'prd_poulet',
      name: 'Poulet braisé',
      categoryId: 'cat_grillades',
      categoryName: 'Grillades',
      station: 'cuisine',
      priceXof: 4500,
      available: true,
      variants: [
        { id: 'var_entier', name: 'Entier', priceXof: 4500 },
        { id: 'var_demi', name: 'Demi', priceXof: 3500 },
      ],
      options: [
        {
          id: 'opt_accomp',
          name: 'Accompagnement',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          choices: [
            { id: 'cho_frites', name: 'Frites', priceDeltaXof: 500 },
            { id: 'cho_alloco', name: 'Alloco', priceDeltaXof: 500 },
          ],
        },
      ],
    },
    {
      id: 'prd_bissap',
      name: 'Bissap',
      categoryId: 'cat_boissons',
      categoryName: 'Boissons',
      station: 'bar',
      priceXof: 2000,
      available: true,
      variants: [],
      options: [],
    },
    {
      id: 'prd_biere',
      name: 'Bière locale',
      categoryId: 'cat_boissons',
      categoryName: 'Boissons',
      station: 'bar',
      priceXof: 1500,
      available: true,
      variants: [],
      options: [],
    },
    {
      id: 'prd_salade',
      name: 'Salade de fruits',
      categoryId: 'cat_desserts',
      categoryName: 'Desserts',
      station: 'cuisine',
      priceXof: 2000,
      available: true,
      variants: [],
      options: [],
    },
    {
      id: 'prd_rupture',
      name: 'Plat en rupture',
      categoryId: 'cat_plats',
      categoryName: 'Plats',
      station: 'cuisine',
      priceXof: 1000,
      available: false,
      variants: [],
      options: [],
    },
  ];
}

function claims(sub: string, tenantPermissions: Record<string, string[]>): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name: sub,
    mfa: false,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

interface FakeTable {
  id: string;
  code: string;
  status: string;
  orderId: string | null;
  mergedIntoCode: string | null;
  qrToken: string;
  capacity: number;
}

async function main() {
  const store = createOrderStore();
  const bus = createEventBus({ name: 'order-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };

  const ALL_A = [
    'order:view',
    'order:create',
    'order:update',
    'order:cancel',
    'order:discount',
    'pos:operate',
    'pos:close',
    'payment:view',
    'payment:refund',
    'report:export',
    'audit:view',
  ];

  const managerA = register('token-manager-a', claims('usr_manager_a', { tnt_alpha: ALL_A }));
  const waiterA = register(
    'token-waiter-a',
    claims('usr_waiter_a', { tnt_alpha: ['order:view', 'order:create', 'order:update'] }),
  );
  const cashierA = register(
    'token-cashier-a',
    claims('usr_cashier_a', {
      tnt_alpha: ['order:view', 'order:update', 'pos:operate', 'pos:close', 'payment:view'],
    }),
  );
  const cookA = register(
    'token-cook-a',
    claims('usr_cook_a', { tnt_alpha: ['order:view', 'order:update'] }),
  );
  const cancelOnlyA = register(
    'token-cancel-only-a',
    claims('usr_cancel_a', { tnt_alpha: ['order:view', 'order:cancel'] }),
  );
  const managerB = register('token-manager-b', claims('usr_manager_b', { tnt_beta: ALL_A }));

  const tables = new Map<string, FakeTable>();
  const addTable = (tenantId: string, code: string, qrToken: string) => {
    tables.set(`${tenantId}:${code}`, {
      id: `tbl_${code.replace(/[^A-Z0-9]/g, '_')}`,
      code,
      status: 'libre',
      orderId: null,
      mergedIntoCode: null,
      qrToken,
      capacity: 4,
    });
  };
  addTable('tnt_alpha', 'LOMEA-SAL-001', 'qr-alpha-1');
  addTable('tnt_alpha', 'LOMEA-SAL-002', 'qr-alpha-2');
  addTable('tnt_alpha', 'LOMEA-SAL-009', 'qr-alpha-9');
  addTable('tnt_beta', 'LOMEB-SAL-001', 'qr-beta-1');

  const floorCalls: Array<{ path: string; body: unknown }> = [];
  const findTable = (path: string): { tenantId: string; table: FakeTable } | null => {
    const match = path.match(
      /\/internal\/tenants\/([^/]+)\/floor\/tables\/([^/]+?)(?:\/(verify|order|release))?$/,
    );
    if (!match) return null;
    const tenantId = match[1];
    const code = decodeURIComponent(match[2]);
    const table = tables.get(`${tenantId}:${code}`);
    return table ? { tenantId, table } : null;
  };

  const deps = {
    catalog: {
      get: async <T>(path: string): Promise<T> => {
        const match = path.match(/\/internal\/tenants\/([^/]+)\/catalog\/pricing$/);
        const tenantId = match?.[1] ?? '';
        const products =
          tenantId === 'tnt_alpha'
            ? pricingProducts()
            : [
                {
                  id: 'prd_beta',
                  name: 'Plat Bêta',
                  categoryId: 'cat_b',
                  categoryName: 'Plats',
                  station: 'cuisine' as const,
                  priceXof: 3000,
                  available: true,
                  variants: [],
                  options: [],
                },
              ];
        return { products } as T;
      },
    },
    floor: {
      get: async <T>(path: string): Promise<T> => {
        const found = findTable(path);
        if (!found) throw HttpError.notFound('Place introuvable.');
        return {
          tenantId: found.tenantId,
          table: {
            id: found.table.id,
            code: found.table.code,
            status: found.table.status,
            capacity: found.table.capacity,
            orderId: found.table.orderId,
            mergedIntoCode: found.table.mergedIntoCode,
          },
        } as T;
      },
      post: async <T>(path: string, body?: unknown): Promise<T> => {
        floorCalls.push({ path, body });
        const found = findTable(path);
        if (!found) throw HttpError.notFound('Place introuvable.');
        const table = found.table;
        const payload = (body ?? {}) as { token?: string; orderId?: string; to?: string };
        if (path.endsWith('/verify')) {
          if (payload.token !== table.qrToken) {
            throw new HttpError(403, 'table_token_invalid', 'QR de place invalide ou révoqué.');
          }
          return {
            tenantId: found.tenantId,
            table: {
              id: table.id,
              code: table.code,
              status: table.status,
              capacity: table.capacity,
              orderId: table.orderId,
              mergedIntoCode: table.mergedIntoCode,
            },
          } as T;
        }
        if (path.endsWith('/order')) {
          table.orderId = payload.orderId ?? null;
          if (table.status === 'libre' || table.status === 'reservee') table.status = 'occupee';
          return { table } as T;
        }
        if (path.endsWith('/release')) {
          if (table.orderId !== payload.orderId) {
            throw HttpError.conflict('order_mismatch', 'Commande non liée à cette place.');
          }
          table.orderId = null;
          table.status = payload.to === 'nettoyage' ? 'nettoyage' : 'libre';
          return { table } as T;
        }
        throw HttpError.notFound('Route floor inconnue.');
      },
    },
    tenant: {
      get: async <T>(): Promise<T> => ({ brandName: 'Sahel Grill' }) as T,
    },
  };

  const server = await startServer(
    {
      name: 'order-service-test',
      routes: [
        ...buildOrderApp({
          store,
          vatRate: 0.18,
          timeZone: 'Africa/Lome',
          appPublicUrl: 'https://app.resto-hub.tg',
          deps,
          publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
        }),
        createEventInboxRoute(bus),
      ],
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const a = '/api/v1/tenants/tnt_alpha/orders';
  const b = '/api/v1/tenants/tnt_beta/orders';
  const posA = '/api/v1/tenants/tnt_alpha/pos';

  const takeaway = (items: unknown[], extra: Record<string, unknown> = {}) => ({
    channel: 'a_emporter',
    customer: { name: 'Client comptoir', phone: '+228 90 00 00 01' },
    items,
    ...extra,
  });
  const poulet = {
    productId: 'prd_poulet',
    quantity: 2,
    variantId: 'var_entier',
    optionChoiceIds: ['cho_frites'],
  };

  let orderId = '';

  const cases: TestCase[] = [
    {
      name: 'Prise de commande : prix imposés par le catalogue, postes cuisine/bar, événement OrderCreated',
      run: async () => {
        const result = await api(
          base,
          'POST',
          a,
          {
            channel: 'sur_place',
            tableCode: 'LOMEA-SAL-001',
            guests: 2,
            items: [poulet, { productId: 'prd_bissap', quantity: 1 }],
          },
          { token: waiterA },
        );
        assertStatus(result, 201, 'Création commande sur place');
        const order = result.body.order;
        orderId = order.id;
        assertEqual(order.tableCode, 'LOMEA-SAL-001', 'Table attachée');
        assertEqual(order.subtotalXof, 12000, 'Prix calculés serveur : 2 × 5000 + 2000');
        assertEqual(order.totalXof, 12000, 'Total TTC');
        assertEqual(order.netXof, 10169, 'Net HT arrondi à 18 % de TVA');
        assertEqual(order.taxXof, 1831, 'TVA = total − HT');
        assertEqual(order.status, 'recue', 'Statut initial reçue');
        assertEqual(order.tickets.length, 2, 'Un ticket cuisine et un ticket bar');
        assert(
          order.tickets.some((ticket: { station: string }) => ticket.station === 'cuisine'),
          'Ticket cuisine',
        );
        assert(
          order.tickets.some((ticket: { station: string }) => ticket.station === 'bar'),
          'Ticket bar',
        );
        const event = bus
          .outbox()
          .find((entry) => entry.type === 'OrderCreated' && entry.payload.orderId === order.id);
        assert(event, 'OrderCreated publié');
        const table = tables.get('tnt_alpha:LOMEA-SAL-001')!;
        assertEqual(table.status, 'occupee', 'Table passée occupée via l’API interne floor');
        assertEqual(table.orderId, order.id, 'Commande attachée à la place');
      },
    },
    {
      name: 'Validation : table, adresse de livraison et précommande future',
      run: async () => {
        const noTable = await api(
          base,
          'POST',
          a,
          { channel: 'sur_place', items: [poulet] },
          { token: waiterA },
        );
        assertStatus(noTable, 422, 'Sur place sans table refusé');
        assertEqual(noTable.body.error.code, 'table_required', 'Code table_required');
        const noAddress = await api(
          base,
          'POST',
          a,
          {
            channel: 'livraison',
            customer: { name: 'Sans adresse', phone: '+228 90 00 00 02' },
            items: [poulet],
          },
          { token: waiterA },
        );
        assertStatus(noAddress, 422, 'Livraison sans adresse refusée');
        assertEqual(noAddress.body.error.code, 'address_required', 'Code address_required');
        const past = await api(
          base,
          'POST',
          a,
          takeaway([poulet], {
            channel: 'precommande',
            scheduledFor: new Date(Date.now() - 3600_000).toISOString(),
          }),
          { token: waiterA },
        );
        assertStatus(past, 422, 'Précommande passée refusée');
        assertEqual(past.body.error.code, 'invalid_schedule', 'Code invalid_schedule');
      },
    },
    {
      name: 'Rupture (86) et produit inconnu refusés au moment de la commande',
      run: async () => {
        const rupture = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_rupture', quantity: 1 }]),
          { token: waiterA },
        );
        assertStatus(rupture, 409, 'Produit en rupture refusé');
        assertEqual(rupture.body.error.code, 'product_unavailable', 'Code product_unavailable');
        const unknown = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_autre_tenant', quantity: 1 }]),
          { token: waiterA },
        );
        assertStatus(unknown, 422, 'Produit inconnu refusé');
        assertEqual(unknown.body.error.code, 'unknown_product', 'Code unknown_product');
        const missingOption = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_poulet', quantity: 1, variantId: 'var_entier' }]),
          { token: waiterA },
        );
        assertStatus(missingOption, 422, 'Accompagnement obligatoire manquant');
        assertEqual(missingOption.body.error.code, 'option_required', 'Code option_required');
      },
    },
    {
      name: 'Idempotence hors ligne : clientRequestId rejoué sans doublon',
      run: async () => {
        const payload = takeaway([{ productId: 'prd_bissap', quantity: 3 }], {
          clientRequestId: 'of-sync-alpha-0001',
        });
        const first = await api(base, 'POST', a, payload, { token: waiterA });
        assertStatus(first, 201, 'Première synchronisation');
        const second = await api(base, 'POST', a, payload, { token: waiterA });
        assertStatus(second, 200, 'Rejeu détecté');
        assertEqual(second.body.replayed, true, 'Réponse marquée rejouée');
        assertEqual(second.body.order.id, first.body.order.id, 'Même commande retournée');
        const events = bus
          .outbox()
          .filter(
            (entry) =>
              entry.type === 'OrderCreated' && entry.payload.orderId === first.body.order.id,
          );
        assertEqual(events.length, 1, 'Un seul événement OrderCreated');
      },
    },
    {
      name: 'Workflow horodaté : reçue → en préparation → prête → servie, transitions invalides refusées',
      run: async () => {
        const created = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_biere', quantity: 2 }]),
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande créée');
        const id = created.body.order.id;
        const version = created.body.order.version;
        const prepare = await api(
          base,
          'POST',
          `${a}/${id}/status`,
          { status: 'en_preparation', expectedVersion: version },
          { token: waiterA },
        );
        assertStatus(prepare, 200, 'Passage en préparation');
        assert(prepare.body.order.preparingAt, 'Horodatage préparation');
        const ready = await api(
          base,
          'POST',
          `${a}/${id}/status`,
          { status: 'prete' },
          { token: waiterA },
        );
        assertStatus(ready, 200, 'Passage prête');
        assert(ready.body.order.readyAt, 'Horodatage prête');
        const served = await api(
          base,
          'POST',
          `${a}/${id}/status`,
          { status: 'servie' },
          { token: waiterA },
        );
        assertStatus(served, 200, 'Passage servie');
        assert(served.body.order.servedAt, 'Horodatage servie');
        const back = await api(
          base,
          'POST',
          `${a}/${id}/status`,
          { status: 'recue' },
          { token: waiterA },
        );
        assertStatus(back, 409, 'Retour en arrière refusé');
        assertEqual(back.body.error.code, 'invalid_transition', 'Code invalid_transition');
        const timeline = served.body.order.timeline.map(
          (entry: { status: string }) => entry.status,
        );
        assertEqual(
          timeline.join('>'),
          'recue>en_preparation>prete>servie',
          'Chronologie complète',
        );
        const events = bus
          .outbox()
          .filter((entry) => entry.type === 'OrderStatusChanged' && entry.payload.orderId === id);
        assertEqual(events.length, 3, 'Trois OrderStatusChanged');
      },
    },
    {
      name: 'KDS : tickets par poste, prêt cuisine+bar → commande prête automatiquement',
      run: async () => {
        const created = await api(
          base,
          'POST',
          a,
          takeaway([
            {
              productId: 'prd_poulet',
              quantity: 1,
              variantId: 'var_demi',
              optionChoiceIds: ['cho_alloco'],
            },
            { productId: 'prd_bissap', quantity: 1 },
          ]),
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande mixte créée');
        const id = created.body.order.id;
        const kds = await api(
          base,
          'GET',
          `/api/v1/tenants/tnt_alpha/kds?station=cuisine`,
          undefined,
          { token: cookA },
        );
        assertStatus(kds, 200, 'KDS cuisine accessible');
        const ticket = kds.body.tickets.find((entry: { orderId: string }) => entry.orderId === id);
        assert(ticket, 'Ticket cuisine présent dans le KDS');
        assertEqual(ticket.status, 'nouvelle', 'Ticket nouveau');
        assert(
          ticket.lines.length === 1 && ticket.lines[0].options.includes('Alloco'),
          'Options transmises au poste',
        );
        const started = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/kds/tickets/${ticket.id}/status`,
          { status: 'en_preparation' },
          { token: cookA },
        );
        assertStatus(started, 200, 'Cuisine démarre');
        assertEqual(started.body.order.status, 'en_preparation', 'Commande en préparation');
        const barTicket = started.body.order.tickets.find(
          (entry: { station: string }) => entry.station === 'bar',
        );
        const barReady = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/kds/tickets/${barTicket.id}/status`,
          { status: 'prete' },
          { token: waiterA },
        );
        assertStatus(barReady, 200, 'Bar prêt');
        assertEqual(
          barReady.body.order.status,
          'en_preparation',
          'Commande toujours en préparation (cuisine en cours)',
        );
        const kitchenReady = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/kds/tickets/${ticket.id}/status`,
          { status: 'prete' },
          { token: cookA },
        );
        assertStatus(kitchenReady, 200, 'Cuisine prête');
        assertEqual(
          kitchenReady.body.order.status,
          'prete',
          'Commande prête quand tous les postes le sont',
        );
      },
    },
    {
      name: 'RBAC : serveur sans remise, cuisinier sans création, caissier sans annulation',
      run: async () => {
        const discount = await api(
          base,
          'POST',
          `${a}/${orderId}/discount`,
          { type: 'percent', value: 5, reason: 'Geste' },
          { token: waiterA },
        );
        assertStatus(discount, 403, 'Serveur ne peut pas remiser');
        const create = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_biere', quantity: 1 }]),
          { token: cookA },
        );
        assertStatus(create, 403, 'Cuisinier ne peut pas créer de commande');
        const cancel = await api(
          base,
          'POST',
          `${a}/${orderId}/cancel`,
          { reason: 'Test' },
          { token: cashierA },
        );
        assertStatus(cancel, 403, 'Caissier ne peut pas annuler sans permission');
        const session = await api(
          base,
          'POST',
          `${posA}/session/open`,
          { openingFloatXof: 1000 },
          { token: waiterA },
        );
        assertStatus(session, 403, 'Serveur ne peut pas ouvrir la caisse');
      },
    },
    {
      name: 'Remise motivée : calcul serveur, motif obligatoire, verrou après premier paiement',
      run: async () => {
        const created = await api(
          base,
          'POST',
          a,
          takeaway([
            { productId: 'prd_salade', quantity: 1 },
            { productId: 'prd_biere', quantity: 2 },
          ]),
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande créée');
        const id = created.body.order.id;
        const noReason = await api(
          base,
          'POST',
          `${a}/${id}/discount`,
          { type: 'percent', value: 10 },
          { token: managerA },
        );
        assertStatus(noReason, 422, 'Motif de remise obligatoire');
        const discount = await api(
          base,
          'POST',
          `${a}/${id}/discount`,
          { type: 'percent', value: 10, reason: 'Carte fidélité' },
          { token: managerA },
        );
        assertStatus(discount, 200, 'Remise appliquée');
        assertEqual(discount.body.order.subtotalXof, 5000, 'Sous-total inchangé');
        assertEqual(discount.body.order.discount.amountXof, 500, 'Remise 10 % = 500');
        assertEqual(discount.body.order.totalXof, 4500, 'Total remisé');
        const payment = await api(
          base,
          'POST',
          `${a}/${id}/payments`,
          { method: 'especes', amountXof: 1000 },
          { token: cashierA },
        );
        assertStatus(payment, 201, 'Acompte encaissé');
        const locked = await api(
          base,
          'POST',
          `${a}/${id}/discount`,
          { type: 'amount', value: 200, reason: 'Trop tard' },
          { token: managerA },
        );
        assertStatus(locked, 409, 'Remise verrouillée après encaissement');
        assertEqual(locked.body.error.code, 'payments_started', 'Code payments_started');
      },
    },
    {
      name: 'POS : paiement partiel puis total, facture séquentielle, un seul OrderPaid',
      run: async () => {
        const open = await api(
          base,
          'POST',
          `${posA}/session/open`,
          { openingFloatXof: 20000 },
          { token: cashierA },
        );
        assertStatus(open, 201, 'Ouverture de caisse');
        const created = await api(
          base,
          'POST',
          a,
          takeaway([
            {
              productId: 'prd_poulet',
              quantity: 1,
              variantId: 'var_entier',
              optionChoiceIds: ['cho_frites'],
            },
          ]),
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande à payer');
        const id = created.body.order.id;
        assertEqual(created.body.order.totalXof, 5000, 'Total 5000');
        const part = await api(
          base,
          'POST',
          `${a}/${id}/payments`,
          { method: 'mobile_money', amountXof: 2000, reference: 'TM-001' },
          { token: cashierA },
        );
        assertStatus(part, 201, 'Paiement partiel');
        assertEqual(part.body.order.paymentStatus, 'partielle', 'Statut partielle');
        assertEqual(
          part.body.payment.sessionId,
          open.body.session.id,
          'Paiement rattaché à la session',
        );
        const over = await api(
          base,
          'POST',
          `${a}/${id}/payments`,
          { method: 'especes', amountXof: 9999 },
          { token: cashierA },
        );
        assertStatus(over, 422, 'Surpaiement refusé');
        const rest = await api(
          base,
          'POST',
          `${a}/${id}/payments`,
          { method: 'especes', amountXof: 3000 },
          { token: cashierA },
        );
        assertStatus(rest, 201, 'Solde encaissé');
        assertEqual(rest.body.order.paymentStatus, 'payee', 'Commande payée');
        assert(
          /^FA-\d{4}-000001$/.test(rest.body.order.invoiceNumber),
          'Facture séquentielle FA-AAAA-000001',
        );
        assert(/^REC-\d{4}-000001$/.test(rest.body.order.receiptNumber), 'Reçu séquentiel');
        const paidEvents = bus
          .outbox()
          .filter((entry) => entry.type === 'OrderPaid' && entry.payload.orderId === id);
        assertEqual(paidEvents.length, 1, 'Un seul OrderPaid');
        const invoice = await api(base, 'GET', `${a}/${id}/invoice`, undefined, {
          token: managerA,
        });
        assertStatus(invoice, 200, 'Facture consultable');
        assertEqual(
          invoice.body.invoice.number,
          rest.body.order.invoiceNumber,
          'Numéro de facture cohérent',
        );
        const receipt = await api(base, 'GET', `${a}/${id}/receipt.pdf`, undefined, {
          token: managerA,
        });
        assertEqual(receipt.status, 200, 'Ticket PDF généré');
        assert(typeof receipt.body === 'string' && receipt.body.startsWith('%PDF'), 'PDF valide');
      },
    },
    {
      name: 'Clôture de caisse : écart calculé, caisse unique par établissement',
      run: async () => {
        const duplicate = await api(
          base,
          'POST',
          `${posA}/session/open`,
          { openingFloatXof: 5000 },
          { token: managerA },
        );
        assertStatus(duplicate, 409, 'Deuxième caisse ouverte refusée');
        const created = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_salade', quantity: 1 }]),
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande en caisse');
        const id = created.body.order.id;
        const pay = await api(
          base,
          'POST',
          `${a}/${id}/payments`,
          { method: 'carte', amountXof: 2000 },
          { token: cashierA },
        );
        assertStatus(pay, 201, 'Paiement carte');
        const pos = await api(base, 'GET', posA, undefined, { token: cashierA });
        assertStatus(pos, 200, 'Tableau de bord caisse');
        const expected: number = pos.body.session.liveExpectedXof;
        const close = await api(
          base,
          'POST',
          `${posA}/session/close`,
          { countedXof: expected + 500, notes: 'Écart de test' },
          { token: cashierA },
        );
        assertStatus(close, 200, 'Clôture de caisse');
        assertEqual(close.body.session.differenceXof, 500, 'Écart de caisse de +500');
        const again = await api(
          base,
          'POST',
          `${posA}/session/close`,
          { countedXof: expected },
          { token: cashierA },
        );
        assertStatus(again, 409, 'Seconde clôture refusée');
      },
    },
    {
      name: 'Annulation motivée : motif requis, place libérée, commande payée verrouillée sans remboursement',
      run: async () => {
        const created = await api(
          base,
          'POST',
          a,
          {
            channel: 'sur_place',
            tableCode: 'LOMEA-SAL-002',
            items: [{ productId: 'prd_biere', quantity: 1 }],
          },
          { token: waiterA },
        );
        assertStatus(created, 201, 'Commande sur place');
        const id = created.body.order.id;
        assertEqual(tables.get('tnt_alpha:LOMEA-SAL-002')!.status, 'occupee', 'Place occupée');
        const missing = await api(
          base,
          'POST',
          `${a}/${id}/cancel`,
          { reason: '' },
          { token: managerA },
        );
        assertStatus(missing, 422, 'Motif obligatoire');
        const cancel = await api(
          base,
          'POST',
          `${a}/${id}/cancel`,
          { reason: 'Client parti avant service' },
          { token: managerA },
        );
        assertStatus(cancel, 200, 'Annulation motivée');
        assertEqual(cancel.body.order.status, 'annulee', 'Statut annulée');
        assertEqual(
          cancel.body.order.cancel.reason,
          'Client parti avant service',
          'Motif conservé',
        );
        const table = tables.get('tnt_alpha:LOMEA-SAL-002')!;
        assertEqual(table.status, 'libre', 'Place libérée via floor');
        assertEqual(table.orderId, null, 'Commande détachée de la place');
        const paidOrder = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_biere', quantity: 1 }]),
          { token: waiterA },
        );
        const paidId = paidOrder.body.order.id;
        const pay = await api(
          base,
          'POST',
          `${a}/${paidId}/payments`,
          { method: 'especes', amountXof: 1500 },
          { token: cashierA },
        );
        assertStatus(pay, 201, 'Commande payée');
        const refused = await api(
          base,
          'POST',
          `${a}/${paidId}/cancel`,
          { reason: 'Remboursement' },
          { token: cancelOnlyA },
        );
        assertStatus(refused, 403, 'Annulation d’une commande payée sans permission remboursement');
        assertEqual(
          refused.body.error.code,
          'refund_validation_required',
          'Validation gérant exigée',
        );
        const allowed = await api(
          base,
          'POST',
          `${a}/${paidId}/cancel`,
          { reason: 'Remboursement validé' },
          { token: managerA },
        );
        assertStatus(allowed, 200, 'Gérant valide le remboursement');
      },
    },
    {
      name: 'Isolation A/B : listes, KDS et accès direct cloisonnés',
      run: async () => {
        const beta = await api(
          base,
          'POST',
          b,
          takeaway([{ productId: 'prd_beta', quantity: 1 }]),
          { token: managerB },
        );
        assertStatus(beta, 201, 'Commande bêta');
        const listA = await api(base, 'GET', a, undefined, { token: managerA });
        const listB = await api(base, 'GET', b, undefined, { token: managerB });
        assertStatus(listA, 200, 'Liste alpha');
        assertStatus(listB, 200, 'Liste bêta');
        assert(
          listA.body.items.every((order: { number: string }) => order.number.startsWith('CMD-')),
          'Format des numéros',
        );
        assertEqual(listB.body.items.length, 1, 'Une seule commande bêta');
        const cross = await api(base, 'GET', `${a}/${beta.body.order.id}`, undefined, {
          token: managerB,
        });
        assertEqual(cross.status, 403, 'Accès direct inter-tenant refusé');
        const kdsB = await api(base, 'GET', `/api/v1/tenants/tnt_beta/kds`, undefined, {
          token: managerB,
        });
        assertStatus(kdsB, 200, 'KDS bêta');
        assert(
          kdsB.body.tickets.every(
            (ticket: { orderNumber: string; orderId: string }) =>
              !ticket.orderNumber.startsWith('CMD-') || ticket.orderId === beta.body.order.id,
          ),
          'KDS bêta isolé',
        );
        const denied = await api(base, 'GET', a, undefined, { token: managerB });
        assertStatus(denied, 403, 'Claims bêta refusés sur alpha');
      },
    },
    {
      name: 'Commande client par QR : jeton vérifié, suivi protégé, table occupée',
      run: async () => {
        const wrong = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/orders', {
          channel: 'sur_place',
          tableCode: 'LOMEA-SAL-009',
          tableToken: 'mauvais-jeton',
          customer: { name: 'Awa', phone: '+228 90 44 55 66' },
          items: [{ productId: 'prd_bissap', quantity: 1 }],
        });
        assertStatus(wrong, 403, 'Jeton QR invalide refusé');
        const payload = {
          channel: 'sur_place',
          tableCode: 'LOMEA-SAL-009',
          tableToken: 'qr-alpha-9',
          customer: { name: 'Awa K.', phone: '+228 90 44 55 66' },
          items: [{ productId: 'prd_bissap', quantity: 2 }],
          clientRequestId: 'qr-public-alpha-0001',
        };
        const created = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/orders', payload);
        assertStatus(created, 201, 'Commande QR créée');
        assertEqual(created.body.order.status, 'recue', 'Commande reçue');
        const id = created.body.order.id;
        assertEqual(
          tables.get('tnt_alpha:LOMEA-SAL-009')!.orderId,
          id,
          'Place occupée par la commande',
        );
        const noKey = await api(base, 'GET', `/api/v1/public/tenants/tnt_alpha/orders/${id}`);
        assertStatus(noKey, 403, 'Suivi sans clé refusé');
        const trackingKey = new URL(created.body.trackingUrl).searchParams.get('k');
        const tracking = await api(
          base,
          'GET',
          `/api/v1/public/tenants/tnt_alpha/orders/${id}?k=${trackingKey}`,
        );
        assertStatus(tracking, 200, 'Suivi avec clé');
        assertEqual(tracking.body.order.totalXof, 4000, 'Total public');
        const replay = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/orders', payload);
        assertStatus(replay, 200, 'Rejeu hors ligne sans doublon');
        const busy = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/orders', {
          ...payload,
          clientRequestId: 'qr-public-alpha-0002',
        });
        assertStatus(busy, 409, 'Deuxième commande sur table occupée refusée');
        assertEqual(busy.body.error.code, 'table_busy', 'Code table_busy');
      },
    },
    {
      name: 'Export CSV cloisonné et journal d’audit intègre',
      run: async () => {
        const denied = await api(base, 'GET', `${a}/export.csv`, undefined, { token: waiterA });
        assertStatus(denied, 403, 'Export réservé à report:export');
        const exported = await api(base, 'GET', `${a}/export.csv`, undefined, { token: managerA });
        assertEqual(exported.status, 200, 'Export CSV');
        const csv = String(exported.body);
        assert(
          csv.replace('\uFEFF', '').startsWith('numero;date;canal;statut'),
          'En-tête CSV point-virgule',
        );
        assert(csv.includes('net_ht_xof;tva_xof'), 'Colonnes TVA présentes');
        assert(csv.includes(csv.match(/CMD-\d{4}-\d{6}/)?.[0] ?? 'CMD-'), 'Commandes présentes');
        const audit = await api(base, 'GET', `${a}/audit`, undefined, { token: managerA });
        assertStatus(audit, 200, 'Journal d’audit');
        assertEqual(audit.body.integrity, true, 'Chaîne d’audit intègre');
        const actions = audit.body.entries.map((entry: { action: string }) => entry.action);
        assert(actions.includes('order.discount.applied'), 'Remise auditée');
        assert(actions.includes('order.cancelled'), 'Annulation auditée');
        assert(actions.includes('order.paid'), 'Paiement audité');
        assert(actions.includes('pos.session.closed'), 'Clôture de caisse auditée');
      },
    },
    {
      name: 'Synchronisation hors ligne : conflit de version explicite avec l’état courant',
      run: async () => {
        const created = await api(
          base,
          'POST',
          a,
          takeaway([{ productId: 'prd_biere', quantity: 1 }]),
          { token: waiterA },
        );
        const id = created.body.order.id;
        const conflict = await api(
          base,
          'POST',
          `${a}/${id}/status`,
          { status: 'en_preparation', expectedVersion: 999 },
          { token: waiterA },
        );
        assertStatus(conflict, 409, 'Conflit de version');
        assertEqual(conflict.body.error.code, 'version_conflict', 'Code version_conflict');
        assertEqual(
          conflict.body.error.details.current.id,
          id,
          'État courant retourné pour fusion',
        );
      },
    },
  ];

  await runTests('ORDER-SERVICE — commandes, KDS, caisse, facturation et isolation', cases);
  await server.close();

  const summary = bus
    .outbox()
    .filter((entry) => ['OrderCreated', 'OrderStatusChanged', 'OrderPaid'].includes(entry.type));
  console.log(
    `Événements métier publiés : ${summary.length} (OrderCreated ${summary.filter((e) => e.type === 'OrderCreated').length}, OrderStatusChanged ${summary.filter((e) => e.type === 'OrderStatusChanged').length}, OrderPaid ${summary.filter((e) => e.type === 'OrderPaid').length}).`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
