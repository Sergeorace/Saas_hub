import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';

export type StockUnit = 'kg' | 'g' | 'l' | 'cl' | 'pcs' | 'btl';
export type StockLocation = 'reserve' | 'cuisine' | 'bar';
export type MovementType = 'in' | 'out' | 'adjust' | 'waste';

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  termsDays: number;
  notes: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface StockItem {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  unit: StockUnit;
  category: string;
  quantity: number;
  threshold: number;
  costXof: number;
  supplierId: string | null;
  location: StockLocation;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeLine {
  itemId: string;
  quantity: number;
}

export interface Recipe {
  id: string;
  tenantId: string;
  productId: string;
  productName: string;
  productPriceXof: number;
  yieldQty: number;
  lines: RecipeLine[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StockMovement {
  id: string;
  tenantId: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  quantity: number;
  costXof: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  actor: string;
  at: string;
}

export interface CountLine {
  itemId: string;
  itemName: string;
  unit: StockUnit;
  expected: number;
  counted: number;
  variance: number;
  varianceCostXof: number;
}

export interface InventoryCount {
  id: string;
  tenantId: string;
  date: string;
  status: 'brouillon' | 'valide';
  lines: CountLine[];
  createdBy: string;
  createdAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
}

export interface PurchaseLine {
  itemId: string;
  itemName: string;
  quantity: number;
  unitCostXof: number;
  lineTotalXof: number;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName: string;
  number: string;
  status: 'brouillon' | 'commandee' | 'recue';
  lines: PurchaseLine[];
  totalXof: number;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface InventoryEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface InventoryStore {
  suppliers: Map<string, Supplier>;
  items: Map<string, StockItem>;
  recipes: Map<string, Recipe>;
  movements: StockMovement[];
  counts: Map<string, InventoryCount>;
  purchaseOrders: Map<string, PurchaseOrder>;
  audit: AuditEntry[];
  handledOrders: Set<string>;
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export function createInventoryStore(): InventoryStore {
  const store: InventoryStore = {
    suppliers: new Map(),
    items: new Map(),
    recipes: new Map(),
    movements: [],
    counts: new Map(),
    purchaseOrders: new Map(),
    audit: [],
    handledOrders: new Set(),
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
  };
  return store;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundXof(value: number): number {
  return Math.round(value);
}

export function thresholdEvents(item: StockItem, before: number): InventoryEvent[] {
  const events: InventoryEvent[] = [];
  const after = item.quantity;
  const wasLow = before <= item.threshold;
  const isLow = after <= item.threshold;
  if (after <= 0) {
    events.push({
      type: 'StockDepleted',
      payload: { tenantId: item.tenantId, itemId: item.id, name: item.name, unit: item.unit },
    });
  } else if (!wasLow && isLow) {
    events.push({
      type: 'StockBelowThreshold',
      payload: {
        tenantId: item.tenantId,
        itemId: item.id,
        name: item.name,
        quantity: after,
        threshold: item.threshold,
        unit: item.unit,
      },
    });
  } else if (wasLow && !isLow) {
    events.push({
      type: 'StockReplenished',
      payload: {
        tenantId: item.tenantId,
        itemId: item.id,
        name: item.name,
        quantity: after,
        unit: item.unit,
      },
    });
  }
  return events;
}

export function applyMovement(
  store: InventoryStore,
  input: {
    tenantId: string;
    itemId: string;
    type: MovementType;
    quantity: number;
    reason: string;
    unitCostXof?: number;
    refType?: string | null;
    refId?: string | null;
    actor: string;
  },
): { movement: StockMovement; events: InventoryEvent[] } {
  const item = store.items.get(input.itemId);
  if (!item || item.tenantId !== input.tenantId) throw new Error('item_not_found');
  const before = item.quantity;
  const now = nowIso();
  const signed = input.type === 'adjust' ? input.quantity : Math.abs(input.quantity);
  const delta = input.type === 'in' ? signed : input.type === 'adjust' ? signed : -signed;
  const next = round3(Math.max(0, before + delta));
  let unitCost = item.costXof;
  if (input.type === 'in' && signed > 0) {
    const incomingCost = input.unitCostXof ?? item.costXof;
    const totalValue = before * item.costXof + signed * incomingCost;
    unitCost = roundXof(before + signed > 0 ? totalValue / (before + signed) : incomingCost);
  }
  const applied = round3(next - before);
  const cost = roundXof(Math.abs(applied) * unitCost);
  item.quantity = next;
  item.costXof = unitCost;
  item.updatedAt = now;
  const movement: StockMovement = {
    id: newId('mov'),
    tenantId: input.tenantId,
    itemId: item.id,
    itemName: item.name,
    type: input.type,
    quantity: applied,
    costXof: cost,
    reason: input.reason,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    actor: input.actor,
    at: now,
  };
  store.movements.push(movement);
  const events: InventoryEvent[] = thresholdEvents(item, before);
  if (input.type === 'waste') {
    events.push({
      type: 'WasteRecorded',
      payload: {
        tenantId: input.tenantId,
        itemId: item.id,
        name: item.name,
        quantity: Math.abs(applied),
        costXof: cost,
        reason: input.reason,
      },
    });
  }
  return { movement, events };
}

export function recipeCost(store: InventoryStore, recipe: Recipe): number {
  let total = 0;
  for (const line of recipe.lines) {
    const item = store.items.get(line.itemId);
    if (!item || item.tenantId !== recipe.tenantId) continue;
    total += line.quantity * item.costXof;
  }
  return roundXof(total / Math.max(1, recipe.yieldQty));
}

export function recipeMaxProducible(store: InventoryStore, recipe: Recipe): number | null {
  if (recipe.lines.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const line of recipe.lines) {
    const item = store.items.get(line.itemId);
    if (!item) return 0;
    if (line.quantity <= 0) continue;
    min = Math.min(min, Math.floor((item.quantity / line.quantity) * recipe.yieldQty));
  }
  return Number.isFinite(min) ? min : null;
}

export function alertsFor(store: InventoryStore, tenantId: string): StockItem[] {
  return [...store.items.values()]
    .filter((item) => item.tenantId === tenantId && item.quantity <= item.threshold)
    .sort((a, b) => a.quantity / Math.max(1, a.threshold) - b.quantity / Math.max(1, b.threshold));
}

export function reorderSuggestions(store: InventoryStore, tenantId: string) {
  return alertsFor(store, tenantId).map((item) => {
    const target = Math.max(item.threshold * 2, item.threshold + 1);
    const quantity = round3(Math.max(0, target - item.quantity));
    const supplier = item.supplierId ? store.suppliers.get(item.supplierId) : undefined;
    return {
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      quantity,
      estimatedCostXof: roundXof(quantity * item.costXof),
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
    };
  });
}

export function consumeOrder(
  store: InventoryStore,
  tenantId: string,
  payload: Record<string, unknown>,
): InventoryEvent[] {
  const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
  if (!orderId || store.handledOrders.has(`${tenantId}::${orderId}`)) return [];
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) return [];
  const events: InventoryEvent[] = [];
  const consumedByRecipe = new Map<string, number>();
  for (const entry of lines) {
    if (typeof entry !== 'object' || entry === null) continue;
    const line = entry as Record<string, unknown>;
    const productId = typeof line.productId === 'string' ? line.productId : '';
    const quantity = typeof line.quantity === 'number' ? line.quantity : 0;
    if (!productId || quantity <= 0) continue;
    const recipe = [...store.recipes.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.productId === productId,
    );
    if (!recipe) continue;
    consumedByRecipe.set(recipe.id, (consumedByRecipe.get(recipe.id) ?? 0) + quantity);
  }
  for (const [recipeId, soldQty] of consumedByRecipe) {
    const recipe = store.recipes.get(recipeId);
    if (!recipe) continue;
    for (const line of recipe.lines) {
      const item = store.items.get(line.itemId);
      if (!item || item.tenantId !== tenantId) continue;
      const qty = round3((soldQty / Math.max(1, recipe.yieldQty)) * line.quantity);
      if (qty <= 0) continue;
      const result = applyMovement(store, {
        tenantId,
        itemId: item.id,
        type: 'out',
        quantity: qty,
        reason: `Vente commande ${orderId}`,
        refType: 'order',
        refId: orderId,
        actor: 'order-service',
      });
      events.push(...result.events);
    }
  }
  store.handledOrders.add(`${tenantId}::${orderId}`);
  store.recordAudit({
    tenantId,
    actorId: 'order-service',
    action: 'inventory.consumed',
    targetType: 'order',
    targetId: orderId,
    meta: { recipes: consumedByRecipe.size },
  });
  return events;
}

export function seedInventoryDemo(store: InventoryStore): void {
  if (store.items.size > 0) return;
  const tenantId = 'tnt_sahelgrill';
  const now = nowIso();
  const supplier = (
    id: string,
    name: string,
    contact: string,
    phone: string,
    terms: number,
  ): Supplier => ({
    id,
    tenantId,
    name,
    contactName: contact,
    phone,
    email: null,
    termsDays: terms,
    notes: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  const suppliers = [
    supplier('sup_marche', 'Marché Adawlato', 'Mme Adjo', '+228 90 11 22 33', 0),
    supplier('sup_golfe', 'Brasserie du Golfe', 'M. Koffi', '+228 22 21 30 00', 15),
    supplier('sup_agrisud', 'Ferme AgriSud', 'Mme Afi', '+228 91 55 66 77', 7),
  ];
  for (const entry of suppliers) store.suppliers.set(entry.id, entry);

  const item = (
    id: string,
    name: string,
    sku: string,
    unit: StockUnit,
    category: string,
    quantity: number,
    threshold: number,
    costXof: number,
    supplierId: string,
    location: StockLocation,
  ): StockItem => ({
    id,
    tenantId,
    name,
    sku,
    unit,
    category,
    quantity,
    threshold,
    costXof,
    supplierId,
    location,
    createdAt: now,
    updatedAt: now,
  });
  const items = [
    item(
      'itm_poulet',
      'Poulet fermier',
      'VOL-POU-01',
      'kg',
      'viande',
      18.5,
      12,
      2400,
      'sup_agrisud',
      'cuisine',
    ),
    item(
      'itm_boeuf',
      'Viande de bœuf',
      'VOL-BOE-01',
      'kg',
      'viande',
      9.2,
      8,
      3200,
      'sup_agrisud',
      'cuisine',
    ),
    item(
      'itm_poisson',
      'Poisson (tilapia)',
      'MER-TIL-01',
      'kg',
      'poisson',
      6.4,
      6,
      2800,
      'sup_agrisud',
      'cuisine',
    ),
    item(
      'itm_attieke',
      'Attiéké frais',
      'FEC-ATT-01',
      'kg',
      'accompagnement',
      14.0,
      10,
      900,
      'sup_marche',
      'cuisine',
    ),
    item(
      'itm_riz',
      'Riz parfumé',
      'FEC-RIZ-01',
      'kg',
      'accompagnement',
      42.0,
      20,
      650,
      'sup_marche',
      'reserve',
    ),
    item(
      'itm_tomate',
      'Tomates fraîches',
      'LEG-TOM-01',
      'kg',
      'legume',
      7.5,
      8,
      550,
      'sup_marche',
      'cuisine',
    ),
    item(
      'itm_oignon',
      'Oignons',
      'LEG-OIG-01',
      'kg',
      'legume',
      11.0,
      8,
      450,
      'sup_marche',
      'cuisine',
    ),
    item(
      'itm_huile',
      'Huile végétale',
      'EPI-HUI-01',
      'l',
      'epicerie',
      9.0,
      6,
      1200,
      'sup_marche',
      'reserve',
    ),
    item(
      'itm_bissap',
      'Hibiscus séché',
      'EPI-BIS-01',
      'kg',
      'epicerie',
      2.8,
      3,
      1800,
      'sup_marche',
      'bar',
    ),
    item(
      'itm_biere',
      'Bière locale 33cl',
      'BOI-BIE-01',
      'btl',
      'boisson',
      96,
      48,
      700,
      'sup_golfe',
      'bar',
    ),
    item(
      'itm_sprite',
      'Soda 33cl',
      'BOI-SOD-01',
      'btl',
      'boisson',
      60,
      36,
      450,
      'sup_golfe',
      'bar',
    ),
    item(
      'itm_mangue',
      'Mangues',
      'FRU-MAN-01',
      'kg',
      'fruit',
      13.0,
      6,
      800,
      'sup_marche',
      'cuisine',
    ),
    item('itm_ananas', 'Ananas', 'FRU-ANA-01', 'pcs', 'fruit', 8, 5, 600, 'sup_marche', 'cuisine'),
    item(
      'itm_charbon',
      'Charbon de bois',
      'ENE-CHA-01',
      'kg',
      'energie',
      25.0,
      15,
      300,
      'sup_marche',
      'reserve',
    ),
    item(
      'itm_emballage',
      'Emballage livraison',
      'EMB-LIV-01',
      'pcs',
      'emballage',
      140,
      80,
      120,
      'sup_marche',
      'reserve',
    ),
  ];
  for (const entry of items) store.items.set(entry.id, entry);

  const recipe = (
    id: string,
    productId: string,
    productName: string,
    price: number,
    lines: RecipeLine[],
  ): Recipe => ({
    id,
    tenantId,
    productId,
    productName,
    productPriceXof: price,
    yieldQty: 1,
    lines,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'usr_demo_seed',
  });
  const recipes = [
    recipe('rec_poulet', 'prd_sg_poulet', 'Poulet braisé', 4500, [
      { itemId: 'itm_poulet', quantity: 0.45 },
      { itemId: 'itm_oignon', quantity: 0.05 },
      { itemId: 'itm_charbon', quantity: 0.4 },
    ]),
    recipe('rec_brochettes', 'prd_sg_brochettes', 'Brochettes de bœuf', 3000, [
      { itemId: 'itm_boeuf', quantity: 0.25 },
      { itemId: 'itm_oignon', quantity: 0.04 },
      { itemId: 'itm_charbon', quantity: 0.2 },
    ]),
    recipe('rec_attieke', 'prd_sg_attieke', 'Attiéké poisson', 3500, [
      { itemId: 'itm_attieke', quantity: 0.3 },
      { itemId: 'itm_poisson', quantity: 0.25 },
      { itemId: 'itm_tomate', quantity: 0.05 },
    ]),
    recipe('rec_bissap', 'prd_sg_bissap', 'Cocktail Bissap', 2000, [
      { itemId: 'itm_bissap', quantity: 0.03 },
      { itemId: 'itm_mangue', quantity: 0.05 },
    ]),
    recipe('rec_biere', 'prd_sg_biere', 'Bière locale', 1500, [
      { itemId: 'itm_biere', quantity: 1 },
    ]),
    recipe('rec_salade', 'prd_sg_salade', 'Salade de fruits', 2000, [
      { itemId: 'itm_mangue', quantity: 0.2 },
      { itemId: 'itm_ananas', quantity: 0.5 },
    ]),
  ];
  for (const entry of recipes) store.recipes.set(entry.id, entry);

  const daysAgo = (days: number, hour: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(hour, 15, 0, 0);
    return date.toISOString();
  };
  const historic: StockMovement[] = [
    {
      id: 'mov_seed_1',
      tenantId,
      itemId: 'itm_poulet',
      itemName: 'Poulet fermier',
      type: 'in',
      quantity: 20,
      costXof: 48000,
      reason: 'Livraison hebdomadaire',
      refType: 'purchase',
      refId: 'po_seed_1',
      actor: 'usr_demo_seed',
      at: daysAgo(6, 8),
    },
    {
      id: 'mov_seed_2',
      tenantId,
      itemId: 'itm_poulet',
      itemName: 'Poulet fermier',
      type: 'waste',
      quantity: -1.5,
      costXof: 3600,
      reason: 'Chaîne du froid rompue',
      refType: 'waste',
      refId: null,
      actor: 'usr_demo_seed',
      at: daysAgo(2, 9),
    },
    {
      id: 'mov_seed_3',
      tenantId,
      itemId: 'itm_tomate',
      itemName: 'Tomates fraîches',
      type: 'waste',
      quantity: -0.5,
      costXof: 275,
      reason: 'Produit flétri',
      refType: 'waste',
      refId: null,
      actor: 'usr_demo_seed',
      at: daysAgo(1, 10),
    },
  ];
  store.movements.push(...historic);

  store.recordAudit({
    tenantId,
    actorId: 'usr_demo_seed',
    action: 'inventory.seeded',
    targetType: 'inventory',
    targetId: tenantId,
    meta: { items: items.length, recipes: recipes.length, suppliers: suppliers.length },
  });
}
