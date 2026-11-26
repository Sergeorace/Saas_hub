import {
  HttpError,
  asObject,
  optionalString,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import {
  alertsFor,
  applyMovement,
  consumeOrder,
  recipeCost,
  recipeMaxProducible,
  reorderSuggestions,
  round3,
  roundXof,
  type CountLine,
  type InventoryCount,
  type InventoryEvent,
  type InventoryStore,
  type MovementType,
  type PurchaseLine,
  type PurchaseOrder,
  type Recipe,
  type RecipeLine,
  type StockItem,
  type StockLocation,
  type StockUnit,
  type Supplier,
} from './store.js';

export interface InventoryAppOptions {
  store: InventoryStore;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

const UNITS: StockUnit[] = ['kg', 'g', 'l', 'cl', 'pcs', 'btl'];
const LOCATIONS: StockLocation[] = ['reserve', 'cuisine', 'bar'];
const MOVEMENT_TYPES: MovementType[] = ['in', 'out', 'adjust', 'waste'];

function nowIso(): string {
  return new Date().toISOString();
}

function numberField(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number; int?: boolean } = {},
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw HttpError.unprocessable('validation_error', `Nombre attendu pour ${field}.`, { field });
  }
  if (options.int && !Number.isInteger(value)) {
    throw HttpError.unprocessable('validation_error', `Entier attendu pour ${field}.`, { field });
  }
  if (options.min !== undefined && value < options.min) {
    throw HttpError.unprocessable('validation_error', `${field} doit être ≥ ${options.min}.`, { field });
  }
  if (options.max !== undefined && value > options.max) {
    throw HttpError.unprocessable('validation_error', `${field} doit être ≤ ${options.max}.`, { field });
  }
  return value;
}

function optionalNumber(source: Record<string, unknown>, field: string): number | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw HttpError.unprocessable('validation_error', `Nombre attendu pour ${field}.`, { field });
  }
  return value;
}

function dateBoundary(raw: string | null, endOfDay: boolean): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw HttpError.unprocessable('validation_error', 'Date attendue au format AAAA-MM-JJ.', { field: 'date' });
  }
  return `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
}

function serializeItem(item: StockItem) {
  return {
    ...item,
    low: item.quantity <= item.threshold,
    depleted: item.quantity <= 0,
    valueXof: roundXof(item.quantity * item.costXof),
  };
}

function serializeRecipe(store: InventoryStore, recipe: Recipe) {
  const cost = recipeCost(store, recipe);
  const price = recipe.productPriceXof;
  return {
    ...recipe,
    costXof: cost,
    marginXof: Math.max(0, price - cost),
    marginRate: price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0,
    maxProducible: recipeMaxProducible(store, recipe),
    lines: recipe.lines.map((line) => ({
      ...line,
      itemName: store.items.get(line.itemId)?.name ?? line.itemId,
      unit: store.items.get(line.itemId)?.unit ?? 'pcs',
      costXof: roundXof(line.quantity * (store.items.get(line.itemId)?.costXof ?? 0)),
    })),
  };
}

function parseRecipeLines(store: InventoryStore, tenantId: string, raw: unknown): RecipeLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw HttpError.unprocessable('validation_error', 'Au moins une ligne d’ingrédient est requise.', { field: 'lines' });
  }
  if (raw.length > 60) {
    throw HttpError.unprocessable('validation_error', '60 lignes maximum par fiche technique.', { field: 'lines' });
  }
  return raw.map((entry, index) => {
    const line = asObject(entry);
    const itemId = requireString(line, 'itemId', { max: 60 });
    const item = store.items.get(itemId);
    if (!item || item.tenantId !== tenantId) {
      throw HttpError.unprocessable('validation_error', 'Article de stock inconnu.', { field: `lines[${index}].itemId` });
    }
    return { itemId, quantity: numberField(line, 'quantity', { min: 0.001, max: 100000 }) };
  });
}

function loadItem(store: InventoryStore, tenantId: string, id: string): StockItem {
  const item = store.items.get(id);
  if (!item || item.tenantId !== tenantId) throw HttpError.notFound('Article de stock introuvable.');
  return item;
}

function loadRecipe(store: InventoryStore, tenantId: string, id: string): Recipe {
  const recipe = store.recipes.get(id);
  if (!recipe || recipe.tenantId !== tenantId) throw HttpError.notFound('Fiche technique introuvable.');
  return recipe;
}

function loadSupplier(store: InventoryStore, tenantId: string, id: string): Supplier {
  const supplier = store.suppliers.get(id);
  if (!supplier || supplier.tenantId !== tenantId) throw HttpError.notFound('Fournisseur introuvable.');
  return supplier;
}

export function buildInventoryApp(options: InventoryAppOptions): Route[] {
  const { store, publish } = options;

  const emit = async (tenantId: string, events: InventoryEvent[]) => {
    for (const event of events) await publish(event.type, tenantId, event.payload);
  };

  const movement = async (
    tenantId: string,
    actor: string,
    input: {
      itemId: string;
      type: MovementType;
      quantity: number;
      reason: string;
      unitCostXof?: number;
      refType?: string | null;
      refId?: string | null;
    },
  ) => {
    loadItem(store, tenantId, input.itemId);
    const result = applyMovement(store, { tenantId, actor, ...input });
    store.recordAudit({
      tenantId,
      actorId: actor,
      action: `inventory.movement.${input.type}`,
      targetType: 'stock_item',
      targetId: input.itemId,
      meta: { quantity: result.movement.quantity, reason: input.reason, costXof: result.movement.costXof },
    });
    await emit(tenantId, result.events);
    return result.movement;
  };

  return [
    /* ----------------------------- Synthèse ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/summary',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const items = [...store.items.values()].filter((item) => item.tenantId === tenantId);
        const alerts = alertsFor(store, tenantId);
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const waste = store.movements.filter(
          (entry) => entry.tenantId === tenantId && entry.type === 'waste' && entry.at >= monthAgo,
        );
        const counts = [...store.counts.values()].filter((entry) => entry.tenantId === tenantId);
        const lastCount = counts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        return {
          body: {
            tenantId,
            itemCount: items.length,
            lowStockCount: alerts.length,
            stockValueXof: items.reduce((sum, item) => sum + item.quantity * item.costXof, 0),
            waste30dXof: waste.reduce((sum, entry) => sum + Math.abs(entry.costXof), 0),
            supplierCount: [...store.suppliers.values()].filter((entry) => entry.tenantId === tenantId && entry.status === 'active').length,
            recipeCount: [...store.recipes.values()].filter((entry) => entry.tenantId === tenantId).length,
            countCount: counts.length,
            lastCount: lastCount
              ? { id: lastCount.id, date: lastCount.date, status: lastCount.status, varianceXof: lastCount.lines.reduce((sum, line) => sum + line.varianceCostXof, 0) }
              : null,
            alerts: alerts.slice(0, 6).map(serializeItem),
            generatedAt: nowIso(),
          },
        };
      },
    },

    /* ----------------------------- Articles ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/items',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const query = ctx.query.get('q')?.toLowerCase() ?? '';
        const category = ctx.query.get('category') ?? '';
        const items = [...store.items.values()]
          .filter((item) => item.tenantId === tenantId)
          .filter((item) => !query || item.name.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query))
          .filter((item) => !category || item.category === category)
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          body: {
            items: items.map((item) => ({
              ...serializeItem(item),
              supplierName: item.supplierId ? store.suppliers.get(item.supplierId)?.name ?? null : null,
            })),
            categories: [...new Set([...store.items.values()].filter((item) => item.tenantId === tenantId).map((item) => item.category))].sort(),
            units: UNITS,
            locations: LOCATIONS,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/items',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const unitRaw = requireString(body, 'unit', { max: 10 });
        if (!(UNITS as string[]).includes(unitRaw)) {
          throw HttpError.unprocessable('validation_error', 'Unité inconnue.', { field: 'unit' });
        }
        const locationRaw = optionalString(body, 'location', { max: 20 }) ?? 'reserve';
        if (!(LOCATIONS as string[]).includes(locationRaw)) {
          throw HttpError.unprocessable('validation_error', 'Emplacement inconnu.', { field: 'location' });
        }
        const supplierId = optionalString(body, 'supplierId', { max: 60 }) ?? null;
        if (supplierId) loadSupplier(store, tenantId, supplierId);
        const now = nowIso();
        const item: StockItem = {
          id: `itm_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          sku: requireString(body, 'sku', { min: 2, max: 30 }).toUpperCase(),
          unit: unitRaw as StockUnit,
          category: requireString(body, 'category', { min: 2, max: 30 }),
          quantity: optionalNumber(body, 'quantity') ?? 0,
          threshold: numberField(body, 'threshold', { min: 0 }),
          costXof: numberField(body, 'costXof', { min: 0, int: true }),
          supplierId,
          location: locationRaw as StockLocation,
          createdAt: now,
          updatedAt: now,
        };
        store.items.set(item.id, item);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.item.created',
          targetType: 'stock_item',
          targetId: item.id,
          meta: { name: item.name, quantity: item.quantity },
        });
        return { status: 201, body: { item: serializeItem(item) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/inventory/items/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const item = loadItem(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        if (body.name !== undefined) item.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.category !== undefined) item.category = requireString(body, 'category', { min: 2, max: 30 });
        if (body.threshold !== undefined) item.threshold = numberField(body, 'threshold', { min: 0 });
        if (body.costXof !== undefined) item.costXof = numberField(body, 'costXof', { min: 0, int: true });
        if (body.supplierId !== undefined) {
          const supplierId = optionalString(body, 'supplierId', { max: 60 }) ?? null;
          if (supplierId) loadSupplier(store, tenantId, supplierId);
          item.supplierId = supplierId;
        }
        if (body.location !== undefined) {
          const location = requireString(body, 'location', { max: 20 });
          if (!(LOCATIONS as string[]).includes(location)) {
            throw HttpError.unprocessable('validation_error', 'Emplacement inconnu.', { field: 'location' });
          }
          item.location = location as StockLocation;
        }
        item.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.item.updated',
          targetType: 'stock_item',
          targetId: item.id,
          meta: {},
        });
        return { body: { item: serializeItem(item) } };
      },
    },

    /* ----------------------------- Mouvements ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/movements',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const type = ctx.query.get('type') ?? '';
        const itemId = ctx.query.get('itemId') ?? '';
        const from = dateBoundary(ctx.query.get('from'), false);
        const to = dateBoundary(ctx.query.get('to'), true);
        const movements = store.movements
          .filter((entry) => entry.tenantId === tenantId)
          .filter((entry) => !type || entry.type === type)
          .filter((entry) => !itemId || entry.itemId === itemId)
          .filter((entry) => !from || entry.at >= from)
          .filter((entry) => !to || entry.at <= to)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 300);
        return { body: { movements, types: MOVEMENT_TYPES } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/movements',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const typeRaw = requireString(body, 'type', { max: 10 });
        if (!(MOVEMENT_TYPES as string[]).includes(typeRaw) || typeRaw === 'waste') {
          throw HttpError.unprocessable('validation_error', 'Type attendu : in, out ou adjust.', { field: 'type' });
        }
        const refType = optionalString(body, 'refType', { max: 30 }) ?? null;
        const refId = optionalString(body, 'refId', { max: 80 }) ?? null;
        const entry = await movement(tenantId, claims.sub, {
          itemId: requireString(body, 'itemId', { max: 60 }),
          type: typeRaw as MovementType,
          quantity:
            typeRaw === 'adjust'
              ? numberField(body, 'quantity', { min: -100000, max: 100000 })
              : numberField(body, 'quantity', { min: 0.001, max: 100000 }),
          reason: requireString(body, 'reason', { min: 2, max: 160 }),
          unitCostXof: optionalNumber(body, 'unitCostXof'),
          refType,
          refId,
        });
        return { status: 201, body: { movement: entry, item: serializeItem(loadItem(store, tenantId, entry.itemId)) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/waste',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const entry = await movement(tenantId, claims.sub, {
          itemId: requireString(body, 'itemId', { max: 60 }),
          type: 'waste',
          quantity: numberField(body, 'quantity', { min: 0.001, max: 100000 }),
          reason: requireString(body, 'reason', { min: 2, max: 160 }),
          refType: 'waste',
        });
        return { status: 201, body: { movement: entry, item: serializeItem(loadItem(store, tenantId, entry.itemId)) } };
      },
    },

    /* ----------------------------- Fiches techniques ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/recipes',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const recipes = [...store.recipes.values()]
          .filter((recipe) => recipe.tenantId === tenantId)
          .sort((a, b) => a.productName.localeCompare(b.productName))
          .map((recipe) => serializeRecipe(store, recipe));
        return { body: { recipes } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/recipes',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const productId = requireString(body, 'productId', { max: 60 });
        if ([...store.recipes.values()].some((entry) => entry.tenantId === tenantId && entry.productId === productId)) {
          throw HttpError.conflict('recipe_exists', 'Une fiche technique existe déjà pour ce produit.');
        }
        const now = nowIso();
        const recipe: Recipe = {
          id: `rec_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          productId,
          productName: requireString(body, 'productName', { min: 2, max: 80 }),
          productPriceXof: numberField(body, 'productPriceXof', { min: 0, int: true }),
          yieldQty: optionalNumber(body, 'yieldQty') ?? 1,
          lines: parseRecipeLines(store, tenantId, body.lines),
          createdAt: now,
          updatedAt: now,
          updatedBy: claims.sub,
        };
        store.recipes.set(recipe.id, recipe);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.recipe.created',
          targetType: 'recipe',
          targetId: recipe.id,
          meta: { productId, lines: recipe.lines.length },
        });
        await emit(tenantId, [
          {
            type: 'RecipeCostChanged',
            payload: { tenantId, recipeId: recipe.id, productId, costXof: recipeCost(store, recipe) },
          },
        ]);
        return { status: 201, body: { recipe: serializeRecipe(store, recipe) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/inventory/recipes/:id',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const recipe = loadRecipe(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const before = recipeCost(store, recipe);
        if (body.productName !== undefined) recipe.productName = requireString(body, 'productName', { min: 2, max: 80 });
        if (body.productPriceXof !== undefined) recipe.productPriceXof = numberField(body, 'productPriceXof', { min: 0, int: true });
        if (body.yieldQty !== undefined) recipe.yieldQty = numberField(body, 'yieldQty', { min: 0.1, max: 1000 });
        if (body.lines !== undefined) recipe.lines = parseRecipeLines(store, tenantId, body.lines);
        recipe.updatedAt = nowIso();
        recipe.updatedBy = claims.sub;
        const after = recipeCost(store, recipe);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.recipe.updated',
          targetType: 'recipe',
          targetId: recipe.id,
          meta: { costBefore: before, costAfter: after },
        });
        await emit(tenantId, [
          {
            type: 'RecipeCostChanged',
            payload: { tenantId, recipeId: recipe.id, productId: recipe.productId, costBeforeXof: before, costXof: after },
          },
        ]);
        return { body: { recipe: serializeRecipe(store, recipe) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/recipes/:id/cost',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const recipe = loadRecipe(store, tenantId, ctx.params.id ?? '');
        return { body: serializeRecipe(store, recipe) };
      },
    },

    /* ----------------------------- Fournisseurs ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/suppliers',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const suppliers = [...store.suppliers.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => a.name.localeCompare(b.name));
        return { body: { suppliers } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/suppliers',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const now = nowIso();
        const supplier: Supplier = {
          id: `sup_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          contactName: optionalString(body, 'contactName', { max: 80 }) ?? null,
          phone: optionalString(body, 'phone', { max: 30 }) ?? null,
          email: optionalString(body, 'email', { max: 120 }) ?? null,
          termsDays: optionalNumber(body, 'termsDays') ?? 0,
          notes: optionalString(body, 'notes', { max: 300 }) ?? null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        store.suppliers.set(supplier.id, supplier);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.supplier.created',
          targetType: 'supplier',
          targetId: supplier.id,
          meta: { name: supplier.name },
        });
        return { status: 201, body: { supplier } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/inventory/suppliers/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const supplier = loadSupplier(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        if (body.name !== undefined) supplier.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.contactName !== undefined) supplier.contactName = optionalString(body, 'contactName', { max: 80 }) ?? null;
        if (body.phone !== undefined) supplier.phone = optionalString(body, 'phone', { max: 30 }) ?? null;
        if (body.email !== undefined) supplier.email = optionalString(body, 'email', { max: 120 }) ?? null;
        if (body.termsDays !== undefined) supplier.termsDays = numberField(body, 'termsDays', { min: 0, max: 120 });
        if (body.notes !== undefined) supplier.notes = optionalString(body, 'notes', { max: 300 }) ?? null;
        if (body.status !== undefined) {
          const status = requireString(body, 'status', { max: 10 });
          if (!['active', 'inactive'].includes(status)) {
            throw HttpError.unprocessable('validation_error', 'Statut inconnu.', { field: 'status' });
          }
          supplier.status = status as Supplier['status'];
        }
        supplier.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.supplier.updated',
          targetType: 'supplier',
          targetId: supplier.id,
          meta: {},
        });
        return { body: { supplier } };
      },
    },

    /* ----------------------------- Commandes d'achat ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/purchase-orders',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const orders = [...store.purchaseOrders.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { body: { purchaseOrders: orders } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/purchase-orders',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const supplier = loadSupplier(store, tenantId, requireString(body, 'supplierId', { max: 60 }));
        const rawLines = body.lines;
        if (!Array.isArray(rawLines) || rawLines.length === 0) {
          throw HttpError.unprocessable('validation_error', 'Au moins une ligne est requise.', { field: 'lines' });
        }
        const lines: PurchaseLine[] = rawLines.map((entry) => {
          const line = asObject(entry);
          const item = loadItem(store, tenantId, requireString(line, 'itemId', { max: 60 }));
          const quantity = numberField(line, 'quantity', { min: 0.001, max: 100000 });
          const unitCostXof = numberField(line, 'unitCostXof', { min: 0, int: true });
          return {
            itemId: item.id,
            itemName: item.name,
            quantity,
            unitCostXof,
            lineTotalXof: roundXof(quantity * unitCostXof),
          };
        });
        const count = [...store.purchaseOrders.values()].filter((entry) => entry.tenantId === tenantId).length + 1;
        const order: PurchaseOrder = {
          id: `po_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          supplierId: supplier.id,
          supplierName: supplier.name,
          number: `CMD-${String(count).padStart(4, '0')}`,
          status: 'commandee',
          lines,
          totalXof: lines.reduce((sum, line) => sum + line.lineTotalXof, 0),
          createdAt: nowIso(),
          receivedAt: null,
          receivedBy: null,
        };
        store.purchaseOrders.set(order.id, order);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.purchase.created',
          targetType: 'purchase_order',
          targetId: order.id,
          meta: { supplier: supplier.name, totalXof: order.totalXof },
        });
        return { status: 201, body: { purchaseOrder: order } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/purchase-orders/:id/receive',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const order = store.purchaseOrders.get(ctx.params.id ?? '');
        if (!order || order.tenantId !== tenantId) throw HttpError.notFound('Commande d’achat introuvable.');
        if (order.status === 'recue') throw HttpError.conflict('order_received', 'Cette commande a déjà été réceptionnée.');
        for (const line of order.lines) {
          const result = applyMovement(store, {
            tenantId,
            itemId: line.itemId,
            type: 'in',
            quantity: line.quantity,
            unitCostXof: line.unitCostXof,
            reason: `Réception ${order.number}`,
            refType: 'purchase',
            refId: order.id,
            actor: claims.sub,
          });
          await emit(tenantId, result.events);
        }
        order.status = 'recue';
        order.receivedAt = nowIso();
        order.receivedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.purchase.received',
          targetType: 'purchase_order',
          targetId: order.id,
          meta: { totalXof: order.totalXof, lines: order.lines.length },
        });
        await emit(tenantId, [
          { type: 'PurchaseOrderReceived', payload: { tenantId, purchaseOrderId: order.id, totalXof: order.totalXof } },
        ]);
        return { body: { purchaseOrder: order } };
      },
    },

    /* ----------------------------- Inventaires ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/counts',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const counts = [...store.counts.values()]
          .filter((entry) => entry.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { body: { counts } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/counts',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const body = asObject(ctx.body);
        const rawLines = body.lines;
        if (!Array.isArray(rawLines) || rawLines.length === 0) {
          throw HttpError.unprocessable('validation_error', 'Au moins une ligne de comptage est requise.', { field: 'lines' });
        }
        const lines: CountLine[] = rawLines.map((entry) => {
          const line = asObject(entry);
          const item = loadItem(store, tenantId, requireString(line, 'itemId', { max: 60 }));
          const counted = numberField(line, 'counted', { min: 0, max: 100000 });
          const variance = round3(counted - item.quantity);
          return {
            itemId: item.id,
            itemName: item.name,
            unit: item.unit,
            expected: item.quantity,
            counted,
            variance,
            varianceCostXof: roundXof(variance * item.costXof),
          };
        });
        const count: InventoryCount = {
          id: `cnt_${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          date: optionalString(body, 'date', { max: 10 }) ?? nowIso().slice(0, 10),
          status: 'brouillon',
          lines,
          createdBy: claims.sub,
          createdAt: nowIso(),
          validatedBy: null,
          validatedAt: null,
        };
        store.counts.set(count.id, count);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.count.created',
          targetType: 'inventory_count',
          targetId: count.id,
          meta: { lines: lines.length },
        });
        return { status: 201, body: { count } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/inventory/counts/:id/validate',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'inventory:manage');
        const count = store.counts.get(ctx.params.id ?? '');
        if (!count || count.tenantId !== tenantId) throw HttpError.notFound('Inventaire introuvable.');
        if (count.status === 'valide') throw HttpError.conflict('count_validated', 'Cet inventaire est déjà validé.');
        for (const line of count.lines) {
          if (line.variance === 0) continue;
          const result = applyMovement(store, {
            tenantId,
            itemId: line.itemId,
            type: 'adjust',
            quantity: line.variance,
            reason: `Ajustement inventaire ${count.date}`,
            refType: 'inventory_count',
            refId: count.id,
            actor: claims.sub,
          });
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'inventory.movement.adjust',
            targetType: 'stock_item',
            targetId: line.itemId,
            meta: { quantity: line.variance, reason: `Inventaire ${count.date}`, varianceCostXof: line.varianceCostXof },
          });
          await emit(tenantId, result.events);
        }
        count.status = 'valide';
        count.validatedBy = claims.sub;
        count.validatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'inventory.count.validated',
          targetType: 'inventory_count',
          targetId: count.id,
          meta: {
            lines: count.lines.length,
            varianceXof: count.lines.reduce((sum, line) => sum + line.varianceCostXof, 0),
          },
        });
        await emit(tenantId, [
          {
            type: 'InventoryCountValidated',
            payload: {
              tenantId,
              countId: count.id,
              lines: count.lines.length,
              varianceXof: count.lines.reduce((sum, line) => sum + line.varianceCostXof, 0),
            },
          },
        ]);
        return { body: { count } };
      },
    },

    /* ----------------------------- Alertes ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/alerts',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        return {
          body: {
            alerts: alertsFor(store, tenantId).map((item) => ({
              ...serializeItem(item),
              supplierName: item.supplierId ? store.suppliers.get(item.supplierId)?.name ?? null : null,
            })),
            suggestions: reorderSuggestions(store, tenantId),
          },
        };
      },
    },

    /* ----------------------------- Audit ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/inventory/audit',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'inventory:view');
        const entries = store.audit.filter((entry) => entry.tenantId === tenantId).slice(-100).reverse();
        return { body: { entries, integrity: verifyAuditChain(store.audit), generatedAt: nowIso() } };
      },
    },

    /* ----------------------------- Interne ----------------------------- */
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/inventory/availability',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const ids = (ctx.query.get('productIds') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
        const wanted = ids.length > 0 ? ids : null;
        const recipes = [...store.recipes.values()].filter(
          (recipe) => recipe.tenantId === tenantId && (!wanted || wanted.includes(recipe.productId)),
        );
        return {
          body: {
            tenantId,
            products: recipes.map((recipe) => ({
              productId: recipe.productId,
              maxProducible: recipeMaxProducible(store, recipe),
            })),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/inventory/cogs',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const from = dateBoundary(ctx.query.get('from'), false);
        const to = dateBoundary(ctx.query.get('to'), true);
        const movements = store.movements.filter(
          (entry) =>
            entry.tenantId === tenantId &&
            (entry.type === 'out' || entry.type === 'waste') &&
            (!from || entry.at >= from) &&
            (!to || entry.at <= to),
        );
        return {
          body: {
            tenantId,
            cogsXof: movements.reduce((sum, entry) => sum + Math.abs(entry.costXof), 0),
            movements: movements.length,
          },
        };
      },
    },
  ];
}

export interface OrderLineReader {
  (tenantId: string, orderId: string): Promise<Array<{ productId: string; quantity: number }> | null>;
}

export function createOrderLineReader(orders: ServiceClient): OrderLineReader {
  return async (tenantId, orderId) => {
    try {
      const detail = await orders.get<{
        order: { lines?: Array<{ productId: string; quantity: number }> };
      }>(`/internal/tenants/${tenantId}/orders/${orderId}`);
      return detail.order.lines ?? [];
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  };
}

export async function handleInventoryEvent(
  store: InventoryStore,
  tenantId: string,
  event: { type: string; payload: Record<string, unknown> },
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>,
  readLines: OrderLineReader,
): Promise<void> {
  if (event.type !== 'OrderPaid') return;
  const orderId = typeof event.payload.orderId === 'string' ? event.payload.orderId : '';
  if (!orderId || store.handledOrders.has(`${tenantId}::${orderId}`)) return;
  const lines = await readLines(tenantId, orderId);
  if (!lines) return;
  const events = consumeOrder(store, tenantId, { orderId, lines });
  for (const entry of events) await publish(entry.type, tenantId, entry.payload);
}
