import {
  HttpError,
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createServiceClient,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildInventoryApp, createOrderLineReader, handleInventoryEvent } from '../app.js';
import {
  createInventoryStore,
  seedInventoryDemo,
  type InventoryStore,
  type StockItem,
} from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';

function claims(
  sub: string,
  name: string,
  tenantPermissions: Record<string, string[]>,
): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: true,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

async function main() {
  const store: InventoryStore = createInventoryStore();
  seedInventoryDemo(store);
  const bus = createEventBus({
    name: 'inventory-test',
    internalKey: INTERNAL_KEY,
    subscribers: [],
  });
  const published: string[] = [];
  const publish = async (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => {
    published.push(type);
    return bus.publish(type, tenantId, payload);
  };

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const owner = register(
    'token-owner',
    claims('usr_owner', 'Gérant Sahel', {
      [SAHEL]: ['inventory:view', 'inventory:manage', 'audit:view'],
    }),
  );
  const cook = register(
    'token-cook',
    claims('usr_cook', 'Cuisinier', { [SAHEL]: ['inventory:view'] }),
  );
  const waiter = register(
    'token-waiter',
    claims('usr_waiter', 'Serveur', { [SAHEL]: ['pos:operate'] }),
  );
  const ownerBaobab = register(
    'token-owner-baobab',
    claims('usr_owner_baobab', 'Gérant Baobab', {
      [BAOBAB]: ['inventory:view', 'inventory:manage'],
    }),
  );

  const orderLines = new Map<string, Array<{ productId: string; quantity: number }>>();
  const orderServer = await startServer(
    {
      name: 'order-stub',
      routes: [
        {
          method: 'GET',
          path: '/internal/tenants/:tenantId/orders/:orderId',
          service: true,
          handler: (ctx) => {
            const lines = orderLines.get(ctx.params.orderId ?? '');
            if (!lines) throw HttpError.notFound('Commande introuvable.');
            return { body: { order: { lines } } };
          },
        },
      ],
      authenticate: async () => undefined,
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const readOrderLines = createOrderLineReader(
    createServiceClient({ baseUrl: orderServer.url, internalKey: INTERNAL_KEY }),
  );

  const server = await startServer(
    {
      name: 'inventory-service-test',
      routes: buildInventoryApp({ store, publish }),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const A = `/api/v1/tenants/${SAHEL}`;

  const item = (id: string): StockItem => {
    const found = store.items.get(id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  };

  let baobabItemId = '';

  const cases: TestCase[] = [
    {
      name: 'Synthèse : valeur du stock, alertes de seuil et ventes liées',
      run: async () => {
        const summary = await api(base, 'GET', `${A}/inventory/summary`, undefined, {
          token: owner,
        });
        assertStatus(summary, 200, 'Synthèse disponible');
        assertEqual(summary.body.itemCount, 15, '15 articles seedés');
        assertEqual(summary.body.lowStockCount, 2, 'Deux articles sous seuil');
        assert(summary.body.stockValueXof > 0, 'Valorisation positive');
        assert(summary.body.recipeCount === 6, 'Six fiches techniques');
        const alertIds = summary.body.alerts.map((entry: { id: string }) => entry.id);
        assert(
          alertIds.includes('itm_tomate') && alertIds.includes('itm_bissap'),
          'Tomates et hibiscus signalés',
        );

        const alerts = await api(base, 'GET', `${A}/inventory/alerts`, undefined, { token: owner });
        assertStatus(alerts, 200, 'Alertes exposées');
        assertEqual(alerts.body.suggestions.length, 2, 'Deux suggestions de réassort');
        const suggestion = alerts.body.suggestions.find(
          (entry: { itemId: string }) => entry.itemId === 'itm_tomate',
        );
        assertEqual(suggestion.supplierName, 'Marché Adawlato', 'Fournisseur recommandé');
        assert(
          suggestion.quantity > 0 && suggestion.estimatedCostXof > 0,
          'Quantité et coût estimés',
        );
      },
    },
    {
      name: 'Isolation : articles et recettes cloisonnés par établissement',
      run: async () => {
        const cross = await api(base, 'GET', `${A}/inventory/items`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(cross, 403, 'Accès croisé au listing refusé');
        const created = await api(
          base,
          'POST',
          `/api/v1/tenants/${BAOBAB}/inventory/items`,
          {
            name: 'Jus de gingembre',
            sku: 'boi-gin-01',
            unit: 'l',
            category: 'boisson',
            threshold: 2,
            costXof: 1500,
          },
          { token: ownerBaobab },
        );
        assertStatus(created, 201, 'Article créé chez Baobab');
        baobabItemId = created.body.item.id as string;
        const foreign = await api(
          base,
          'PATCH',
          `${A}/inventory/items/${baobabItemId}`,
          { threshold: 9 },
          { token: owner },
        );
        assertStatus(foreign, 404, 'Article d’un autre établissement invisible');
        const foreignWaste = await api(
          base,
          'POST',
          `${A}/inventory/waste`,
          { itemId: baobabItemId, quantity: 1, reason: 'Test' },
          { token: owner },
        );
        assertStatus(foreignWaste, 404, 'Perte croisée refusée');
        const ownList = await api(
          base,
          'GET',
          `/api/v1/tenants/${BAOBAB}/inventory/items`,
          undefined,
          { token: ownerBaobab },
        );
        assertEqual(ownList.body.items.length, 1, 'Baobab ne voit que son article');
        const sahelList = await api(base, 'GET', `${A}/inventory/items`, undefined, {
          token: owner,
        });
        assert(
          !sahelList.body.items.some((entry: { id: string }) => entry.id === baobabItemId),
          'Article Baobab absent de Sahel',
        );
      },
    },
    {
      name: 'RBAC : consultation, gestion et refus explicites',
      run: async () => {
        const denied = await api(base, 'GET', `${A}/inventory/items`, undefined, { token: waiter });
        assertStatus(denied, 403, 'Serveur sans inventory:view');
        const viewOnly = await api(base, 'GET', `${A}/inventory/items`, undefined, { token: cook });
        assertStatus(viewOnly, 200, 'Cuisinier peut consulter');
        const manageDenied = await api(
          base,
          'POST',
          `${A}/inventory/waste`,
          { itemId: 'itm_poulet', quantity: 1, reason: 'Test' },
          { token: cook },
        );
        assertStatus(manageDenied, 403, 'Cuisinier ne peut pas déclarer de perte');
        const notifications = await api(base, 'GET', `${A}/inventory/movements`, undefined, {
          token: cook,
        });
        assertStatus(notifications, 200, 'Historique consultable');
        assert(
          notifications.body.movements.every(
            (entry: { tenantId: string }) => entry.tenantId === SAHEL,
          ),
          'Filtré par tenant',
        );
      },
    },
    {
      name: 'Fiches techniques : coût matière, marge et produisibilité calculés',
      run: async () => {
        const recipes = await api(base, 'GET', `${A}/inventory/recipes`, undefined, {
          token: owner,
        });
        assertStatus(recipes, 200, 'Fiches techniques');
        assertEqual(recipes.body.recipes.length, 6, 'Six recettes');
        const poulet = recipes.body.recipes.find(
          (entry: { productId: string }) => entry.productId === 'prd_sg_poulet',
        );
        assertEqual(poulet.costXof, 1223, 'Coût matière poulet (CUMP)');
        assertEqual(poulet.marginXof, 3277, 'Marge brute');
        assertEqual(poulet.maxProducible, 41, '41 assiettes produisibles');
        assert(poulet.marginRate > 70, 'Taux de marge supérieur à 70 %');
      },
    },
    {
      name: 'Décrément automatique à la vente via OrderPaid, sans double décrément',
      run: async () => {
        orderLines.set('ord_test_attieke_1', [
          { productId: 'prd_sg_attieke', quantity: 15 },
          { productId: 'prd_sg_inconnu', quantity: 2 },
        ]);
        await handleInventoryEvent(
          store,
          SAHEL,
          {
            type: 'OrderPaid',
            payload: { tenantId: SAHEL, orderId: 'ord_test_attieke_1' },
          },
          publish,
          readOrderLines,
        );
        assertEqual(item('itm_attieke').quantity, 9.5, 'Attiéké consommé (14 → 9,5 kg)');
        assertEqual(item('itm_poisson').quantity, 2.65, 'Poisson consommé (6,4 → 2,65 kg)');
        assertEqual(item('itm_tomate').quantity, 6.75, 'Tomates consommées');
        const salesMoves = store.movements.filter((entry) => entry.refId === 'ord_test_attieke_1');
        assertEqual(salesMoves.length, 3, 'Trois lignes de sortie tracées');
        assert(
          salesMoves.every((entry) => entry.actor === 'order-service'),
          'Auteur technique tracé',
        );

        await handleInventoryEvent(
          store,
          SAHEL,
          {
            type: 'OrderPaid',
            payload: { tenantId: SAHEL, orderId: 'ord_test_attieke_1' },
          },
          publish,
          readOrderLines,
        );
        assertEqual(item('itm_attieke').quantity, 9.5, 'Second événement ignoré (idempotence)');
        assert(published.includes('StockBelowThreshold'), 'StockBelowThreshold publié');
        assert(!published.includes('StockDepleted'), 'Aucun stock épuisé à ce stade');
        const auditEntries = store.audit.filter((entry) => entry.action === 'inventory.consumed');
        assertEqual(auditEntries.length, 1, 'Consommation auditée une seule fois');
      },
    },
    {
      name: 'Épuisement : stock à zéro détecté et publié',
      run: async () => {
        orderLines.set('ord_test_attieke_2', [{ productId: 'prd_sg_attieke', quantity: 26 }]);
        await handleInventoryEvent(
          store,
          SAHEL,
          {
            type: 'OrderPaid',
            payload: { tenantId: SAHEL, orderId: 'ord_test_attieke_2' },
          },
          publish,
          readOrderLines,
        );
        assertEqual(item('itm_poisson').quantity, 0, 'Poisson épuisé et borné à zéro');
        assert(published.includes('StockDepleted'), 'StockDepleted publié');
        const missing = await handleInventoryEvent(
          store,
          SAHEL,
          {
            type: 'OrderPaid',
            payload: { tenantId: SAHEL, orderId: 'ord_inconnue' },
          },
          publish,
          readOrderLines,
        );
        assertEqual(missing, undefined, 'Commande introuvable ignorée sans erreur');
        const alerts = await api(base, 'GET', `${A}/inventory/alerts`, undefined, { token: cook });
        assert(
          alerts.body.alerts.some(
            (entry: { id: string; depleted: boolean }) =>
              entry.id === 'itm_poisson' && entry.depleted,
          ),
          'Poisson signalé épuisé',
        );
      },
    },
    {
      name: 'Entrées, pertes et ajustements : CUMP et journal des mouvements',
      run: async () => {
        const waste = await api(
          base,
          'POST',
          `${A}/inventory/waste`,
          {
            itemId: 'itm_poulet',
            quantity: 2,
            reason: 'Rupture de la chaîne du froid',
          },
          { token: owner },
        );
        assertStatus(waste, 201, 'Perte enregistrée');
        assertEqual(waste.body.item.quantity, 16.5, 'Poulet réduit de 2 kg');
        assert(published.includes('WasteRecorded'), 'WasteRecorded publié');

        const beforeCost = item('itm_boeuf').costXof;
        const inbound = await api(
          base,
          'POST',
          `${A}/inventory/movements`,
          {
            type: 'in',
            itemId: 'itm_boeuf',
            quantity: 10,
            unitCostXof: 3300,
            reason: 'Livraison AgriSud',
          },
          { token: owner },
        );
        assertStatus(inbound, 201, 'Entrée enregistrée');
        assertEqual(inbound.body.item.quantity, 19.2, 'Stock bœuf incrémenté');
        assert(Math.abs(inbound.body.item.costXof - 3252) <= 1, 'Coût moyen pondéré recalculé');
        assert(inbound.body.item.costXof > beforeCost, 'CUMP revalorisé');

        const denied = await api(
          base,
          'POST',
          `${A}/inventory/movements`,
          {
            type: 'waste',
            itemId: 'itm_boeuf',
            quantity: 1,
            reason: 'Mauvais canal',
          },
          { token: owner },
        );
        assertStatus(denied, 422, 'Type waste refusé sur endpoint générique');

        const list = await api(base, 'GET', `${A}/inventory/movements?type=waste`, undefined, {
          token: owner,
        });
        assertStatus(list, 200, 'Filtre par type');
        assert(
          list.body.movements.every((entry: { type: string }) => entry.type === 'waste'),
          'Uniquement des pertes',
        );
        assert(list.body.movements.length >= 3, 'Pertes historiques incluses');
      },
    },
    {
      name: 'Fournisseurs et commandes d’achat : réception, CUMP et idempotence',
      run: async () => {
        const created = await api(
          base,
          'POST',
          `${A}/inventory/suppliers`,
          {
            name: 'Coopérative Kara',
            contactName: 'M. Tchalla',
            phone: '+228 92 00 11 22',
            termsDays: 15,
          },
          { token: owner },
        );
        assertStatus(created, 201, 'Fournisseur créé');
        const supplierId = created.body.supplier.id as string;
        const patched = await api(
          base,
          'PATCH',
          `${A}/inventory/suppliers/${supplierId}`,
          { termsDays: 30 },
          { token: owner },
        );
        assertStatus(patched, 200, 'Conditions mises à jour');
        assertEqual(patched.body.supplier.termsDays, 30, 'Délai de paiement persisté');
        const list = await api(base, 'GET', `${A}/inventory/suppliers`, undefined, { token: cook });
        assertEqual(list.body.suppliers.length, 4, 'Quatre fournisseurs');

        const po = await api(
          base,
          'POST',
          `${A}/inventory/purchase-orders`,
          {
            supplierId: 'sup_marche',
            lines: [{ itemId: 'itm_riz', quantity: 10, unitCostXof: 700 }],
          },
          { token: owner },
        );
        assertStatus(po, 201, 'Commande d’achat créée');
        const poId = po.body.purchaseOrder.id as string;
        assertEqual(po.body.purchaseOrder.totalXof, 7000, 'Total de commande');
        assert(
          (po.body.purchaseOrder.number as string).startsWith('CMD-'),
          'Numéro de commande généré',
        );

        const recibed = await api(
          base,
          'POST',
          `${A}/inventory/purchase-orders/${poId}/receive`,
          {},
          { token: owner },
        );
        assertStatus(recibed, 200, 'Commande réceptionnée');
        assertEqual(recibed.body.purchaseOrder.status, 'recue', 'Statut reçue');
        assertEqual(item('itm_riz').quantity, 52, 'Riz incrémenté de 10 kg');
        assert(Math.abs(item('itm_riz').costXof - 660) <= 1, 'CUMP riz recalculé');
        assert(published.includes('PurchaseOrderReceived'), 'PurchaseOrderReceived publié');
        const twice = await api(
          base,
          'POST',
          `${A}/inventory/purchase-orders/${poId}/receive`,
          {},
          { token: owner },
        );
        assertStatus(twice, 409, 'Double réception refusée');
      },
    },
    {
      name: 'Inventaire : écart calculé, validation unique et ajustement automatique',
      run: async () => {
        const created = await api(
          base,
          'POST',
          `${A}/inventory/counts`,
          {
            lines: [
              { itemId: 'itm_huile', counted: 8 },
              { itemId: 'itm_ananas', counted: 8 },
            ],
          },
          { token: owner },
        );
        assertStatus(created, 201, 'Inventaire créé');
        const countId = created.body.count.id as string;
        assertEqual(created.body.count.status, 'brouillon', 'Brouillon');
        const huileLine = created.body.count.lines.find(
          (line: { itemId: string }) => line.itemId === 'itm_huile',
        );
        assertEqual(huileLine.variance, -1, 'Écart négatif détecté');
        assertEqual(huileLine.varianceCostXof, -1200, 'Valorisation de l’écart');

        const validated = await api(
          base,
          'POST',
          `${A}/inventory/counts/${countId}/validate`,
          {},
          { token: owner },
        );
        assertStatus(validated, 200, 'Inventaire validé');
        assertEqual(validated.body.count.status, 'valide', 'Validé');
        assertEqual(item('itm_huile').quantity, 8, 'Stock aligné sur le comptage');
        assert(published.includes('InventoryCountValidated'), 'InventoryCountValidated publié');
        const twice = await api(
          base,
          'POST',
          `${A}/inventory/counts/${countId}/validate`,
          {},
          { token: owner },
        );
        assertStatus(twice, 409, 'Double validation refusée');
      },
    },
    {
      name: 'Recettes : unicité produit, coût recalculé et événement RecipeCostChanged',
      run: async () => {
        const duplicate = await api(
          base,
          'POST',
          `${A}/inventory/recipes`,
          {
            productId: 'prd_sg_poulet',
            productName: 'Doublon',
            productPriceXof: 4500,
            lines: [{ itemId: 'itm_poulet', quantity: 1 }],
          },
          { token: owner },
        );
        assertStatus(duplicate, 409, 'Doublon refusé');
        assertEqual(duplicate.body.error.code, 'recipe_exists', 'Code recipe_exists');

        const created = await api(
          base,
          'POST',
          `${A}/inventory/recipes`,
          {
            productId: 'prd_sg_jus_gingembre',
            productName: 'Jus de gingembre',
            productPriceXof: 1200,
            lines: [
              { itemId: 'itm_sprite', quantity: 1 },
              { itemId: 'itm_mangue', quantity: 0.05 },
            ],
          },
          { token: owner },
        );
        assertStatus(created, 201, 'Recette créée');
        const recipeId = created.body.recipe.id as string;
        assertEqual(created.body.recipe.costXof, 490, 'Coût matière 490 XOF');
        assert(published.includes('RecipeCostChanged'), 'RecipeCostChanged publié');

        const updated = await api(
          base,
          'PATCH',
          `${A}/inventory/recipes/${recipeId}`,
          {
            productPriceXof: 1500,
            lines: [{ itemId: 'itm_sprite', quantity: 2 }],
          },
          { token: owner },
        );
        assertStatus(updated, 200, 'Recette mise à jour');
        assertEqual(updated.body.recipe.costXof, 900, 'Nouveau coût matière');
        assertEqual(updated.body.recipe.marginXof, 600, 'Marge recalculée');

        const foreign = await api(
          base,
          'POST',
          `${A}/inventory/recipes`,
          {
            productId: 'prd_test_cross',
            productName: 'Test',
            productPriceXof: 1000,
            lines: [{ itemId: baobabItemId, quantity: 1 }],
          },
          { token: owner },
        );
        assertStatus(foreign, 422, 'Ingrédient d’un autre établissement refusé');
      },
    },
    {
      name: 'Interne : disponibilité produit et COGS exposés aux autres services',
      run: async () => {
        const availability = await api(
          base,
          'GET',
          `/internal/tenants/${SAHEL}/inventory/availability?productIds=prd_sg_poulet,prd_sg_attieke`,
          undefined,
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(availability, 200, 'Disponibilité interrogée');
        assertEqual(availability.body.products.length, 2, 'Deux produits suivis');
        const poulet = availability.body.products.find(
          (entry: { productId: string }) => entry.productId === 'prd_sg_poulet',
        );
        const attieke = availability.body.products.find(
          (entry: { productId: string }) => entry.productId === 'prd_sg_attieke',
        );
        assertEqual(
          poulet.maxProducible,
          36,
          'Poulet produisible après perte de 2 kg (16,5 kg restants)',
        );
        assertEqual(attieke.maxProducible, 0, 'Attiéké bloqué par le poisson épuisé');

        const cogs = await api(
          base,
          'GET',
          `/internal/tenants/${SAHEL}/inventory/cogs`,
          undefined,
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(cogs, 200, 'COGS exposé');
        assert(cogs.body.cogsXof > 0, 'Coût des ventes positif');
        assert(cogs.body.movements >= 3, 'Mouvements de sortie comptés');
        const unauthorized = await api(
          base,
          'GET',
          `/internal/tenants/${SAHEL}/inventory/cogs`,
          undefined,
          {},
        );
        assertStatus(unauthorized, 401, 'Clé interne exigée');

        const summary = await api(base, 'GET', `${A}/inventory/summary`, undefined, {
          token: owner,
        });
        assertEqual(summary.body.waste30dXof > 0, true, 'Pertes 30 jours valorisées');
        assert(summary.body.lastCount !== null, 'Dernier inventaire exposé');
      },
    },
    {
      name: 'Audit : chaîne immuable et cloisonnée',
      run: async () => {
        const audit = await api(base, 'GET', `${A}/inventory/audit`, undefined, { token: owner });
        assertStatus(audit, 200, 'Journal exposé');
        assertEqual(audit.body.integrity, true, 'Chaîne intacte');
        const actions = audit.body.entries.map((entry: { action: string }) => entry.action);
        for (const expected of [
          'inventory.movement.in',
          'inventory.movement.waste',
          'inventory.movement.adjust',
          'inventory.count.validated',
          'inventory.purchase.received',
          'inventory.recipe.updated',
          'inventory.consumed',
        ]) {
          assert(actions.includes(expected), `Action auditée : ${expected}`);
        }
        assert(
          audit.body.entries.every((entry: { tenantId: string }) => entry.tenantId === SAHEL),
          'Filtré par tenant',
        );
        const foreignAudit = await api(
          base,
          'GET',
          `/api/v1/tenants/${BAOBAB}/inventory/audit`,
          undefined,
          { token: ownerBaobab },
        );
        assertEqual(foreignAudit.body.entries.length, 1, 'Audit Baobab isolé (création seule)');
        assert(
          !foreignAudit.body.entries.some(
            (entry: { tenantId: string }) => entry.tenantId === SAHEL,
          ),
          'Aucune fuite',
        );
      },
    },
  ];

  await runTests('inventory-service — stocks, fiches techniques et isolation', cases);
  await server.close();
  await orderServer.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log(`Événements publiés : ${[...new Set(published)].join(', ')}`);
  console.log(`Articles suivis : ${store.items.size} · mouvements : ${store.movements.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
