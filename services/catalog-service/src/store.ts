import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';

export const ALLERGENS = [
  'gluten',
  'crustaces',
  'oeufs',
  'poisson',
  'arachides',
  'soja',
  'lait',
  'fruits_a_coque',
  'celeri',
  'moutarde',
  'sesame',
  'sulfites',
  'lupin',
  'mollusques',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DAY_KEYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const PRODUCT_STATIONS = ['cuisine', 'bar'] as const;
export type ProductStation = (typeof PRODUCT_STATIONS)[number];

export interface CatalogCategory {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  position: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  name: string;
  priceXof: number;
}

export interface ProductOptionChoice {
  id: string;
  name: string;
  priceDeltaXof: number;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  choices: ProductOptionChoice[];
}

export interface PriceRule {
  id: string;
  label: string;
  days: DayKey[];
  start: string;
  end: string;
  priceXof: number;
}

export interface ProductAvailability {
  available: boolean;
  reason?: string;
  until?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CatalogProduct {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description?: string;
  photos: string[];
  allergens: Allergen[];
  station: ProductStation;
  basePriceXof: number;
  variants: ProductVariant[];
  options: ProductOptionGroup[];
  priceRules: PriceRule[];
  active: boolean;
  availability: ProductAvailability;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ComposedMenuItem {
  productId: string;
  quantity: number;
  variantId?: string;
}

export interface ComposedMenu {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  priceXof: number;
  items: ComposedMenuItem[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type PromotionType = 'percent' | 'amount';
export type PromotionScope = 'all' | 'category' | 'product';

export interface Promotion {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  type: PromotionType;
  value: number;
  scope: PromotionScope;
  targetId?: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogStore {
  categories: Map<string, CatalogCategory>;
  products: Map<string, CatalogProduct>;
  menus: Map<string, ComposedMenu>;
  promotions: Map<string, Promotion>;
  audit: AuditEntry[];
  recordAudit(input: {
    tenantId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  }): AuditEntry;
}

export function createCatalogStore(): CatalogStore {
  const store: CatalogStore = {
    categories: new Map(),
    products: new Map(),
    menus: new Map(),
    promotions: new Map(),
    audit: [],
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
  };
  return store;
}

const tzFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string): { day: number; minutes: number } {
  let formatter = tzFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    tzFormatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = lookup('weekday');
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(lookup('hour')) % 24;
  const minute = Number(lookup('minute'));
  return { day: days[weekday] ?? 0, minutes: hour * 60 + minute };
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function dayKeyFor(day: number): DayKey {
  // getUTCDay: 0 = dimanche ; DAY_KEYS commence le lundi
  return DAY_KEYS[(day + 6) % 7];
}

export function activePriceRule(
  product: CatalogProduct,
  at: Date,
  timeZone = 'Africa/Lome',
): PriceRule | undefined {
  const { day, minutes } = zonedParts(at, timeZone);
  const key = dayKeyFor(day);
  return product.priceRules.find((rule) => {
    if (!rule.days.includes(key)) return false;
    const start = minutesOf(rule.start);
    const end = minutesOf(rule.end);
    return end > start ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  });
}

export function effectivePrice(
  product: CatalogProduct,
  at: Date,
  timeZone = 'Africa/Lome',
): number {
  return activePriceRule(product, at, timeZone)?.priceXof ?? product.basePriceXof;
}

export function activePromotions(promotions: Promotion[], at: Date): Promotion[] {
  const iso = at.toISOString();
  return promotions.filter(
    (promotion) => promotion.active && promotion.startsAt <= iso && promotion.endsAt >= iso,
  );
}

function hoursRule(
  id: string,
  days: DayKey[],
  start: string,
  end: string,
  priceXof: number,
): PriceRule {
  return { id, label: 'Happy hour', days, start, end, priceXof };
}

export function seedCatalogDemo(store: CatalogStore): void {
  if (store.categories.size > 0) return;
  const tenantId = 'tnt_sahelgrill';
  const now = nowIso();
  const actor = 'usr_demo_seed';

  const categories: CatalogCategory[] = [
    {
      id: 'cat_sg_entrees',
      tenantId,
      name: 'Entrées',
      position: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat_sg_grillades',
      tenantId,
      name: 'Grillades',
      position: 2,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat_sg_plats',
      tenantId,
      name: 'Plats',
      position: 3,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat_sg_boissons',
      tenantId,
      name: 'Boissons',
      position: 4,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cat_sg_desserts',
      tenantId,
      name: 'Desserts',
      position: 5,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const category of categories) store.categories.set(category.id, category);

  const product = (
    input: Partial<CatalogProduct> &
      Pick<CatalogProduct, 'id' | 'name' | 'categoryId' | 'basePriceXof'>,
  ): CatalogProduct => ({
    tenantId,
    description: undefined,
    photos: [],
    allergens: [],
    station: 'cuisine',
    variants: [],
    options: [],
    priceRules: [],
    active: true,
    availability: { available: true, updatedAt: now, updatedBy: actor },
    createdAt: now,
    updatedAt: now,
    ...input,
  });

  const products: CatalogProduct[] = [
    product({
      id: 'prd_sg_poulet',
      name: 'Poulet braisé',
      categoryId: 'cat_sg_grillades',
      description: 'Poulet mariné aux épices locales, braisé au feu de bois.',
      basePriceXof: 4500,
      photos: ['https://picsum.photos/seed/rh-poulet/640/400'],
      variants: [
        { id: 'var_sg_poulet_demi', name: 'Demi', priceXof: 3500 },
        { id: 'var_sg_poulet_entier', name: 'Entier', priceXof: 4500 },
      ],
      options: [
        {
          id: 'opt_sg_accomp',
          name: 'Accompagnement',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          choices: [
            { id: 'cho_sg_frites', name: 'Frites', priceDeltaXof: 500 },
            { id: 'cho_sg_alloco', name: 'Alloco', priceDeltaXof: 500 },
            { id: 'cho_sg_attieke', name: 'Attiéké', priceDeltaXof: 500 },
          ],
        },
      ],
    }),
    product({
      id: 'prd_sg_brochettes',
      name: 'Brochettes de bœuf',
      categoryId: 'cat_sg_grillades',
      description: 'Trois brochettes grillées, sauce piment maison.',
      basePriceXof: 3000,
      allergens: ['moutarde'],
      photos: ['https://picsum.photos/seed/rh-brochettes/640/400'],
    }),
    product({
      id: 'prd_sg_attieke',
      name: 'Attiéké poisson',
      categoryId: 'cat_sg_plats',
      description: 'Attiéké frais et poisson frit, tomates et oignons.',
      basePriceXof: 3500,
      allergens: ['poisson'],
      photos: ['https://picsum.photos/seed/rh-attieke/640/400'],
    }),
    product({
      id: 'prd_sg_bissap',
      name: 'Cocktail Bissap',
      categoryId: 'cat_sg_boissons',
      description: 'Infusion d’hibiscus, gingembre et menthe fraîche.',
      station: 'bar',
      basePriceXof: 2000,
      photos: ['https://picsum.photos/seed/rh-bissap/640/400'],
      variants: [
        { id: 'var_sg_bissap_classique', name: 'Classique', priceXof: 2000 },
        { id: 'var_sg_bissap_grand', name: 'Grand', priceXof: 3500 },
      ],
      priceRules: [
        hoursRule(
          'rule_sg_bissap_hh',
          ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
          '17:00',
          '19:00',
          1500,
        ),
      ],
    }),
    product({
      id: 'prd_sg_biere',
      name: 'Bière locale',
      categoryId: 'cat_sg_boissons',
      station: 'bar',
      basePriceXof: 1500,
      priceRules: [
        hoursRule(
          'rule_sg_biere_hh',
          ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
          '17:00',
          '19:00',
          1000,
        ),
      ],
    }),
    product({
      id: 'prd_sg_salade',
      name: 'Salade de fruits',
      categoryId: 'cat_sg_desserts',
      description: 'Mangue, ananas et papaye de saison.',
      basePriceXof: 2000,
      allergens: ['lait'],
      photos: ['https://picsum.photos/seed/rh-salade/640/400'],
    }),
  ];
  for (const entry of products) store.products.set(entry.id, entry);

  const menu: ComposedMenu = {
    id: 'menu_sg_midi',
    tenantId,
    name: 'Formule midi',
    description: 'Un plat grillé, un accompagnement et une boisson.',
    priceXof: 5500,
    items: [
      { productId: 'prd_sg_poulet', quantity: 1, variantId: 'var_sg_poulet_entier' },
      { productId: 'prd_sg_bissap', quantity: 1, variantId: 'var_sg_bissap_classique' },
    ],
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  store.menus.set(menu.id, menu);

  const promotion: Promotion = {
    id: 'promo_sg_etudiants',
    tenantId,
    name: 'Étudiants -10%',
    code: 'ETUD10',
    type: 'percent',
    value: 10,
    scope: 'all',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2027-12-31T23:59:59.000Z',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  store.promotions.set(promotion.id, promotion);

  const extraTenants: Array<{
    tenantId: string;
    prefix: string;
    categories: Array<[string, string]>;
    items: Array<{
      id: string;
      name: string;
      categoryIndex: number;
      priceXof: number;
      description?: string;
      allergens?: Allergen[];
      station?: ProductStation;
      photoSeed?: string;
    }>;
    menuName: string;
    menuPriceXof: number;
    menuItems: Array<{ id: string; categoryIndex: number }>;
  }> = [
    {
      tenantId: 'tnt_baobab',
      prefix: 'bb',
      categories: [
        ['cocktails', 'Cocktails'],
        ['street', 'Street food'],
        ['bieres', 'Bières & jus'],
      ],
      items: [
        {
          id: 'cocktail',
          name: 'Cocktail Baobab',
          categoryIndex: 0,
          priceXof: 3000,
          description: 'Rhum ambré, hibiscus, citron vert et gingembre.',
          station: 'bar',
          photoSeed: 'rh-baobab-cocktail',
        },
        {
          id: 'mojito',
          name: 'Mojito maison',
          categoryIndex: 0,
          priceXof: 2500,
          description: 'Menthe fraîche, citron vert, sirop de canne.',
          station: 'bar',
        },
        {
          id: 'brochettes',
          name: 'Brochettes de poulet',
          categoryIndex: 1,
          priceXof: 2500,
          description: 'Poulet mariné, sauce arachide maison.',
          allergens: ['arachides'],
        },
        {
          id: 'tacos',
          name: 'Tacos poisson',
          categoryIndex: 1,
          priceXof: 3000,
          description: 'Galette, poisson frit, légumes croquants.',
          allergens: ['gluten', 'poisson'],
        },
        { id: 'biere', name: 'Bière locale', categoryIndex: 2, priceXof: 1500, station: 'bar' },
        {
          id: 'gingembre',
          name: 'Jus de gingembre',
          categoryIndex: 2,
          priceXof: 1500,
          station: 'bar',
          description: 'Pressé du jour, sans sucre ajouté.',
        },
      ],
      menuName: 'Planche apéro duo',
      menuPriceXof: 6500,
      menuItems: [
        { id: 'brochettes', categoryIndex: 1 },
        { id: 'mojito', categoryIndex: 0 },
      ],
    },
    {
      tenantId: 'tnt_lagune',
      prefix: 'lg',
      categories: [
        ['entrees', 'Entrées'],
        ['poissons', 'Poissons & fruits de mer'],
        ['desserts', 'Desserts'],
      ],
      items: [
        {
          id: 'papaye',
          name: 'Salade de papaye verte',
          categoryIndex: 0,
          priceXof: 2500,
          description: 'Papaye verte, cacahuètes torréfiées, citron vert.',
          allergens: ['arachides'],
          photoSeed: 'rh-lagune-table',
        },
        {
          id: 'capitaine',
          name: 'Capitaine grillé',
          categoryIndex: 1,
          priceXof: 6000,
          description: 'Capitaine entier braisé, attiéké et sauce tomate.',
          allergens: ['poisson'],
        },
        {
          id: 'crevettes',
          name: 'Crevettes sautées',
          categoryIndex: 1,
          priceXof: 5500,
          description: 'Crevettes roses, ail et beurre citronné.',
          allergens: ['crustaces', 'lait'],
        },
        {
          id: 'riz',
          name: 'Riz coco',
          categoryIndex: 1,
          priceXof: 2000,
          description: 'Riz parfumé au lait de coco.',
        },
        {
          id: 'coco',
          name: 'Coco glacé',
          categoryIndex: 2,
          priceXof: 2000,
          description: 'Glace coco servie dans sa noix.',
          allergens: ['lait'],
        },
        { id: 'ananas', name: "Jus d'ananas", categoryIndex: 2, priceXof: 1500, station: 'bar' },
      ],
      menuName: 'Menu Lagune',
      menuPriceXof: 8500,
      menuItems: [
        { id: 'capitaine', categoryIndex: 1 },
        { id: 'coco', categoryIndex: 2 },
      ],
    },
  ];

  for (const extra of extraTenants) {
    const categoryIds = extra.categories.map(([key, name], index) => {
      const id = `cat_${extra.prefix}_${key}`;
      store.categories.set(id, {
        id,
        tenantId: extra.tenantId,
        name,
        position: index + 1,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });
    for (const item of extra.items) {
      const id = `prd_${extra.prefix}_${item.id}`;
      store.products.set(id, {
        id,
        tenantId: extra.tenantId,
        categoryId: categoryIds[item.categoryIndex],
        name: item.name,
        description: item.description,
        photos: item.photoSeed ? [`https://picsum.photos/seed/${item.photoSeed}/640/400`] : [],
        allergens: item.allergens ?? [],
        station: item.station ?? 'cuisine',
        basePriceXof: item.priceXof,
        variants: [],
        options: [],
        priceRules: [],
        active: true,
        availability: { available: true, updatedAt: now, updatedBy: actor },
        createdAt: now,
        updatedAt: now,
      });
    }
    const menuId = `menu_${extra.prefix}_signature`;
    store.menus.set(menuId, {
      id: menuId,
      tenantId: extra.tenantId,
      name: extra.menuName,
      description: 'Sélection de la maison, boisson incluse.',
      priceXof: extra.menuPriceXof,
      items: extra.menuItems.map((entry) => ({
        productId: `prd_${extra.prefix}_${entry.id}`,
        quantity: 1,
      })),
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  store.recordAudit({
    tenantId,
    actorId: actor,
    action: 'catalog.seeded',
    targetType: 'catalog',
    targetId: tenantId,
    meta: { categories: categories.length, products: products.length, menus: 1, promotions: 1 },
  });
}

export function newCatalogId(prefix: string): string {
  return newId(prefix);
}
