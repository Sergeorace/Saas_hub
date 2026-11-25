import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Select,
  SkeletonText,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useToast,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  catalogApi,
  errorMessage,
  type Allergen,
  type CatalogProduct,
  type CatalogSnapshot,
  type ComposedMenu,
  type ProductInput,
  type Promotion,
} from '../lib/api';

const ALLERGENS: Allergen[] = [
  'gluten', 'crustaces', 'oeufs', 'poisson', 'arachides', 'soja', 'lait',
  'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques',
];

const ALLERGEN_LABEL: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaces: 'Crustacés',
  oeufs: 'Œufs',
  poisson: 'Poisson',
  arachides: 'Arachides',
  soja: 'Soja',
  lait: 'Lait',
  fruits_a_coque: 'Fruits à coque',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
};

const DAYS = [
  { key: 'lun', fr: 'Lun', en: 'Mon' },
  { key: 'mar', fr: 'Mar', en: 'Tue' },
  { key: 'mer', fr: 'Mer', en: 'Wed' },
  { key: 'jeu', fr: 'Jeu', en: 'Thu' },
  { key: 'ven', fr: 'Ven', en: 'Fri' },
  { key: 'sam', fr: 'Sam', en: 'Sat' },
  { key: 'dim', fr: 'Dim', en: 'Sun' },
];

interface VariantRow {
  name: string;
  priceXof: string;
}

interface RuleRow {
  label: string;
  days: string[];
  start: string;
  end: string;
  priceXof: string;
}

interface ProductFormState {
  name: string;
  categoryId: string;
  description: string;
  basePriceXof: string;
  photos: string;
  allergens: Allergen[];
  variants: VariantRow[];
  priceRules: RuleRow[];
  active: boolean;
}

const EMPTY_PRODUCT: ProductFormState = {
  name: '',
  categoryId: '',
  description: '',
  basePriceXof: '',
  photos: '',
  allergens: [],
  variants: [],
  priceRules: [],
  active: true,
};

export function CatalogTab({ tenantId, locale }: { tenantId: string; locale: Locale }) {
  const { t } = useI18n();
  const toast = useToast();

  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [categoryName, setCategoryName] = useState('');
  const [categoryPending, setCategoryPending] = useState(false);

  const [productOpen, setProductOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT);
  const [savingProduct, setSavingProduct] = useState(false);
  const [offSaleTarget, setOffSaleTarget] = useState<CatalogProduct | null>(null);
  const [offSaleReason, setOffSaleReason] = useState('');
  const [offSaleUntil, setOffSaleUntil] = useState('');

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoForm, setPromoForm] = useState({
    name: '',
    code: '',
    type: 'percent' as 'percent' | 'amount',
    value: '10',
    scope: 'all' as 'all' | 'category' | 'product',
    targetId: '',
    startsAt: new Date().toISOString().slice(0, 10),
    endsAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });
  const [savingPromo, setSavingPromo] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuForm, setMenuForm] = useState({ name: '', description: '', priceXof: '' });
  const [menuItems, setMenuItems] = useState<Array<{ productId: string; quantity: number }>>([]);
  const [savingMenu, setSavingMenu] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await catalogApi.snapshot(tenantId);
      setSnapshot(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    setSnapshot(null);
    void load();
  }, [load]);

  const categoryName_ = (id: string) => snapshot?.categories.find((entry) => entry.id === id)?.name ?? '—';

  const products = useMemo(() => {
    if (!snapshot) return [];
    const needle = search.trim().toLowerCase();
    return snapshot.products.filter(
      (product) =>
        (!categoryFilter || product.categoryId === categoryFilter) &&
        (!needle || product.name.toLowerCase().includes(needle)),
    );
  }, [snapshot, search, categoryFilter]);

  const stats = useMemo(() => {
    if (!snapshot) return { products: 0, available: 0, categories: 0, menus: 0, promos: 0, offSale: 0 };
    return {
      products: snapshot.products.length,
      available: snapshot.products.filter((product) => product.availability.available).length,
      categories: snapshot.categories.length,
      menus: snapshot.menus.filter((menu) => menu.active).length,
      promos: snapshot.promotions.filter((promotion) => promotion.active).length,
      offSale: snapshot.products.filter((product) => !product.availability.available).length,
    };
  }, [snapshot]);

  const applyProductResult = (product: CatalogProduct) => {
    setSnapshot((current) => {
      if (!current) return current;
      const exists = current.products.some((entry) => entry.id === product.id);
      return {
        ...current,
        products: exists
          ? current.products.map((entry) => (entry.id === product.id ? product : entry))
          : [product, ...current.products],
      };
    });
  };

  const addCategory = async () => {
    const name = categoryName.trim();
    if (name.length < 2) return;
    setCategoryPending(true);
    try {
      const result = await catalogApi.createCategory(tenantId, { name });
      setSnapshot((current) => (current ? { ...current, categories: [...current.categories, result.category] } : current));
      setCategoryName('');
      toast.push({ title: t('catalog.categoryCreated') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setCategoryPending(false);
    }
  };

  const removeCategory = async (id: string) => {
    try {
      await catalogApi.deleteCategory(tenantId, id);
      setSnapshot((current) =>
        current ? { ...current, categories: current.categories.filter((entry) => entry.id !== id) } : current,
      );
      toast.push({ title: t('catalog.categoryDeleted') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_PRODUCT, categoryId: snapshot?.categories[0]?.id ?? '' });
    setProductOpen(true);
  };

  const openEdit = (product: CatalogProduct) => {
    setEditing(product);
    setForm({
      name: product.name,
      categoryId: product.categoryId,
      description: product.description ?? '',
      basePriceXof: String(product.basePriceXof),
      photos: product.photos.join('\n'),
      allergens: [...product.allergens],
      variants: product.variants.map((variant) => ({ name: variant.name, priceXof: String(variant.priceXof) })),
      priceRules: product.priceRules.map((rule) => ({
        label: rule.label,
        days: [...rule.days],
        start: rule.start,
        end: rule.end,
        priceXof: String(rule.priceXof),
      })),
      active: product.active,
    });
    setProductOpen(true);
  };

  const saveProduct = async () => {
    if (!form.name.trim() || !form.categoryId) {
      toast.push({ title: t('workspace.errorTitle'), description: t('catalog.name'), tone: 'error' });
      return;
    }
    const price = Number(form.basePriceXof);
    if (!Number.isInteger(price) || price < 0) {
      toast.push({ title: t('workspace.errorTitle'), description: t('catalog.priceXof'), tone: 'error' });
      return;
    }
    const payload: ProductInput = {
      categoryId: form.categoryId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      basePriceXof: price,
      photos: form.photos.split('\n').map((line) => line.trim()).filter(Boolean),
      allergens: form.allergens,
      active: form.active,
      variants: form.variants
        .filter((variant) => variant.name.trim() && Number(variant.priceXof) >= 0)
        .map((variant) => ({ name: variant.name.trim(), priceXof: Number(variant.priceXof) })),
      priceRules: form.priceRules
        .filter((rule) => rule.days.length && rule.start && rule.end && rule.priceXof)
        .map((rule) => ({
          label: rule.label.trim() || undefined,
          days: rule.days,
          start: rule.start,
          end: rule.end,
          priceXof: Number(rule.priceXof),
        })),
    };
    setSavingProduct(true);
    try {
      if (editing) {
        const result = await catalogApi.updateProduct(tenantId, editing.id, payload);
        applyProductResult(result.product);
        toast.push({ title: t('catalog.productSaved') });
      } else {
        const result = await catalogApi.createProduct(tenantId, payload);
        applyProductResult(result.product);
        toast.push({ title: t('catalog.productCreated') });
      }
      setProductOpen(false);
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSavingProduct(false);
    }
  };

  const removeProduct = async (product: CatalogProduct) => {
    try {
      await catalogApi.deleteProduct(tenantId, product.id);
      setSnapshot((current) =>
        current ? { ...current, products: current.products.filter((entry) => entry.id !== product.id) } : current,
      );
      toast.push({ title: t('catalog.productDeleted') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const setAvailability = async (product: CatalogProduct, available: boolean, reason?: string, until?: string) => {
    try {
      const result = await catalogApi.setAvailability(tenantId, product.id, { available, reason, until });
      applyProductResult(result.product);
      toast.push({ title: t('catalog.availabilityUpdated') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const confirmOffSale = async () => {
    if (!offSaleTarget) return;
    await setAvailability(
      offSaleTarget,
      false,
      offSaleReason.trim() || undefined,
      offSaleUntil ? new Date(offSaleUntil).toISOString() : undefined,
    );
    setOffSaleTarget(null);
    setOffSaleReason('');
    setOffSaleUntil('');
  };

  const savePromotion = async () => {
    if (!promoForm.name.trim()) return;
    setSavingPromo(true);
    try {
      const result = await catalogApi.createPromotion(tenantId, {
        name: promoForm.name.trim(),
        code: promoForm.code.trim() || undefined,
        type: promoForm.type,
        value: Number(promoForm.value) || 0,
        scope: promoForm.scope,
        targetId: promoForm.scope === 'all' ? undefined : promoForm.targetId || undefined,
        startsAt: new Date(`${promoForm.startsAt}T00:00:00`).toISOString(),
        endsAt: new Date(`${promoForm.endsAt}T23:59:59`).toISOString(),
      });
      setSnapshot((current) =>
        current ? { ...current, promotions: [...current.promotions, result.promotion] } : current,
      );
      toast.push({ title: t('catalog.promoSaved') });
      setPromoOpen(false);
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSavingPromo(false);
    }
  };

  const removePromotion = async (promotion: Promotion) => {
    try {
      await catalogApi.deletePromotion(tenantId, promotion.id);
      setSnapshot((current) =>
        current
          ? { ...current, promotions: current.promotions.filter((entry) => entry.id !== promotion.id) }
          : current,
      );
      toast.push({ title: t('catalog.promoDeleted') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const saveMenu = async () => {
    if (!menuForm.name.trim() || menuItems.length === 0) return;
    setSavingMenu(true);
    try {
      const result = await catalogApi.createMenu(tenantId, {
        name: menuForm.name.trim(),
        description: menuForm.description.trim() || undefined,
        priceXof: Number(menuForm.priceXof) || 0,
        items: menuItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      });
      setSnapshot((current) => (current ? { ...current, menus: [...current.menus, result.menu] } : current));
      toast.push({ title: t('catalog.menuSaved') });
      setMenuOpen(false);
      setMenuForm({ name: '', description: '', priceXof: '' });
      setMenuItems([]);
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSavingMenu(false);
    }
  };

  const removeMenu = async (menu: ComposedMenu) => {
    try {
      await catalogApi.deleteMenu(tenantId, menu.id);
      setSnapshot((current) =>
        current ? { ...current, menus: current.menus.filter((entry) => entry.id !== menu.id) } : current,
      );
      toast.push({ title: t('catalog.menuDeleted') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const columns: Array<Column<CatalogProduct>> = [
    {
      key: 'product',
      header: t('catalog.colProduct'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>
            {row.description ? `${row.description.slice(0, 60)}${row.description.length > 60 ? '…' : ''} · ` : ''}
            {row.variants.length ? `${row.variants.length} variante(s)` : '—'}
            {row.allergens.length ? ` · ${row.allergens.length} allergène(s)` : ''}
          </span>
        </div>
      ),
    },
    { key: 'category', header: t('catalog.colCategory'), render: (row) => categoryName_(row.categoryId) },
    {
      key: 'price',
      header: t('catalog.colPrice'),
      align: 'right',
      render: (row) => (
        <div className="console-cell console-cell--end">
          <strong>{formatXof(row.effectivePriceXof, locale)}</strong>
          {row.activePriceRule ? (
            <Badge tone="accent" icon="clock">{row.activePriceRule.label}</Badge>
          ) : row.effectivePriceXof !== row.basePriceXof ? (
            <span>{formatXof(row.basePriceXof, locale)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'availability',
      header: t('catalog.colStatus'),
      render: (row) => (
        <div className="console-roles">
          <Badge tone={!row.active ? 'neutral' : row.availability.available ? 'success' : 'danger'} dot>
            {!row.active ? 'Archivé' : row.availability.available ? t('catalog.available') : t('catalog.unavailable')}
          </Badge>
          {row.priceRules.length > 0 && <Badge tone="info" icon="clock">HH</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="console-roles console-roles--end">
          {row.availability.available ? (
            <Button size="sm" variant="ghost" onClick={() => setOffSaleTarget(row)}>
              {t('catalog.markUnavailable')}
            </Button>
          ) : (
            <Button size="sm" variant="soft" onClick={() => void setAvailability(row, true)}>
              {t('catalog.markAvailable')}
            </Button>
          )}
          <Button size="sm" variant="ghost" iconLeft="edit" onClick={() => openEdit(row)}>
            {t('catalog.edit')}
          </Button>
          <Button size="sm" variant="ghost" iconLeft="trash" onClick={() => void removeProduct(row)}>
            {t('catalog.delete')}
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <Card><CardBody><SkeletonText lines={8} /></CardBody></Card>
    );
  }

  if (error || !snapshot) {
    return (
      <Card className="console-alert">
        <CardBody>
          <p className="auth-error" role="alert">{error ?? t('catalog.error')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>{t('workspace.retry')}</Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="console-stack">
      <div className="console-stats">
        {[
          {
            label: t('catalog.products'),
            value: stats.products,
            icon: 'utensils' as const,
            meta: t('catalog.onSale', { count: stats.available }),
          },
          { label: t('catalog.categoriesCount'), value: stats.categories, icon: 'layers' as const, meta: t('catalog.menuStructure') },
          { label: t('catalog.menusCount'), value: stats.menus, icon: 'receipt' as const, meta: t('catalog.combos') },
          { label: t('catalog.promosCount'), value: stats.promos, icon: 'gift' as const, meta: t('catalog.running') },
          { label: t('catalog.offSale'), value: stats.offSale, icon: 'alert' as const, meta: t('catalog.watch') },
        ].map((stat) => (
          <Card key={stat.label} className="ws-sub-card">
            <CardBody>
              <span className="console-muted">{stat.label}</span>
              <strong className="ws-sub-card__value">{stat.value}</strong>
              <Badge
                tone={stat.label === t('catalog.offSale') && stat.value > 0 ? 'danger' : 'neutral'}
                icon={stat.icon}
              >
                {stat.meta}
              </Badge>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title={t('catalog.title')}
          subtitle={t('catalog.subtitle')}
          action={
            <div className="cat-header-actions">
              <Badge tone="neutral" icon="clock">
                {t('catalog.timeZoneLabel', { zone: snapshot.timeZone })}
              </Badge>
              <Button iconLeft="plus" size="sm" onClick={openCreate} disabled={snapshot.categories.length === 0}>
                {t('catalog.newProduct')}
              </Button>
            </div>
          }
        />
        <CardBody>
          <div className="cat-toolbar">
            <Input
              leadingIcon="search"
              placeholder={t('catalog.search')}
              aria-label={t('catalog.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              aria-label={t('catalog.allCategories')}
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              options={[
                { value: '', label: t('catalog.allCategories') },
                ...snapshot.categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          </div>
          <div className="cat-chips" aria-label={t('catalog.categoriesCount')}>
            {snapshot.categories.map((category) => (
              <span key={category.id} className="cat-chip">
                <strong>{category.name}</strong>
                <span>{snapshot.products.filter((product) => product.categoryId === category.id).length}</span>
                <button type="button" aria-label={`${t('catalog.delete')} ${category.name}`} onClick={() => void removeCategory(category.id)}>
                  ×
                </button>
              </span>
            ))}
            <div className="cat-chip-add">
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder={t('catalog.categoryName')}
                aria-label={t('catalog.categoryName')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addCategory();
                }}
              />
              <Button size="sm" variant="soft" loading={categoryPending} onClick={() => void addCategory()} iconLeft="plus">
                {t('catalog.create')}
              </Button>
            </div>
          </div>

          {products.length === 0 ? (
            <EmptyState
              icon="utensils"
              title={snapshot.products.length === 0 ? t('catalog.emptyTitle') : t('catalog.noProducts')}
              description={t('catalog.emptyBody')}
              action={
                snapshot.categories.length > 0 ? (
                  <Button onClick={openCreate} iconLeft="plus">{t('catalog.newProduct')}</Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable columns={columns} rows={products} getRowId={(row) => row.id} caption={t('catalog.title')} />
          )}
        </CardBody>
      </Card>

      <div className="console-2col console-2col--wide">
        <Card>
          <CardHeader
            title={t('catalog.promotions')}
            subtitle={t('catalog.subtitle')}
            action={<Button size="sm" variant="outline" iconLeft="plus" onClick={() => setPromoOpen(true)}>{t('catalog.newPromotion')}</Button>}
          />
          <CardBody>
            {snapshot.promotions.length === 0 ? (
              <EmptyState icon="gift" title={t('catalog.promotions')} description={t('catalog.noPromo')} />
            ) : (
              <ul className="cat-list">
                {snapshot.promotions.map((promotion) => {
                  const running = promotion.active && new Date(promotion.startsAt) <= new Date() && new Date(promotion.endsAt) >= new Date();
                  return (
                    <li key={promotion.id}>
                      <div>
                        <strong>{promotion.name}</strong>
                        <span>
                          {promotion.code ? `${promotion.code} · ` : ''}
                          {promotion.type === 'percent' ? `−${promotion.value}%` : `−${formatXof(promotion.value, locale)}`}
                          {' · '}
                          {formatDate(promotion.startsAt, locale)} → {formatDate(promotion.endsAt, locale)}
                        </span>
                      </div>
                      <div className="console-roles">
                        <Badge tone={running ? 'success' : 'neutral'} dot>
                          {running ? t('catalog.happyHourActive') : promotion.active ? 'Planifiée' : 'Inactive'}
                        </Badge>
                        <Button size="sm" variant="ghost" iconLeft="trash" onClick={() => void removePromotion(promotion)}>
                          {t('catalog.delete')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('catalog.menus')}
            action={<Button size="sm" variant="outline" iconLeft="plus" onClick={() => setMenuOpen(true)}>{t('catalog.newMenu')}</Button>}
          />
          <CardBody>
            {snapshot.menus.length === 0 ? (
              <EmptyState icon="receipt" title={t('catalog.menus')} description={t('catalog.noMenu')} />
            ) : (
              <ul className="cat-list">
                {snapshot.menus.map((menu) => (
                  <li key={menu.id}>
                    <div>
                      <strong>{menu.name}</strong>
                      <span>
                        {formatXof(menu.priceXof, locale)} · {t('catalog.items', { count: menu.items.length })}
                        {menu.items.length ? ` · ${menu.items.map((item) => item.name ?? '—').join(', ')}` : ''}
                      </span>
                    </div>
                    <div className="console-roles">
                      <Badge tone={menu.active ? 'success' : 'neutral'} dot>{menu.active ? t('catalog.available') : 'Inactif'}</Badge>
                      <Button size="sm" variant="ghost" iconLeft="trash" onClick={() => void removeMenu(menu)}>
                        {t('catalog.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={productOpen}
        onClose={() => setProductOpen(false)}
        title={editing ? t('catalog.editProduct') : t('catalog.newProduct')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProductOpen(false)}>{t('catalog.cancel')}</Button>
            <Button loading={savingProduct} onClick={() => void saveProduct()} iconLeft="check">
              {editing ? t('catalog.save') : t('catalog.create')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('catalog.name')}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
            <Select
              label={t('catalog.category')}
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              options={snapshot.categories.map((category) => ({ value: category.id, label: category.name }))}
            />
          </div>
          <Textarea
            label={t('catalog.description')}
            value={form.description}
            rows={2}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('catalog.priceXof')}
              type="number"
              min={0}
              value={form.basePriceXof}
              onChange={(event) => setForm({ ...form, basePriceXof: event.target.value })}
              required
            />
            <div className="cat-inline-field">
              <Checkbox
                label={t('catalog.available')}
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
            </div>
          </div>
          <Textarea
            label={t('catalog.photos')}
            value={form.photos}
            rows={2}
            placeholder="https://…/plat.jpg"
            onChange={(event) => setForm({ ...form, photos: event.target.value })}
          />

          <fieldset className="cat-fieldset">
            <legend>{t('catalog.allergens')}</legend>
            <div className="cat-allergens">
              {ALLERGENS.map((allergen) => (
                <label key={allergen} className="cat-check">
                  <input
                    type="checkbox"
                    checked={form.allergens.includes(allergen)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        allergens: event.target.checked
                          ? [...form.allergens, allergen]
                          : form.allergens.filter((entry) => entry !== allergen),
                      })
                    }
                  />
                  <span>{ALLERGEN_LABEL[allergen]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="cat-fieldset">
            <legend>{t('catalog.variants')}</legend>
            {form.variants.map((variant, index) => (
              <div className="cat-row" key={index}>
                <input
                  aria-label={t('catalog.variantName')}
                  placeholder={t('catalog.variantName')}
                  value={variant.name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      variants: form.variants.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)),
                    })
                  }
                />
                <input
                  aria-label={t('catalog.variantPrice')}
                  placeholder={t('catalog.variantPrice')}
                  type="number"
                  min={0}
                  value={variant.priceXof}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      variants: form.variants.map((entry, i) => (i === index ? { ...entry, priceXof: event.target.value } : entry)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={t('catalog.delete')}
                  iconLeft="trash"
                  onClick={() => setForm({ ...form, variants: form.variants.filter((_, i) => i !== index) })}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="soft"
              iconLeft="plus"
              onClick={() => setForm({ ...form, variants: [...form.variants, { name: '', priceXof: '' }] })}
            >
              {t('catalog.addVariant')}
            </Button>
          </fieldset>

          <fieldset className="cat-fieldset">
            <legend>{t('catalog.priceRules')}</legend>
            {form.priceRules.map((rule, index) => (
              <div className="cat-rule" key={index}>
                <input
                  aria-label={t('catalog.ruleLabel')}
                  placeholder={t('catalog.ruleLabel')}
                  value={rule.label}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      priceRules: form.priceRules.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)),
                    })
                  }
                />
                <div className="cat-days" role="group" aria-label={t('catalog.ruleDays')}>
                  {DAYS.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      className={rule.days.includes(day.key) ? 'cat-day is-on' : 'cat-day'}
                      aria-pressed={rule.days.includes(day.key)}
                      onClick={() =>
                        setForm({
                          ...form,
                          priceRules: form.priceRules.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  days: entry.days.includes(day.key)
                                    ? entry.days.filter((key) => key !== day.key)
                                    : [...entry.days, day.key],
                                }
                              : entry,
                          ),
                        })
                      }
                    >
                      {locale === 'en' ? day.en : day.fr}
                    </button>
                  ))}
                </div>
                <div className="cat-row">
                  <input
                    aria-label={t('catalog.ruleStart')}
                    type="time"
                    value={rule.start}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        priceRules: form.priceRules.map((entry, i) => (i === index ? { ...entry, start: event.target.value } : entry)),
                      })
                    }
                  />
                  <input
                    aria-label={t('catalog.ruleEnd')}
                    type="time"
                    value={rule.end}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        priceRules: form.priceRules.map((entry, i) => (i === index ? { ...entry, end: event.target.value } : entry)),
                      })
                    }
                  />
                  <input
                    aria-label={t('catalog.rulePrice')}
                    type="number"
                    min={0}
                    placeholder={t('catalog.rulePrice')}
                    value={rule.priceXof}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        priceRules: form.priceRules.map((entry, i) => (i === index ? { ...entry, priceXof: event.target.value } : entry)),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={t('catalog.delete')}
                    iconLeft="trash"
                    onClick={() => setForm({ ...form, priceRules: form.priceRules.filter((_, i) => i !== index) })}
                  />
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="soft"
              iconLeft="plus"
              onClick={() =>
                setForm({
                  ...form,
                  priceRules: [...form.priceRules, { label: 'Happy hour', days: ['lun', 'mar', 'mer', 'jeu'], start: '17:00', end: '19:00', priceXof: '' }],
                })
              }
            >
              {t('catalog.addPriceRule')}
            </Button>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={Boolean(offSaleTarget)}
        onClose={() => setOffSaleTarget(null)}
        title={t('catalog.markUnavailable')}
        description={offSaleTarget?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOffSaleTarget(null)}>{t('catalog.cancel')}</Button>
            <Button variant="danger" onClick={() => void confirmOffSale()}>{t('catalog.save')}</Button>
          </>
        }
      >
        <div className="console-stack">
          <Input
            label={t('catalog.availabilityReason')}
            value={offSaleReason}
            onChange={(event) => setOffSaleReason(event.target.value)}
            placeholder="Ingrédients épuisés"
          />
          <Input
            label={t('catalog.availabilityUntil')}
            type="datetime-local"
            value={offSaleUntil}
            onChange={(event) => setOffSaleUntil(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        title={t('catalog.newPromotion')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoOpen(false)}>{t('catalog.cancel')}</Button>
            <Button loading={savingPromo} onClick={() => void savePromotion()}>{t('catalog.create')}</Button>
          </>
        }
      >
        <div className="console-stack">
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('catalog.promoName')}
              value={promoForm.name}
              onChange={(event) => setPromoForm({ ...promoForm, name: event.target.value })}
              required
            />
            <Input
              label={t('catalog.promoCode')}
              value={promoForm.code}
              onChange={(event) => setPromoForm({ ...promoForm, code: event.target.value.toUpperCase() })}
              placeholder="ETUD10"
            />
          </div>
          <div className="reg-grid reg-grid--2">
            <Select
              label={t('catalog.promoType')}
              value={promoForm.type}
              onChange={(event) => setPromoForm({ ...promoForm, type: event.target.value as 'percent' | 'amount' })}
              options={[
                { value: 'percent', label: t('catalog.promoPercent') },
                { value: 'amount', label: t('catalog.promoAmount') },
              ]}
            />
            <Input
              label={t('catalog.promoValue')}
              type="number"
              min={0}
              value={promoForm.value}
              onChange={(event) => setPromoForm({ ...promoForm, value: event.target.value })}
            />
          </div>
          <div className="reg-grid reg-grid--2">
            <Select
              label={t('catalog.promoScope')}
              value={promoForm.scope}
              onChange={(event) => setPromoForm({ ...promoForm, scope: event.target.value as 'all' | 'category' | 'product', targetId: '' })}
              options={[
                { value: 'all', label: t('catalog.scopeAll') },
                { value: 'category', label: t('catalog.scopeCategory') },
                { value: 'product', label: t('catalog.scopeProduct') },
              ]}
            />
            {promoForm.scope !== 'all' && (
              <Select
                label={promoForm.scope === 'category' ? t('catalog.category') : t('catalog.colProduct')}
                value={promoForm.targetId}
                onChange={(event) => setPromoForm({ ...promoForm, targetId: event.target.value })}
                options={[
                  { value: '', label: '—' },
                  ...(promoForm.scope === 'category' ? snapshot.categories : snapshot.products).map((entry) => ({
                    value: entry.id,
                    label: entry.name,
                  })),
                ]}
              />
            )}
          </div>
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('catalog.startDate')}
              type="date"
              value={promoForm.startsAt}
              onChange={(event) => setPromoForm({ ...promoForm, startsAt: event.target.value })}
            />
            <Input
              label={t('catalog.endDate')}
              type="date"
              value={promoForm.endsAt}
              onChange={(event) => setPromoForm({ ...promoForm, endsAt: event.target.value })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t('catalog.newMenu')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMenuOpen(false)}>{t('catalog.cancel')}</Button>
            <Button loading={savingMenu} onClick={() => void saveMenu()} disabled={menuItems.length === 0}>
              {t('catalog.create')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('catalog.menuName')}
              value={menuForm.name}
              onChange={(event) => setMenuForm({ ...menuForm, name: event.target.value })}
            />
            <Input
              label={t('catalog.menuPrice')}
              type="number"
              min={0}
              value={menuForm.priceXof}
              onChange={(event) => setMenuForm({ ...menuForm, priceXof: event.target.value })}
            />
          </div>
          <Textarea
            label={t('catalog.description')}
            rows={2}
            value={menuForm.description}
            onChange={(event) => setMenuForm({ ...menuForm, description: event.target.value })}
          />
          <Select
            label={t('catalog.addItem')}
            value=""
            onChange={(event) => {
              const productId = event.target.value;
              if (!productId) return;
              setMenuItems((current) =>
                current.some((item) => item.productId === productId)
                  ? current
                  : [...current, { productId, quantity: 1 }],
              );
            }}
            options={[
              { value: '', label: '—' },
              ...snapshot.products.map((product) => ({ value: product.id, label: `${product.name} · ${formatXof(product.effectivePriceXof, locale)}` })),
            ]}
          />
          {menuItems.length > 0 && (
            <ul className="cat-list cat-list--tight">
              {menuItems.map((item) => {
                const product = snapshot.products.find((entry) => entry.id === item.productId);
                return (
                  <li key={item.productId}>
                    <div>
                      <strong>{product?.name ?? item.productId}</strong>
                      <span>{product ? formatXof(product.effectivePriceXof, locale) : ''}</span>
                    </div>
                    <div className="console-roles">
                      <input
                        className="cat-qty"
                        type="number"
                        min={1}
                        max={20}
                        aria-label="Quantité"
                        value={item.quantity}
                        onChange={(event) =>
                          setMenuItems((current) =>
                            current.map((entry) =>
                              entry.productId === item.productId
                                ? { ...entry, quantity: Math.max(1, Number(event.target.value) || 1) }
                                : entry,
                            ),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={t('catalog.delete')}
                        iconLeft="trash"
                        onClick={() => setMenuItems((current) => current.filter((entry) => entry.productId !== item.productId))}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
