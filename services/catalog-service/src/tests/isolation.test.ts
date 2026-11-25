import {
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
import { buildCatalogApp } from '../app.js';
import { createCatalogStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';

function claims(
  sub: string,
  tenantPermissions: Record<string, string[]>,
  platformPermissions: string[] = [],
): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name: sub,
    mfa: false,
    platformRoles: [],
    platformPermissions,
    tenantPermissions,
  };
}

async function main() {
  const store = createCatalogStore();
  const bus = createEventBus({ name: 'catalog-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };

  const ownerA = register(
    'token-owner-a',
    claims('usr_owner_a', { tnt_alpha: ['catalog:view', 'catalog:manage', 'catalog:availability', 'audit:view'] }),
  );
  const ownerB = register(
    'token-owner-b',
    claims('usr_owner_b', { tnt_beta: ['catalog:view', 'catalog:manage', 'catalog:availability', 'audit:view'] }),
  );
  const waiterA = register('token-waiter-a', claims('usr_waiter_a', { tnt_alpha: ['catalog:view'] }));

  const server = await startServer(
    {
      name: 'catalog-service-test',
      routes: [
        ...buildCatalogApp({
          store,
          timeZone: 'Africa/Lome',
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
  const a = '/api/v1/tenants/tnt_alpha/catalog';
  const b = '/api/v1/tenants/tnt_beta/catalog';

  const createCategory = async (token: string, root: string, name: string) => {
    const result = await api(base, 'POST', `${root}/categories`, { name }, { token });
    assertStatus(result, 201, `Création catégorie ${name}`);
    return result.body.category.id as string;
  };

  const createProduct = async (
    token: string,
    root: string,
    categoryId: string,
    body: Record<string, unknown> = {},
  ) => {
    const result = await api(
      base,
      'POST',
      `${root}/products`,
      { categoryId, name: 'Poulet braisé', basePriceXof: 4500, ...body },
      { token },
    );
    assertStatus(result, 201, 'Création produit');
    return result.body.product;
  };

  const alphaCategory = await createCategory(ownerA, a, 'Grillades');
  const alphaProduct = await createProduct(ownerA, a, alphaCategory);

  const cases: TestCase[] = [
    {
      name: 'Catalogue : création catégorie + produit, prix effectif et disponibilité visibles',
      run: async () => {
        assertEqual(alphaProduct.effectivePriceXof, 4500, 'Prix effectif initial');
        assertEqual(alphaProduct.availability.available, true, 'Produit disponible par défaut');
        const snapshot = await api(base, 'GET', a, undefined, { token: ownerA });
        assertStatus(snapshot, 200, 'Snapshot catalogue');
        assertEqual(snapshot.body.products.length, 1, 'Un produit dans le snapshot');
        assertEqual(snapshot.body.categories.length, 1, 'Une catégorie dans le snapshot');
      },
    },
    {
      name: 'Isolation : la lecture du catalogue de Beta par Alpha est refusée',
      run: async () => {
        const crossRead = await api(base, 'GET', b, undefined, { token: ownerA });
        assertStatus(crossRead, 403, 'Alpha ne lit pas le catalogue de Beta');
        const crossProduct = await api(base, 'GET', `${a}/products/${alphaProduct.id}`, undefined, {
          token: ownerB,
        });
        assert(crossProduct.status === 403 || crossProduct.status === 404, 'Produit Alpha inaccessible à Beta');
      },
    },
    {
      name: 'Isolation : un produit Alpha ne peut pas être modifié via le chemin Beta',
      run: async () => {
        const patch = await api(
          base,
          'PATCH',
          `${b}/products/${alphaProduct.id}`,
          { name: 'Piratage' },
          { token: ownerB },
        );
        assertStatus(patch, 404, 'Produit Alpha absent du catalogue Beta');
        const still = await api(base, 'GET', a, undefined, { token: ownerA });
        assertEqual(still.body.products[0].name, 'Poulet braisé', 'Produit Alpha intact');
      },
    },
    {
      name: 'RBAC : le serveur peut consulter mais pas créer un produit',
      run: async () => {
        const read = await api(base, 'GET', a, undefined, { token: waiterA });
        assertStatus(read, 200, 'Lecture autorisée pour le serveur');
        const write = await api(
          base,
          'POST',
          `${a}/products`,
          { categoryId: alphaCategory, name: 'Test', basePriceXof: 1000 },
          { token: waiterA },
        );
        assertStatus(write, 403, 'Création refusée au serveur');
      },
    },
    {
      name: 'Happy hour : le prix effectif applique la plage horaire active',
      run: async () => {
        const product = await createProduct(ownerA, a, alphaCategory, {
          name: 'Bissap',
          basePriceXof: 2000,
          priceRules: [
            {
              label: 'Happy hour',
              days: ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'],
              start: '00:00',
              end: '23:59',
              priceXof: 1500,
            },
          ],
        });
        assertEqual(product.effectivePriceXof, 1500, 'Prix happy hour appliqué');
        assertEqual(product.activePriceRule?.label, 'Happy hour', 'Plage active exposée');
        const snapshot = await api(base, 'GET', a, undefined, { token: ownerA });
        const listed = snapshot.body.products.find((entry: { id: string }) => entry.id === product.id);
        assertEqual(listed.effectivePriceXof, 1500, 'Prix recalculé dans le snapshot');
      },
    },
    {
      name: 'Validation : allergène inconnu et variante négative refusés',
      run: async () => {
        const badAllergen = await api(
          base,
          'POST',
          `${a}/products`,
          { categoryId: alphaCategory, name: 'X', basePriceXof: 100, allergens: ['kryptonite'] },
          { token: ownerA },
        );
        assertStatus(badAllergen, 422, 'Allergène inconnu refusé');
        const badVariant = await api(
          base,
          'POST',
          `${a}/products`,
          { categoryId: alphaCategory, name: 'Y', basePriceXof: 100, variants: [{ name: 'Grand', priceXof: -1 }] },
          { token: ownerA },
        );
        assertStatus(badVariant, 422, 'Prix de variante négatif refusé');
      },
    },
    {
      name: 'Disponibilité temps réel : bascule 86 + événement CatalogItemUpdated',
      run: async () => {
        const patch = await api(
          base,
          'PATCH',
          `${a}/products/${alphaProduct.id}/availability`,
          { available: false, reason: 'Rupture de poulet' },
          { token: ownerA },
        );
        assertStatus(patch, 200, 'Bascule de disponibilité');
        assertEqual(patch.body.product.availability.available, false, 'Produit indisponible');
        const events = bus.outbox().filter((event) => event.type === 'CatalogItemUpdated');
        const event = events[events.length - 1];
        assert(event, 'Événement CatalogItemUpdated publié');
        assertEqual(event.payload.change, 'availability', 'Type de changement availability');
        assertEqual(event.payload.available, false, 'Disponibilité dans l’événement');
        assertEqual(event.tenantId, 'tnt_alpha', 'Tenant porté par l’événement');
      },
    },
    {
      name: 'Audit immuable : la bascule de disponibilité est tracée et la chaîne reste intègre',
      run: async () => {
        const audit = await api(base, 'GET', `${a}/audit`, undefined, { token: ownerA });
        assertStatus(audit, 200, 'Lecture du journal');
        assertEqual(audit.body.integrity, true, 'Chaîne d’audit intègre');
        assert(
          audit.body.entries.some((entry: { action: string }) => entry.action === 'catalog.product.availability_changed'),
          'Entrée d’audit de disponibilité présente',
        );
        const crossAudit = await api(base, 'GET', `${b}/audit`, undefined, { token: ownerA });
        assertStatus(crossAudit, 403, 'Audit de Beta inaccessible à Alpha');
      },
    },
    {
      name: 'Prix : modification de prix tracée dans l’audit avec l’avant/après',
      run: async () => {
        const patch = await api(
          base,
          'PATCH',
          `${a}/products/${alphaProduct.id}`,
          { basePriceXof: 5000 },
          { token: ownerA },
        );
        assertStatus(patch, 200, 'Modification du prix');
        const audit = await api(base, 'GET', `${a}/audit`, undefined, { token: ownerA });
        const entry = audit.body.entries.find(
          (item: { action: string }) => item.action === 'catalog.product.price_changed',
        );
        assert(entry, 'Audit de changement de prix présent');
        assertEqual(entry.meta.before.basePriceXof, 4500, 'Ancien prix conservé');
        assertEqual(entry.meta.after.basePriceXof, 5000, 'Nouveau prix conservé');
      },
    },
    {
      name: 'Promotions : pourcentage valide, code unique et périmètre produit contrôlé',
      run: async () => {
        const created = await api(
          base,
          'POST',
          `${a}/promotions`,
          {
            name: 'Étudiants',
            code: 'ETUD10',
            type: 'percent',
            value: 10,
            scope: 'all',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2027-12-31T23:59:59.000Z',
          },
          { token: ownerA },
        );
        assertStatus(created, 201, 'Création promotion');
        const duplicate = await api(
          base,
          'POST',
          `${a}/promotions`,
          {
            name: 'Doublon',
            code: 'ETUD10',
            type: 'percent',
            value: 5,
            scope: 'all',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2027-12-31T23:59:59.000Z',
          },
          { token: ownerA },
        );
        assertStatus(duplicate, 409, 'Code promotionnel en doublon refusé');
        const tooMuch = await api(
          base,
          'POST',
          `${a}/promotions`,
          {
            name: 'Trop',
            type: 'percent',
            value: 120,
            scope: 'all',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2027-12-31T23:59:59.000Z',
          },
          { token: ownerA },
        );
        assertStatus(tooMuch, 422, 'Pourcentage > 100 refusé');
        const crossTarget = await api(
          base,
          'POST',
          `${a}/promotions`,
          {
            name: 'Croisée',
            type: 'amount',
            value: 500,
            scope: 'product',
            targetId: 'prd_beta_inconnu',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2027-12-31T23:59:59.000Z',
          },
          { token: ownerA },
        );
        assertStatus(crossTarget, 404, 'Produit cible hors tenant refusé');
      },
    },
    {
      name: 'Menus composés : composition valide, variante contrôlée, produit étranger refusé',
      run: async () => {
        const menu = await api(
          base,
          'POST',
          `${a}/menus`,
          {
            name: 'Formule midi',
            priceXof: 5500,
            items: [
              {
                productId: alphaProduct.id,
                quantity: 1,
                variantId: alphaProduct.variants[0]?.id,
              },
              { productId: (await api(base, 'GET', a, undefined, { token: ownerA })).body.products[1].id, quantity: 1 },
            ],
          },
          { token: ownerA },
        );
        assertStatus(menu, 201, 'Création menu composé');
        const foreign = await api(
          base,
          'POST',
          `${a}/menus`,
          { name: 'Menu pirate', priceXof: 1000, items: [{ productId: 'prd_inexistant', quantity: 1 }] },
          { token: ownerA },
        );
        assertStatus(foreign, 404, 'Produit étranger refusé dans un menu');
      },
    },
    {
      name: 'Menu public : accessible sans jeton, masque les produits désactivés',
      run: async () => {
        const before = await api(base, 'GET', '/api/v1/public/tenants/tnt_alpha/menu');
        assertStatus(before, 200, 'Menu public accessible');
        assert(before.body.categories.length > 0, 'Catégories publiques présentes');
        assertEqual(before.body.promotions[0]?.code, 'ETUD10', 'Promotion active publiée');
        await api(base, 'PATCH', `${a}/products/${alphaProduct.id}`, { active: false }, { token: ownerA });
        const after = await api(base, 'GET', '/api/v1/public/tenants/tnt_alpha/menu');
        const names = after.body.categories.flatMap((category: { products: { id: string }[] }) =>
          category.products.map((product) => product.id),
        );
        assert(!names.includes(alphaProduct.id), 'Produit désactivé absent du menu public');
      },
    },
    {
      name: 'Isolation : la synthèse interne ne franchit pas la frontière de tenant',
      run: async () => {
        const alpha = await api(base, 'GET', '/internal/tenants/tnt_alpha/catalog/summary', undefined, {
          internalKey: INTERNAL_KEY,
        });
        assertStatus(alpha, 200, 'Synthèse Alpha');
        assert(alpha.body.products >= 2, 'Produits Alpha comptés');
        const beta = await api(base, 'GET', '/internal/tenants/tnt_beta/catalog/summary', undefined, {
          internalKey: INTERNAL_KEY,
        });
        assertEqual(beta.body.products, 0, 'Aucun produit Beta');
        const forbidden = await api(base, 'GET', '/internal/tenants/tnt_alpha/catalog/summary');
        assertStatus(forbidden, 401, 'Synthèse interne protégée par clé de service');
      },
    },
  ];

  await runTests('CATALOG-SERVICE — produits, prix, promotions et isolation multi-tenant', cases);
  await server.close();
}

await main();
