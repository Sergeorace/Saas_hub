import {
  HttpError,
  asObject,
  hasTenantPermission,
  optionalString,
  requireEnum,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import {
  ALLERGENS,
  DAY_KEYS,
  PRODUCT_STATIONS,
  activePriceRule,
  activePromotions,
  dayKeyFor,
  effectivePrice,
  newCatalogId,
  type Allergen,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogStore,
  type ComposedMenu,
  type DayKey,
  type PriceRule,
  type ProductStation,
  type ProductOptionGroup,
  type ProductVariant,
  type Promotion,
  type PromotionScope,
  type PromotionType,
} from './store.js';
import { nowIso as isoNow } from '@resto-hub/service-kit';

export interface CatalogAppOptions {
  store: CatalogStore;
  timeZone: string;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

const HTTPS_URL = /^https:\/\/[^\s]{4,500}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PROMO_CODE = /^[A-Z0-9]{4,20}$/;

function requireInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = source[field];
  const min = opts.min ?? 0;
  const max = opts.max ?? 10_000_000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être un entier entre ${min} et ${max}.`,
      { field },
    );
  }
  return value;
}

function optionalInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  return requireInt(source, field, opts);
}

function isoDate(source: Record<string, unknown>, field: string): string {
  const raw = requireString(source, field, { max: 40 });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw HttpError.unprocessable('validation_error', `« ${field} » doit être une date ISO.`, { field });
  }
  return date.toISOString();
}

function optionalIsoDate(source: Record<string, unknown>, field: string): string | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  return isoDate(source, field);
}

function urls(source: Record<string, unknown>, field: string, max: number): string[] {
  const value = source[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw HttpError.unprocessable('validation_error', `« ${field} » accepte ${max} URL maximum.`, { field });
  }
  return value.map((entry) => {
    const url = String(entry ?? '').trim();
    if (!HTTPS_URL.test(url)) {
      throw HttpError.unprocessable('validation_error', `Chaque « ${field} » doit être une URL HTTPS.`, { field });
    }
    return url;
  });
}

function allergens(source: Record<string, unknown>): Allergen[] {
  const value = source.allergens;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw HttpError.unprocessable('validation_error', '« allergens » doit être une liste.', { field: 'allergens' });
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !(ALLERGENS as readonly string[]).includes(entry)) {
      throw HttpError.unprocessable('validation_error', `Allergène inconnu : ${String(entry)}.`, {
        field: 'allergens',
      });
    }
    return entry as Allergen;
  });
}

function variants(source: Record<string, unknown>): ProductVariant[] {
  const value = source.variants;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw HttpError.unprocessable('validation_error', '« variants » accepte 10 variantes maximum.', {
      field: 'variants',
    });
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = asObject(entry);
    const name = requireString(item, 'name', { min: 1, max: 60 });
    if (seen.has(name.toLowerCase())) {
      throw HttpError.unprocessable('validation_error', 'Variantes en double.', { field: 'variants' });
    }
    seen.add(name.toLowerCase());
    return {
      id: optionalString(item, 'id', { max: 64 }) ?? newCatalogId('var'),
      name,
      priceXof: requireInt(item, 'priceXof'),
    };
  });
}

function parseOptionGroups(source: Record<string, unknown>): ProductOptionGroup[] {
  const value = source.options;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw HttpError.unprocessable('validation_error', '« options » accepte 8 groupes maximum.', { field: 'options' });
  }
  return value.map((entry) => {
    const group = asObject(entry);
    const choicesValue = group.choices;
    if (!Array.isArray(choicesValue) || choicesValue.length === 0 || choicesValue.length > 15) {
      throw HttpError.unprocessable('validation_error', 'Chaque groupe doit contenir 1 à 15 choix.', {
        field: 'options',
      });
    }
    const minSelect = optionalInt(group, 'minSelect', { min: 0, max: 15 }) ?? 0;
    const maxSelect = optionalInt(group, 'maxSelect', { min: 1, max: 15 }) ?? 1;
    if (minSelect > maxSelect || maxSelect > choicesValue.length) {
      throw HttpError.unprocessable('validation_error', 'Sélections min/max incohérentes.', { field: 'options' });
    }
    return {
      id: optionalString(group, 'id', { max: 64 }) ?? newCatalogId('opt'),
      name: requireString(group, 'name', { min: 1, max: 60 }),
      required: group.required === true,
      minSelect,
      maxSelect,
      choices: choicesValue.map((choice) => {
        const item = asObject(choice);
        return {
          id: optionalString(item, 'id', { max: 64 }) ?? newCatalogId('cho'),
          name: requireString(item, 'name', { min: 1, max: 60 }),
          priceDeltaXof: optionalInt(item, 'priceDeltaXof', { min: -5_000_000, max: 5_000_000 }) ?? 0,
        };
      }),
    };
  });
}

function priceRules(source: Record<string, unknown>): PriceRule[] {
  const value = source.priceRules;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) {
    throw HttpError.unprocessable('validation_error', '« priceRules » accepte 6 plages maximum.', {
      field: 'priceRules',
    });
  }
  return value.map((entry) => {
    const rule = asObject(entry);
    const days = rule.days;
    if (!Array.isArray(days) || days.length === 0) {
      throw HttpError.unprocessable('validation_error', 'Chaque plage doit préciser au moins un jour.', {
        field: 'priceRules',
      });
    }
    const normalized = days.map((day) => {
      if (typeof day !== 'string' || !(DAY_KEYS as readonly string[]).includes(day)) {
        throw HttpError.unprocessable('validation_error', `Jour invalide : ${String(day)}.`, {
          field: 'priceRules',
        });
      }
      return day as DayKey;
    });
    const start = requireString(rule, 'start', { max: 5 });
    const end = requireString(rule, 'end', { max: 5 });
    if (!HHMM.test(start) || !HHMM.test(end) || start === end) {
      throw HttpError.unprocessable('validation_error', 'Horaires HH:MM invalides.', { field: 'priceRules' });
    }
    return {
      id: optionalString(rule, 'id', { max: 64 }) ?? newCatalogId('rule'),
      label: optionalString(rule, 'label', { max: 60 }) ?? 'Happy hour',
      days: normalized,
      start,
      end,
      priceXof: requireInt(rule, 'priceXof'),
    };
  });
}

function requireCategory(store: CatalogStore, tenantId: string, id: string): CatalogCategory {
  const category = store.categories.get(id);
  if (!category || category.tenantId !== tenantId) throw HttpError.notFound('Catégorie introuvable.');
  return category;
}

function requireProduct(store: CatalogStore, tenantId: string, id: string): CatalogProduct {
  const product = store.products.get(id);
  if (!product || product.tenantId !== tenantId || product.deletedAt) {
    throw HttpError.notFound('Produit introuvable.');
  }
  return product;
}

function requireMenu(store: CatalogStore, tenantId: string, id: string): ComposedMenu {
  const menu = store.menus.get(id);
  if (!menu || menu.tenantId !== tenantId || menu.deletedAt) throw HttpError.notFound('Menu introuvable.');
  return menu;
}

function requirePromotion(store: CatalogStore, tenantId: string, id: string): Promotion {
  const promotion = store.promotions.get(id);
  if (!promotion || promotion.tenantId !== tenantId) throw HttpError.notFound('Promotion introuvable.');
  return promotion;
}

function nameTaken(store: CatalogStore, tenantId: string, name: string, exceptId?: string): boolean {
  return [...store.categories.values()].some(
    (category) =>
      category.tenantId === tenantId &&
      category.id !== exceptId &&
      category.name.toLowerCase() === name.toLowerCase(),
  );
}

function promoCodeTaken(store: CatalogStore, tenantId: string, code: string, exceptId?: string): boolean {
  return [...store.promotions.values()].some(
    (promotion) => promotion.tenantId === tenantId && promotion.id !== exceptId && promotion.code === code,
  );
}

function viewProduct(store: CatalogStore, product: CatalogProduct, at: Date, timeZone: string) {
  const rule = activePriceRule(product, at, timeZone);
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    photos: product.photos,
    allergens: product.allergens,
    station: product.station,
    basePriceXof: product.basePriceXof,
    effectivePriceXof: effectivePrice(product, at, timeZone),
    activePriceRule: rule ? { id: rule.id, label: rule.label, start: rule.start, end: rule.end, priceXof: rule.priceXof } : null,
    variants: product.variants,
    options: product.options,
    priceRules: product.priceRules,
    active: product.active,
    availability: product.availability,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function publicProduct(product: CatalogProduct, at: Date, timeZone: string) {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    photos: product.photos,
    allergens: product.allergens,
    station: product.station,
    priceXof: effectivePrice(product, at, timeZone),
    basePriceXof: product.basePriceXof,
    variants: product.variants,
    options: product.options,
    available: product.availability.available,
  };
}

function tenantOf(ctx: RequestContext, permission: string): { tenantId: string; claims: AuthClaims } {
  const tenantId = ctx.params.tenantId ?? '';
  const claims = requireTenantPermission(ctx.auth, tenantId, permission);
  return { tenantId, claims };
}

function canAny(claims: AuthClaims, tenantId: string, permissions: string[]): boolean {
  return permissions.some((permission) => hasTenantPermission(claims, tenantId, permission));
}

export function buildCatalogApp(options: CatalogAppOptions): Route[] {
  const { store, publish, timeZone } = options;

  const notify = async (
    tenantId: string,
    itemType: string,
    itemId: string,
    change: 'created' | 'updated' | 'availability' | 'archived',
    extra: Record<string, unknown> = {},
  ) => {
    await publish('CatalogItemUpdated', tenantId, {
      tenantId,
      itemType,
      itemId,
      change,
      at: isoNow(),
      ...extra,
    });
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/catalog',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:view');
        const at = new Date();
        return {
          body: {
            tenantId,
            effectiveAt: at.toISOString(),
            timeZone,
            categories: [...store.categories.values()]
              .filter((category) => category.tenantId === tenantId)
              .sort((a, b) => a.position - b.position)
              .map(({ tenantId: _tenantId, ...rest }) => rest),
            products: [...store.products.values()]
              .filter((product) => product.tenantId === tenantId && !product.deletedAt)
              .map((product) => viewProduct(store, product, at, timeZone))
              .sort((a, b) => a.name.localeCompare(b.name)),
            menus: [...store.menus.values()]
              .filter((menu) => menu.tenantId === tenantId && !menu.deletedAt)
              .map((menu) => ({ ...menu, items: menu.items.map((item) => ({
                ...item,
                name: store.products.get(item.productId)?.name ?? 'Produit supprimé',
              })) })),
            promotions: [...store.promotions.values()].filter((promotion) => promotion.tenantId === tenantId),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/catalog/products/:id',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:view');
        const product = requireProduct(store, tenantId, ctx.params.id);
        return { body: { product: viewProduct(store, product, new Date(), timeZone) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/catalog/categories',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'catalog:manage');
        const body = asObject(ctx.body);
        const name = requireString(body, 'name', { min: 2, max: 60 });
        if (nameTaken(store, tenantId, name)) {
          throw HttpError.conflict('category_name_conflict', 'Une catégorie porte déjà ce nom.');
        }
        const now = isoNow();
        const position =
          optionalInt(body, 'position', { min: 0, max: 999 }) ??
          Math.max(0, ...[...store.categories.values()].filter((c) => c.tenantId === tenantId).map((c) => c.position)) + 1;
        const category: CatalogCategory = {
          id: newCatalogId('cat'),
          tenantId,
          name,
          description: optionalString(body, 'description', { max: 300 }),
          position,
          active: body.active === undefined ? true : body.active === true,
          createdAt: now,
          updatedAt: now,
        };
        store.categories.set(category.id, category);
        await notify(tenantId, 'category', category.id, 'created', { name: category.name });
        return { status: 201, body: { category } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/catalog/categories/:id',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const category = requireCategory(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (body.name !== undefined) {
          const name = requireString(body, 'name', { min: 2, max: 60 });
          if (nameTaken(store, tenantId, name, category.id)) {
            throw HttpError.conflict('category_name_conflict', 'Une catégorie porte déjà ce nom.');
          }
          category.name = name;
        }
        if (body.description !== undefined) {
          category.description = optionalString(body, 'description', { max: 300 });
        }
        const position = optionalInt(body, 'position', { min: 0, max: 999 });
        if (position !== undefined) category.position = position;
        if (body.active !== undefined) category.active = body.active === true;
        category.updatedAt = isoNow();
        await notify(tenantId, 'category', category.id, 'updated', { name: category.name });
        return { body: { category } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/catalog/categories/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'catalog:manage');
        const category = requireCategory(store, tenantId, ctx.params.id);
        const used = [...store.products.values()].filter(
          (product) => product.tenantId === tenantId && !product.deletedAt && product.categoryId === category.id,
        );
        if (used.length > 0) {
          throw HttpError.conflict('category_not_empty', 'Déplacez ou archivez d’abord les produits de cette catégorie.', {
            products: used.length,
          });
        }
        store.categories.delete(category.id);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'catalog.category.deleted',
          targetType: 'category',
          targetId: category.id,
          meta: { name: category.name },
        });
        await notify(tenantId, 'category', category.id, 'archived', { name: category.name });
        return { body: { ok: true } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/catalog/products',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'catalog:manage');
        const body = asObject(ctx.body);
        const categoryId = requireString(body, 'categoryId', { max: 64 });
        requireCategory(store, tenantId, categoryId);
        const name = requireString(body, 'name', { min: 2, max: 80 });
        const now = isoNow();
        const product: CatalogProduct = {
          id: newCatalogId('prd'),
          tenantId,
          categoryId,
          name,
          description: optionalString(body, 'description', { max: 500 }),
          photos: urls(body, 'photos', 6),
          allergens: allergens(body),
          station: body.station === undefined ? 'cuisine' : requireEnum(body, 'station', PRODUCT_STATIONS),
          basePriceXof: requireInt(body, 'basePriceXof', { min: 0 }),
          variants: variants(body),
          options: parseOptionGroups(body),
          priceRules: priceRules(body),
          active: body.active === undefined ? true : body.active === true,
          availability: {
            available: true,
            updatedAt: now,
            updatedBy: claims.sub,
          },
          createdAt: now,
          updatedAt: now,
        };
        store.products.set(product.id, product);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'catalog.product.created',
          targetType: 'product',
          targetId: product.id,
          meta: { name, basePriceXof: product.basePriceXof },
        });
        await notify(tenantId, 'product', product.id, 'created', {
          name,
          priceXof: product.basePriceXof,
        });
        return { status: 201, body: { product: viewProduct(store, product, new Date(), timeZone) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/catalog/products/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'catalog:manage');
        const product = requireProduct(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        const before = {
          basePriceXof: product.basePriceXof,
          variants: product.variants.map((variant) => `${variant.id}:${variant.priceXof}`).join(','),
          priceRules: product.priceRules.map((rule) => `${rule.id}:${rule.priceXof}`).join(','),
        };
        if (body.categoryId !== undefined) {
          const categoryId = requireString(body, 'categoryId', { max: 64 });
          requireCategory(store, tenantId, categoryId);
          product.categoryId = categoryId;
        }
        if (body.name !== undefined) product.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.description !== undefined) {
          product.description = optionalString(body, 'description', { max: 500 });
        }
        if (body.photos !== undefined) product.photos = urls(body, 'photos', 6);
        if (body.allergens !== undefined) product.allergens = allergens(body);
        if (body.station !== undefined) {
          product.station = requireEnum(body, 'station', PRODUCT_STATIONS) as ProductStation;
        }
        const basePrice = optionalInt(body, 'basePriceXof', { min: 0 });
        if (basePrice !== undefined) product.basePriceXof = basePrice;
        if (body.variants !== undefined) product.variants = variants(body);
        if (body.options !== undefined) product.options = parseOptionGroups(body);
        if (body.priceRules !== undefined) product.priceRules = priceRules(body);
        if (body.active !== undefined) product.active = body.active === true;
        product.updatedAt = isoNow();
        const priceChanged =
          before.basePriceXof !== product.basePriceXof ||
          before.variants !== product.variants.map((variant) => `${variant.id}:${variant.priceXof}`).join(',') ||
          before.priceRules !== product.priceRules.map((rule) => `${rule.id}:${rule.priceXof}`).join(',');
        if (priceChanged) {
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'catalog.product.price_changed',
            targetType: 'product',
            targetId: product.id,
            meta: {
              before,
              after: {
                basePriceXof: product.basePriceXof,
                variants: product.variants.map((variant) => `${variant.id}:${variant.priceXof}`).join(','),
                priceRules: product.priceRules.map((rule) => `${rule.id}:${rule.priceXof}`).join(','),
              },
            },
          });
        }
        await notify(tenantId, 'product', product.id, 'updated', {
          name: product.name,
          priceXof: product.basePriceXof,
          priceChanged,
        });
        return { body: { product: viewProduct(store, product, new Date(), timeZone) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/catalog/products/:id/availability',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = ctx.auth;
        if (!claims) throw HttpError.unauthorized();
        if (!canAny(claims, tenantId, ['catalog:availability', 'catalog:manage'])) {
          throw new HttpError(403, 'tenant_scope_denied', "Vous n'avez pas accès à cet établissement.");
        }
        const product = requireProduct(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (typeof body.available !== 'boolean') {
          throw HttpError.unprocessable('validation_error', '« available » doit être un booléen.', {
            field: 'available',
          });
        }
        product.availability = {
          available: body.available,
          reason: optionalString(body, 'reason', { max: 120 }),
          until: optionalIsoDate(body, 'until'),
          updatedAt: isoNow(),
          updatedBy: claims.sub,
        };
        product.updatedAt = product.availability.updatedAt;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'catalog.product.availability_changed',
          targetType: 'product',
          targetId: product.id,
          meta: { available: product.availability.available, reason: product.availability.reason },
        });
        await notify(tenantId, 'product', product.id, 'availability', {
          name: product.name,
          available: product.availability.available,
          reason: product.availability.reason,
        });
        return { body: { product: viewProduct(store, product, new Date(), timeZone) } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/catalog/products/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'catalog:manage');
        const product = requireProduct(store, tenantId, ctx.params.id);
        product.deletedAt = isoNow();
        product.active = false;
        product.updatedAt = product.deletedAt;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'catalog.product.archived',
          targetType: 'product',
          targetId: product.id,
          meta: { name: product.name },
        });
        await notify(tenantId, 'product', product.id, 'archived', { name: product.name });
        return { body: { ok: true } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/catalog/menus',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const body = asObject(ctx.body);
        const now = isoNow();
        const menu: ComposedMenu = {
          id: newCatalogId('menu'),
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          description: optionalString(body, 'description', { max: 400 }),
          priceXof: requireInt(body, 'priceXof', { min: 1 }),
          items: parseMenuItems(store, tenantId, body),
          active: body.active === undefined ? true : body.active === true,
          createdAt: now,
          updatedAt: now,
        };
        store.menus.set(menu.id, menu);
        await notify(tenantId, 'menu', menu.id, 'created', { name: menu.name, priceXof: menu.priceXof });
        return { status: 201, body: { menu } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/catalog/menus/:id',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const menu = requireMenu(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (body.name !== undefined) menu.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.description !== undefined) menu.description = optionalString(body, 'description', { max: 400 });
        const price = optionalInt(body, 'priceXof', { min: 1 });
        if (price !== undefined) menu.priceXof = price;
        if (body.items !== undefined) menu.items = parseMenuItems(store, tenantId, body);
        if (body.active !== undefined) menu.active = body.active === true;
        menu.updatedAt = isoNow();
        await notify(tenantId, 'menu', menu.id, 'updated', { name: menu.name, priceXof: menu.priceXof });
        return { body: { menu } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/catalog/menus/:id',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const menu = requireMenu(store, tenantId, ctx.params.id);
        menu.deletedAt = isoNow();
        menu.active = false;
        menu.updatedAt = menu.deletedAt;
        await notify(tenantId, 'menu', menu.id, 'archived', { name: menu.name });
        return { body: { ok: true } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/catalog/promotions',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const body = asObject(ctx.body);
        const now = isoNow();
        const promotion = buildPromotion(store, tenantId, body);
        promotion.createdAt = now;
        promotion.updatedAt = now;
        store.promotions.set(promotion.id, promotion);
        await notify(tenantId, 'promotion', promotion.id, 'created', { name: promotion.name });
        return { status: 201, body: { promotion } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/catalog/promotions/:id',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const promotion = requirePromotion(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (body.name !== undefined) promotion.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.code !== undefined) {
          const code = optionalString(body, 'code', { max: 20 })?.toUpperCase();
          if (code && !PROMO_CODE.test(code)) {
            throw HttpError.unprocessable('validation_error', 'Code promotionnel : 4 à 20 caractères A-Z/0-9.', {
              field: 'code',
            });
          }
          if (code && promoCodeTaken(store, tenantId, code, promotion.id)) {
            throw HttpError.conflict('promo_code_conflict', 'Ce code promotionnel existe déjà.');
          }
          promotion.code = code;
        }
        if (body.type !== undefined) promotion.type = parsePromotionType(body);
        if (body.value !== undefined) promotion.value = parsePromotionValue(body);
        if (body.scope !== undefined) promotion.scope = parsePromotionScope(body);
        if (body.targetId !== undefined) promotion.targetId = optionalString(body, 'targetId', { max: 64 });
        validatePromotionTarget(store, tenantId, promotion.scope, promotion.targetId);
        if (body.startsAt !== undefined) promotion.startsAt = isoDate(body, 'startsAt');
        if (body.endsAt !== undefined) promotion.endsAt = isoDate(body, 'endsAt');
        if (promotion.startsAt >= promotion.endsAt) {
          throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', { field: 'endsAt' });
        }
        if (body.active !== undefined) promotion.active = body.active === true;
        promotion.updatedAt = isoNow();
        await notify(tenantId, 'promotion', promotion.id, 'updated', { name: promotion.name });
        return { body: { promotion } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/catalog/promotions/:id',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'catalog:manage');
        const promotion = requirePromotion(store, tenantId, ctx.params.id);
        store.promotions.delete(promotion.id);
        await notify(tenantId, 'promotion', promotion.id, 'archived', { name: promotion.name });
        return { body: { ok: true } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/catalog/audit',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'audit:view');
        const entries = store.audit.filter((entry) => entry.tenantId === tenantId);
        return { body: { entries, integrity: verifyAuditChain(store.audit) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/menu',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const at = new Date();
        const categories = [...store.categories.values()]
          .filter((category) => category.tenantId === tenantId && category.active)
          .sort((a, b) => a.position - b.position)
          .map((category) => ({
            id: category.id,
            name: category.name,
            description: category.description,
            products: [...store.products.values()]
              .filter(
                (product) =>
                  product.tenantId === tenantId &&
                  !product.deletedAt &&
                  product.active &&
                  product.categoryId === category.id,
              )
              .map((product) => publicProduct(product, at, timeZone)),
          }))
          .filter((category) => category.products.length > 0);
        return {
          body: {
            tenantId,
            generatedAt: at.toISOString(),
            categories,
            menus: [...store.menus.values()]
              .filter((menu) => menu.tenantId === tenantId && menu.active && !menu.deletedAt)
              .map((menu) => ({
                id: menu.id,
                name: menu.name,
                description: menu.description,
                priceXof: menu.priceXof,
                items: menu.items.map((item) => ({
                  name: store.products.get(item.productId)?.name ?? '',
                  quantity: item.quantity,
                })),
              })),
            promotions: activePromotions(
              [...store.promotions.values()].filter((promotion) => promotion.tenantId === tenantId),
              at,
            ).map((promotion) => ({
              id: promotion.id,
              name: promotion.name,
              code: promotion.code,
              type: promotion.type,
              value: promotion.value,
              scope: promotion.scope,
            })),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/catalog/pricing',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const at = new Date();
        const products = [...store.products.values()]
          .filter((product) => product.tenantId === tenantId && !product.deletedAt && product.active)
          .map((product) => ({
            id: product.id,
            name: product.name,
            categoryId: product.categoryId,
            categoryName: store.categories.get(product.categoryId)?.name,
            station: product.station,
            priceXof: effectivePrice(product, at, timeZone),
            available: product.availability.available,
            variants: product.variants,
            options: product.options,
          }));
        return { body: { tenantId, generatedAt: at.toISOString(), products } };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/catalog/summary',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const products = [...store.products.values()].filter(
          (product) => product.tenantId === tenantId && !product.deletedAt,
        );
        return {
          body: {
            tenantId,
            categories: [...store.categories.values()].filter((category) => category.tenantId === tenantId).length,
            products: products.length,
            active: products.filter((product) => product.active).length,
            unavailable: products.filter((product) => !product.availability.available).length,
            menus: [...store.menus.values()].filter((menu) => menu.tenantId === tenantId && !menu.deletedAt).length,
            promotions: [...store.promotions.values()].filter(
              (promotion) => promotion.tenantId === tenantId && promotion.active,
            ).length,
          },
        };
      },
    },
  ];
}

function parseMenuItems(store: CatalogStore, tenantId: string, body: Record<string, unknown>) {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw HttpError.unprocessable('validation_error', 'Un menu doit contenir 1 à 20 articles.', {
      field: 'items',
    });
  }
  return items.map((entry) => {
    const item = asObject(entry);
    const productId = requireString(item, 'productId', { max: 64 });
    const product = requireProduct(store, tenantId, productId);
    const quantity = optionalInt(item, 'quantity', { min: 1, max: 20 }) ?? 1;
    const variantId = optionalString(item, 'variantId', { max: 64 });
    if (variantId && !product.variants.some((variant) => variant.id === variantId)) {
      throw HttpError.unprocessable('validation_error', 'Variante inconnue pour ce produit.', { field: 'items' });
    }
    return { productId, quantity, ...(variantId ? { variantId } : {}) };
  });
}

function parsePromotionType(body: Record<string, unknown>): PromotionType {
  if (body.type !== 'percent' && body.type !== 'amount') {
    throw HttpError.unprocessable('validation_error', '« type » doit être percent ou amount.', { field: 'type' });
  }
  return body.type;
}

function parsePromotionScope(body: Record<string, unknown>): PromotionScope {
  if (body.scope !== 'all' && body.scope !== 'category' && body.scope !== 'product') {
    throw HttpError.unprocessable('validation_error', '« scope » doit être all, category ou product.', {
      field: 'scope',
    });
  }
  return body.scope;
}

function parsePromotionValue(body: Record<string, unknown>): number {
  const value = requireInt(body, 'value', { min: 1, max: 1_000_000 });
  if (body.type === 'percent' && value > 100) {
    throw HttpError.unprocessable('validation_error', 'Une remise en pourcentage ne dépasse pas 100.', {
      field: 'value',
    });
  }
  return value;
}

function validatePromotionTarget(
  store: CatalogStore,
  tenantId: string,
  scope: PromotionScope,
  targetId: string | undefined,
) {
  if (scope === 'all') return;
  if (!targetId) {
    throw HttpError.unprocessable('validation_error', '« targetId » est requis pour ce périmètre.', {
      field: 'targetId',
    });
  }
  if (scope === 'category') requireCategory(store, tenantId, targetId);
  else requireProduct(store, tenantId, targetId);
}

function buildPromotion(store: CatalogStore, tenantId: string, body: Record<string, unknown>): Promotion {
  const name = requireString(body, 'name', { min: 2, max: 80 });
  const code = optionalString(body, 'code', { max: 20 })?.toUpperCase();
  if (code && !PROMO_CODE.test(code)) {
    throw HttpError.unprocessable('validation_error', 'Code promotionnel : 4 à 20 caractères A-Z/0-9.', {
      field: 'code',
    });
  }
  if (code && promoCodeTaken(store, tenantId, code)) {
    throw HttpError.conflict('promo_code_conflict', 'Ce code promotionnel existe déjà.');
  }
  const type = parsePromotionType(body);
  const scope = parsePromotionScope(body);
  const targetId = optionalString(body, 'targetId', { max: 64 });
  validatePromotionTarget(store, tenantId, scope, targetId);
  const startsAt = isoDate(body, 'startsAt');
  const endsAt = isoDate(body, 'endsAt');
  if (startsAt >= endsAt) {
    throw HttpError.unprocessable('validation_error', 'La fin doit suivre le début.', { field: 'endsAt' });
  }
  return {
    id: newCatalogId('promo'),
    tenantId,
    name,
    code,
    type,
    value: parsePromotionValue(body),
    scope,
    targetId,
    startsAt,
    endsAt,
    active: body.active === undefined ? true : body.active === true,
    createdAt: '',
    updatedAt: '',
  };
}

export { dayKeyFor };
