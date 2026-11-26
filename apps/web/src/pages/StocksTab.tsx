import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  Modal,
  SegmentedControl,
  Select,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  catalogApi,
  errorMessage,
  inventoryApi,
  type CatalogProduct,
  type InventoryAuditEntry,
  type InventoryCountView,
  type InventorySummary,
  type PurchaseOrderView,
  type RecipeView,
  type ReorderSuggestion,
  type StockItem,
  type StockLocation,
  type StockMovement,
  type StockMovementType,
  type StockSupplier,
  type StockUnit,
} from '../lib/api';

type Section = 'overview' | 'items' | 'movements' | 'recipes' | 'suppliers' | 'counts' | 'audit';

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

const UNITS: StockUnit[] = ['kg', 'g', 'l', 'cl', 'pcs', 'btl'];
const LOCATIONS: StockLocation[] = ['reserve', 'cuisine', 'bar'];
const MOVEMENTS: StockMovementType[] = ['in', 'out', 'adjust', 'waste'];

const PO_TONE: Record<string, BadgeTone> = {
  brouillon: 'neutral',
  commandee: 'info',
  recue: 'success',
};

const EMPTY_ITEM = {
  name: '',
  sku: '',
  unit: 'kg' as StockUnit,
  category: '',
  quantity: '0',
  threshold: '5',
  costXof: '1000',
  supplierId: '',
  location: 'reserve' as StockLocation,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StocksTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canView = permissions.includes('inventory:view');
  const canManage = permissions.includes('inventory:manage');

  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [recipes, setRecipes] = useState<RecipeView[]>([]);
  const [suppliers, setSuppliers] = useState<StockSupplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderView[]>([]);
  const [counts, setCounts] = useState<InventoryCountView[]>([]);
  const [audit, setAudit] = useState<{ entries: InventoryAuditEntry[]; integrity: boolean } | null>(
    null,
  );
  const [products, setProducts] = useState<CatalogProduct[]>([]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [movementType, setMovementType] = useState<'all' | StockMovementType>('all');

  const [itemModal, setItemModal] = useState(false);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [editing, setEditing] = useState<StockItem | null>(null);

  const [movementModal, setMovementModal] = useState<'movement' | 'waste' | null>(null);
  const [movementForm, setMovementForm] = useState({
    itemId: '',
    type: 'in' as 'in' | 'out' | 'adjust',
    quantity: '',
    reason: '',
    unitCostXof: '',
  });

  const [recipeModal, setRecipeModal] = useState(false);
  const [recipeForm, setRecipeForm] = useState({
    productId: '',
    productName: '',
    productPriceXof: '',
    yieldQty: '1',
    lines: [{ itemId: '', quantity: '' }],
  });

  const [supplierModal, setSupplierModal] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    email: '',
    termsDays: '30',
    notes: '',
  });

  const [countModal, setCountModal] = useState(false);
  const [countDate, setCountDate] = useState(todayIso());
  const [counted, setCounted] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const [sum, list, mov, rec, sup, po, cnt, log, snap] = await Promise.all([
        inventoryApi.summary(tenantId),
        inventoryApi.items(tenantId),
        inventoryApi.movements(tenantId),
        inventoryApi.recipes(tenantId),
        inventoryApi.suppliers(tenantId),
        inventoryApi.purchaseOrders(tenantId),
        inventoryApi.counts(tenantId),
        inventoryApi.audit(tenantId),
        canManage ? catalogApi.snapshot(tenantId).catch(() => null) : Promise.resolve(null),
      ]);
      setSummary(sum);
      setItems(list.items);
      setCategories(list.categories);
      setMovements(mov.movements);
      setRecipes(rec.recipes);
      setSuppliers(sup.suppliers);
      setPurchaseOrders(po.purchaseOrders);
      setCounts(cnt.counts);
      setAudit({ entries: log.entries, integrity: log.integrity });
      setProducts(snap?.products ?? []);
      const alertResult = await inventoryApi.alerts(tenantId).catch(() => null);
      setSuggestions(alertResult?.suggestions ?? []);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId, canView, canManage]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const run = async (task: () => Promise<void>, success: string) => {
    setPending(true);
    try {
      await task();
      toast.push({ title: success, tone: 'success' });
      await reload();
    } catch (cause) {
      toast.push({ title: t('stocks.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => !category || item.category === category)
      .filter((item) => !query || `${item.name} ${item.sku}`.toLowerCase().includes(query));
  }, [items, search, category]);

  const filteredMovements = useMemo(
    () => movements.filter((entry) => movementType === 'all' || entry.type === movementType),
    [movements, movementType],
  );

  const openItem = (item?: StockItem) => {
    setEditing(item ?? null);
    setItemForm(
      item
        ? {
            name: item.name,
            sku: item.sku,
            unit: item.unit,
            category: item.category,
            quantity: String(item.quantity),
            threshold: String(item.threshold),
            costXof: String(item.costXof),
            supplierId: item.supplierId ?? '',
            location: item.location,
          }
        : { ...EMPTY_ITEM, category: categories[0] ?? '' },
    );
    setItemModal(true);
  };

  const saveItem = () =>
    run(
      async () => {
        const payload = {
          name: itemForm.name,
          unit: itemForm.unit,
          category: itemForm.category,
          threshold: Number(itemForm.threshold) || 0,
          costXof: Number(itemForm.costXof) || 0,
          supplierId: itemForm.supplierId || undefined,
          location: itemForm.location,
        };
        if (editing) {
          await inventoryApi.updateItem(tenantId, editing.id, payload);
        } else {
          await inventoryApi.createItem(tenantId, {
            ...payload,
            sku: itemForm.sku,
            quantity: Number(itemForm.quantity) || 0,
          });
        }
        setItemModal(false);
        setEditing(null);
        setItemForm(EMPTY_ITEM);
      },
      editing ? t('stocks.updated') : t('stocks.created'),
    );

  const saveMovement = () =>
    run(
      async () => {
        if (movementModal === 'waste') {
          await inventoryApi.createWaste(tenantId, {
            itemId: movementForm.itemId,
            quantity: Number(movementForm.quantity) || 0,
            reason: movementForm.reason,
          });
        } else {
          await inventoryApi.createMovement(tenantId, {
            itemId: movementForm.itemId,
            type: movementForm.type,
            quantity: Number(movementForm.quantity) || 0,
            reason: movementForm.reason,
            ...(movementForm.unitCostXof ? { unitCostXof: Number(movementForm.unitCostXof) } : {}),
          });
        }
        setMovementModal(null);
        setMovementForm({ itemId: '', type: 'in', quantity: '', reason: '', unitCostXof: '' });
      },
      movementModal === 'waste' ? t('stocks.wasteSaved') : t('stocks.movementSaved'),
    );

  const saveRecipe = () =>
    run(async () => {
      await inventoryApi.createRecipe(tenantId, {
        productId: recipeForm.productId,
        productName: recipeForm.productName,
        productPriceXof: Number(recipeForm.productPriceXof) || 0,
        yieldQty: Number(recipeForm.yieldQty) || 1,
        lines: recipeForm.lines
          .filter((line) => line.itemId && Number(line.quantity) > 0)
          .map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) })),
      });
      setRecipeModal(false);
      setRecipeForm({
        productId: '',
        productName: '',
        productPriceXof: '',
        yieldQty: '1',
        lines: [{ itemId: '', quantity: '' }],
      });
    }, t('stocks.recipeCreated'));

  const saveSupplier = () =>
    run(async () => {
      await inventoryApi.createSupplier(tenantId, {
        name: supplierForm.name,
        contactName: supplierForm.contactName || undefined,
        phone: supplierForm.phone || undefined,
        email: supplierForm.email || undefined,
        termsDays: Number(supplierForm.termsDays) || 0,
        notes: supplierForm.notes || undefined,
      });
      setSupplierModal(false);
      setSupplierForm({
        name: '',
        contactName: '',
        phone: '',
        email: '',
        termsDays: '30',
        notes: '',
      });
    }, t('stocks.supplierCreated'));

  const saveCount = () =>
    run(async () => {
      const lines = Object.entries(counted)
        .filter(([, value]) => value !== '')
        .map(([itemId, value]) => ({ itemId, counted: Number(value) }));
      await inventoryApi.createCount(tenantId, { date: countDate, lines });
      setCountModal(false);
      setCounted({});
    }, t('stocks.countCreated'));

  const validateCount = (count: InventoryCountView) =>
    run(async () => {
      await inventoryApi.validateCount(tenantId, count.id);
    }, t('stocks.validated'));

  const receivePurchase = (order: PurchaseOrderView) =>
    run(async () => {
      await inventoryApi.receivePurchaseOrder(tenantId, order.id);
    }, t('stocks.received'));

  if (!canView) {
    return (
      <EmptyState icon="lock" title={t('stocks.forbidden')} description={t('stocks.readOnly')} />
    );
  }

  if (loading && !summary) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={8} />
          <p className="console-muted">{t('stocks.loading')}</p>
        </CardBody>
      </Card>
    );
  }

  const itemColumns: Column<StockItem>[] = [
    {
      key: 'name',
      header: t('stocks.colName'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.sku}</span>
        </div>
      ),
    },
    { key: 'category', header: t('stocks.colCategory'), render: (row) => row.category },
    {
      key: 'qty',
      header: t('stocks.colQty'),
      align: 'right',
      render: (row) => `${row.quantity.toLocaleString(locale)} ${row.unit}`,
    },
    {
      key: 'threshold',
      header: t('stocks.colThreshold'),
      align: 'right',
      render: (row) => `${row.threshold.toLocaleString(locale)} ${row.unit}`,
    },
    {
      key: 'cost',
      header: t('stocks.colCost'),
      align: 'right',
      render: (row) => formatXof(row.costXof, locale),
    },
    {
      key: 'value',
      header: t('stocks.colValue'),
      align: 'right',
      render: (row) => formatXof(row.valueXof, locale),
    },
    { key: 'location', header: t('stocks.colLocation'), render: (row) => row.location },
    {
      key: 'status',
      header: t('stocks.colStatus'),
      render: (row) =>
        row.depleted ? (
          <Badge tone="danger" dot>
            {t('stocks.statusOut')}
          </Badge>
        ) : row.low ? (
          <Badge tone="warning" dot>
            {t('stocks.statusLow')}
          </Badge>
        ) : (
          <Badge tone="success" dot>
            {t('stocks.statusOk')}
          </Badge>
        ),
    },
    {
      key: 'action',
      header: t('stocks.colAction'),
      render: (row) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" onClick={() => openItem(row)}>
            {t('stocks.edit')}
          </Button>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMovementForm({
                  itemId: row.id,
                  type: 'in',
                  quantity: '',
                  reason: '',
                  unitCostXof: '',
                });
                setMovementModal('movement');
              }}
            >
              {t('stocks.newMovement')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const movementColumns: Column<StockMovement>[] = [
    {
      key: 'at',
      header: t('stocks.colDate'),
      render: (row) =>
        formatDate(row.at, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    { key: 'item', header: t('stocks.colItem'), render: (row) => row.itemName },
    {
      key: 'type',
      header: t('stocks.colType'),
      render: (row) => (
        <Badge
          tone={
            row.type === 'waste'
              ? 'danger'
              : row.type === 'in'
                ? 'success'
                : row.type === 'out'
                  ? 'info'
                  : 'warning'
          }
        >
          {t(`stocks.type.${row.type}`)}
        </Badge>
      ),
    },
    {
      key: 'qty',
      header: t('stocks.colQuantity'),
      align: 'right',
      render: (row) => {
        const item = items.find((entry) => entry.id === row.itemId);
        const sign =
          row.type === 'in' ? '+' : row.type === 'out' || row.type === 'waste' ? '−' : '';
        return `${sign}${Math.abs(row.quantity).toLocaleString(locale)} ${item?.unit ?? ''}`;
      },
    },
    { key: 'reason', header: t('stocks.colReason'), render: (row) => row.reason },
    { key: 'actor', header: t('stocks.colActor'), render: (row) => row.actor },
  ];

  const recipeColumns: Column<RecipeView>[] = [
    {
      key: 'product',
      header: t('stocks.colProduct'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.productName}</strong>
          <span>
            {row.lines.length} {t('stocks.ingredientsTitle').toLowerCase()}
          </span>
        </div>
      ),
    },
    {
      key: 'price',
      header: t('stocks.colPrice'),
      align: 'right',
      render: (row) => formatXof(row.productPriceXof, locale),
    },
    {
      key: 'cost',
      header: t('stocks.colRecipeCost'),
      align: 'right',
      render: (row) => formatXof(row.costXof, locale),
    },
    {
      key: 'margin',
      header: t('stocks.colMargin'),
      align: 'right',
      render: (row) => formatXof(row.marginXof, locale),
    },
    {
      key: 'rate',
      header: t('stocks.colMarginRate'),
      align: 'right',
      render: (row) => `${row.marginRate} %`,
    },
    { key: 'max', header: t('stocks.colMax'), align: 'right', render: (row) => row.maxProducible },
  ];

  const supplierColumns: Column<StockSupplier>[] = [
    {
      key: 'name',
      header: t('stocks.colName'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.contactName ?? '—'}</span>
        </div>
      ),
    },
    { key: 'phone', header: t('stocks.colPhone'), render: (row) => row.phone ?? '—' },
    { key: 'terms', header: t('stocks.colTerms'), align: 'right', render: (row) => row.termsDays },
    {
      key: 'status',
      header: t('stocks.colSupplierStatus'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'} dot>
          {row.status === 'active' ? t('stocks.statusActive') : t('stocks.statusInactive')}
        </Badge>
      ),
    },
  ];

  const purchaseColumns: Column<PurchaseOrderView>[] = [
    {
      key: 'number',
      header: t('stocks.colPoNumber'),
      render: (row) => <strong>{row.number}</strong>,
    },
    { key: 'supplier', header: t('stocks.colSupplier'), render: (row) => row.supplierName },
    {
      key: 'total',
      header: t('stocks.poTotal'),
      align: 'right',
      render: (row) => formatXof(row.totalXof, locale),
    },
    {
      key: 'status',
      header: t('stocks.colPoStatus'),
      render: (row) => (
        <Badge tone={PO_TONE[row.status] ?? 'neutral'}>{t(`stocks.poStatus.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'created',
      header: t('stocks.colDate'),
      render: (row) => formatDate(row.createdAt, locale),
    },
    {
      key: 'action',
      header: t('stocks.colAction'),
      render: (row) =>
        canManage && row.status !== 'recue' ? (
          <Button size="sm" variant="outline" onClick={() => void receivePurchase(row)}>
            {t('stocks.receive')}
          </Button>
        ) : (
          <span className="console-muted">
            {row.receivedAt ? formatDate(row.receivedAt, locale) : '—'}
          </span>
        ),
    },
  ];

  const countColumns: Column<InventoryCountView>[] = [
    {
      key: 'date',
      header: t('stocks.colCountDate'),
      render: (row) => formatDate(row.date, locale),
    },
    {
      key: 'lines',
      header: t('stocks.colCountLines'),
      align: 'right',
      render: (row) => row.lines.length,
    },
    {
      key: 'variance',
      header: t('stocks.colCountVariance'),
      align: 'right',
      render: (row) =>
        formatXof(
          row.lines.reduce((total, line) => total + line.varianceCostXof, 0),
          locale,
        ),
    },
    {
      key: 'status',
      header: t('stocks.colCountStatus'),
      render: (row) => (
        <Badge tone={row.status === 'valide' ? 'success' : 'neutral'} dot>
          {t(`stocks.countStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('stocks.colAction'),
      render: (row) =>
        canManage && row.status === 'brouillon' ? (
          <Button size="sm" onClick={() => void validateCount(row)}>
            {t('stocks.validate')}
          </Button>
        ) : (
          <span className="console-muted">—</span>
        ),
    },
  ];

  const auditColumns: Column<InventoryAuditEntry>[] = [
    {
      key: 'at',
      header: t('stocks.colAt'),
      render: (row) =>
        formatDate(row.createdAt, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    { key: 'actor', header: t('stocks.colActor'), render: (row) => row.actorId },
    {
      key: 'action',
      header: t('stocks.colAction'),
      render: (row) => <Badge tone="neutral">{row.action}</Badge>,
    },
    {
      key: 'target',
      header: t('stocks.colTarget'),
      render: (row) => `${row.targetType} · ${row.targetId}`,
    },
  ];

  return (
    <div className="console-stack">
      <div className="console-toolbar">
        <SegmentedControl<Section>
          ariaLabel={t('stocks.title')}
          value={section}
          onChange={setSection}
          options={[
            { value: 'overview', label: t('stocks.sectionOverview') },
            { value: 'items', label: t('stocks.sectionItems') },
            { value: 'movements', label: t('stocks.sectionMovements') },
            { value: 'recipes', label: t('stocks.sectionRecipes') },
            { value: 'suppliers', label: t('stocks.sectionSuppliers') },
            { value: 'counts', label: t('stocks.sectionCounts') },
            { value: 'audit', label: t('stocks.sectionAudit') },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!canManage && <Badge tone="neutral">{t('stocks.readOnly')}</Badge>}
          <Button variant="outline" size="sm" iconLeft="refresh" onClick={() => void reload()}>
            {t('stocks.refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {section === 'overview' && (
        <>
          <div className="console-stats">
            <StatCard label={t('stocks.statItems')} value={summary?.itemCount ?? 0} icon="box" />
            <StatCard
              label={t('stocks.statLow')}
              value={summary?.lowStockCount ?? 0}
              icon="alert"
              meta={`${summary?.recipeCount ?? 0} ${t('stocks.statRecipes').toLowerCase()}`}
            />
            <StatCard
              label={t('stocks.statValue')}
              value={formatXof(summary?.stockValueXof ?? 0, locale)}
              icon="wallet"
            />
            <StatCard
              label={t('stocks.statWaste')}
              value={formatXof(summary?.waste30dXof ?? 0, locale)}
              icon="trash"
              meta={`${summary?.supplierCount ?? 0} ${t('stocks.statSuppliers').toLowerCase()}`}
            />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader
                title={t('stocks.alertsTitle')}
                action={
                  <Badge tone={summary?.lowStockCount ? 'warning' : 'success'}>
                    {summary?.lowStockCount ?? 0}
                  </Badge>
                }
              />
              <CardBody>
                {!summary || summary.alerts.length === 0 ? (
                  <p className="console-muted">{t('stocks.alertsEmpty')}</p>
                ) : (
                  <ul className="console-queue">
                    {summary.alerts.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <span>
                            {item.quantity.toLocaleString(locale)} {item.unit} ·{' '}
                            {t('stocks.colThreshold').toLowerCase()} {item.threshold}
                          </span>
                        </div>
                        <Badge tone={item.depleted ? 'danger' : 'warning'} dot>
                          {item.depleted ? t('stocks.statusOut') : t('stocks.statusLow')}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('stocks.suggestionsTitle')} />
              <CardBody>
                {suggestions.length === 0 ? (
                  <p className="console-muted">{t('stocks.alertsEmpty')}</p>
                ) : (
                  <DataTable
                    columns={[
                      {
                        key: 'name',
                        header: t('stocks.colName'),
                        render: (row: ReorderSuggestion) => row.name,
                      },
                      {
                        key: 'qty',
                        header: t('stocks.colSuggestedQty'),
                        align: 'right',
                        render: (row: ReorderSuggestion) => `${row.quantity} ${row.unit}`,
                      },
                      {
                        key: 'cost',
                        header: t('stocks.colEstimatedCost'),
                        align: 'right',
                        render: (row: ReorderSuggestion) => formatXof(row.estimatedCostXof, locale),
                      },
                      {
                        key: 'supplier',
                        header: t('stocks.colSupplier'),
                        render: (row: ReorderSuggestion) => row.supplierName ?? '—',
                      },
                    ]}
                    rows={suggestions}
                    getRowId={(row) => row.itemId}
                    caption={t('stocks.suggestionsTitle')}
                  />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'items' && (
        <Card>
          <CardHeader
            title={t('stocks.itemsTitle')}
            subtitle={t('stocks.itemsHint')}
            action={
              canManage ? (
                <Button size="sm" iconLeft="plus" onClick={() => openItem()}>
                  {t('stocks.addItem')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <div className="console-toolbar">
              <div className="console-search" style={{ minWidth: 240 }}>
                <Input
                  label={t('stocks.search')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  leadingIcon="search"
                />
              </div>
              <Select
                label={t('stocks.allCategories')}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                options={[
                  { value: '', label: t('stocks.allCategories') },
                  ...categories.map((entry) => ({ value: entry, label: entry })),
                ]}
              />
            </div>
            {filteredItems.length === 0 ? (
              <EmptyState
                icon="box"
                title={t('stocks.itemsTitle')}
                description={t('stocks.emptyItems')}
              />
            ) : (
              <DataTable
                columns={itemColumns}
                rows={filteredItems}
                getRowId={(row) => row.id}
                caption={t('stocks.itemsTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'movements' && (
        <Card>
          <CardHeader
            title={t('stocks.movementTitle')}
            subtitle={t('stocks.movementHint')}
            action={
              canManage ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    iconLeft="trash"
                    onClick={() => {
                      setMovementForm({
                        itemId: items[0]?.id ?? '',
                        type: 'in',
                        quantity: '',
                        reason: '',
                        unitCostXof: '',
                      });
                      setMovementModal('waste');
                    }}
                  >
                    {t('stocks.newWaste')}
                  </Button>
                  <Button
                    size="sm"
                    iconLeft="plus"
                    onClick={() => {
                      setMovementForm({
                        itemId: items[0]?.id ?? '',
                        type: 'in',
                        quantity: '',
                        reason: '',
                        unitCostXof: '',
                      });
                      setMovementModal('movement');
                    }}
                  >
                    {t('stocks.newMovement')}
                  </Button>
                </div>
              ) : undefined
            }
          />
          <CardBody>
            <div className="console-toolbar">
              <div className="console-filters">
                {(['all', ...MOVEMENTS] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      movementType === value ? 'console-filter is-active' : 'console-filter'
                    }
                    aria-pressed={movementType === value}
                    onClick={() => setMovementType(value)}
                  >
                    {value === 'all' ? t('stocks.movementTitle') : t(`stocks.type.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            {filteredMovements.length === 0 ? (
              <EmptyState
                icon="clock"
                title={t('stocks.movementTitle')}
                description={t('stocks.emptyMovements')}
              />
            ) : (
              <DataTable
                columns={movementColumns}
                rows={filteredMovements.slice(0, 100)}
                getRowId={(row) => row.id}
                caption={t('stocks.movementTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'recipes' && (
        <Card>
          <CardHeader
            title={t('stocks.recipesTitle')}
            subtitle={t('stocks.recipesHint')}
            action={
              canManage ? (
                <Button size="sm" iconLeft="plus" onClick={() => setRecipeModal(true)}>
                  {t('stocks.addRecipe')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {recipes.length === 0 ? (
              <EmptyState
                icon="chef"
                title={t('stocks.recipesTitle')}
                description={t('stocks.emptyRecipes')}
              />
            ) : (
              <DataTable
                columns={recipeColumns}
                rows={recipes}
                getRowId={(row) => row.id}
                caption={t('stocks.recipesTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'suppliers' && (
        <>
          <Card>
            <CardHeader
              title={t('stocks.suppliersTitle')}
              subtitle={t('stocks.suppliersHint')}
              action={
                canManage ? (
                  <Button size="sm" iconLeft="plus" onClick={() => setSupplierModal(true)}>
                    {t('stocks.addSupplier')}
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              {suppliers.length === 0 ? (
                <EmptyState
                  icon="truck"
                  title={t('stocks.suppliersTitle')}
                  description={t('stocks.emptySuppliers')}
                />
              ) : (
                <DataTable
                  columns={supplierColumns}
                  rows={suppliers}
                  getRowId={(row) => row.id}
                  caption={t('stocks.suppliersTitle')}
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title={t('stocks.purchaseTitle')}
              action={<Badge tone="neutral">{purchaseOrders.length}</Badge>}
            />
            <CardBody>
              {purchaseOrders.length === 0 ? (
                <p className="console-muted">{t('stocks.purchaseEmpty')}</p>
              ) : (
                <DataTable
                  columns={purchaseColumns}
                  rows={purchaseOrders}
                  getRowId={(row) => row.id}
                  caption={t('stocks.purchaseTitle')}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}

      {section === 'counts' && (
        <Card>
          <CardHeader
            title={t('stocks.countsTitle')}
            subtitle={t('stocks.countsHint')}
            action={
              canManage ? (
                <Button
                  size="sm"
                  iconLeft="plus"
                  onClick={() => {
                    setCounted({});
                    setCountDate(todayIso());
                    setCountModal(true);
                  }}
                >
                  {t('stocks.newCount')}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {counts.length === 0 ? (
              <EmptyState
                icon="receipt"
                title={t('stocks.countsTitle')}
                description={t('stocks.emptyCounts')}
              />
            ) : (
              <DataTable
                columns={countColumns}
                rows={counts}
                getRowId={(row) => row.id}
                caption={t('stocks.countsTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {section === 'audit' && (
        <Card>
          <CardHeader
            title={t('stocks.auditTitle')}
            subtitle={t('stocks.auditHint')}
            action={
              <Badge tone={audit?.integrity ? 'success' : 'danger'} dot>
                {audit?.integrity ? t('stocks.auditIntegrityOk') : t('stocks.auditIntegrityBroken')}
              </Badge>
            }
          />
          <CardBody>
            {!audit || audit.entries.length === 0 ? (
              <EmptyState
                icon="shield"
                title={t('stocks.auditTitle')}
                description={t('stocks.auditEmpty')}
              />
            ) : (
              <DataTable
                columns={auditColumns}
                rows={audit.entries}
                getRowId={(row) => row.id}
                caption={t('stocks.auditTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------ Modales ------------------------------ */}
      <Modal
        open={itemModal}
        onClose={() => {
          setItemModal(false);
          setEditing(null);
        }}
        title={
          editing ? t('stocks.editItemTitle', { name: editing.name }) : t('stocks.addItemTitle')
        }
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              onClick={() => {
                setItemModal(false);
                setEditing(null);
              }}
            >
              {t('stocks.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={
                itemForm.name.trim().length < 2 || (!editing && itemForm.sku.trim().length < 2)
              }
              onClick={() => void saveItem()}
            >
              {editing ? t('stocks.save') : t('stocks.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('stocks.formName')}
            required
            value={itemForm.name}
            onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
          />
          <Input
            label={t('stocks.formSku')}
            required
            disabled={Boolean(editing)}
            value={itemForm.sku}
            onChange={(event) =>
              setItemForm({ ...itemForm, sku: event.target.value.toUpperCase() })
            }
          />
          <div className="console-2col">
            <Select
              label={t('stocks.formUnit')}
              value={itemForm.unit}
              onChange={(event) =>
                setItemForm({ ...itemForm, unit: event.target.value as StockUnit })
              }
              options={UNITS.map((unit) => ({ value: unit, label: unit }))}
            />
            <Select
              label={t('stocks.formLocation')}
              value={itemForm.location}
              onChange={(event) =>
                setItemForm({ ...itemForm, location: event.target.value as StockLocation })
              }
              options={LOCATIONS.map((location) => ({ value: location, label: location }))}
            />
          </div>
          <Input
            label={t('stocks.formCategory')}
            required
            value={itemForm.category}
            onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })}
          />
          <div className="console-2col">
            {!editing && (
              <Input
                label={t('stocks.formQuantity')}
                type="number"
                min={0}
                step="0.001"
                value={itemForm.quantity}
                onChange={(event) => setItemForm({ ...itemForm, quantity: event.target.value })}
              />
            )}
            <Input
              label={t('stocks.formThreshold')}
              type="number"
              min={0}
              step="0.001"
              value={itemForm.threshold}
              onChange={(event) => setItemForm({ ...itemForm, threshold: event.target.value })}
            />
          </div>
          <Input
            label={t('stocks.formCost')}
            type="number"
            min={0}
            value={itemForm.costXof}
            onChange={(event) => setItemForm({ ...itemForm, costXof: event.target.value })}
          />
          <Select
            label={t('stocks.formSupplier')}
            value={itemForm.supplierId}
            onChange={(event) => setItemForm({ ...itemForm, supplierId: event.target.value })}
            options={[
              { value: '', label: t('stocks.selectSupplier') },
              ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(movementModal)}
        onClose={() => setMovementModal(null)}
        title={movementModal === 'waste' ? t('stocks.newWaste') : t('stocks.newMovement')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setMovementModal(null)}>
              {t('stocks.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={
                !movementForm.itemId ||
                Number(movementForm.quantity) === 0 ||
                movementForm.reason.trim().length < 2
              }
              onClick={() => void saveMovement()}
            >
              {t('stocks.save')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('stocks.formItem')}
            value={movementForm.itemId}
            onChange={(event) => setMovementForm({ ...movementForm, itemId: event.target.value })}
            options={items.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.quantity} ${item.unit}`,
            }))}
          />
          {movementModal !== 'waste' && (
            <Select
              label={t('stocks.formType')}
              value={movementForm.type}
              onChange={(event) =>
                setMovementForm({
                  ...movementForm,
                  type: event.target.value as 'in' | 'out' | 'adjust',
                })
              }
              options={(['in', 'out', 'adjust'] as const).map((type) => ({
                value: type,
                label: t(`stocks.type.${type}`),
              }))}
            />
          )}
          <Input
            label={t('stocks.formQty')}
            type="number"
            step="0.001"
            value={movementForm.quantity}
            onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })}
            hint={movementForm.type === 'adjust' ? '-100 000 → 100 000' : undefined}
          />
          {movementModal !== 'waste' && movementForm.type === 'in' && (
            <Input
              label={t('stocks.formUnitCost')}
              type="number"
              min={0}
              value={movementForm.unitCostXof}
              onChange={(event) =>
                setMovementForm({ ...movementForm, unitCostXof: event.target.value })
              }
            />
          )}
          <Textarea
            label={t('stocks.formReason')}
            value={movementForm.reason}
            onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={recipeModal}
        onClose={() => setRecipeModal(false)}
        size="lg"
        title={t('stocks.addRecipe')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setRecipeModal(false)}>
              {t('stocks.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={
                !recipeForm.productName ||
                !recipeForm.lines.some((line) => line.itemId && Number(line.quantity) > 0)
              }
              onClick={() => void saveRecipe()}
            >
              {t('stocks.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('stocks.formProduct')}
            value={recipeForm.productId}
            onChange={(event) => {
              const product = products.find((entry) => entry.id === event.target.value);
              setRecipeForm({
                ...recipeForm,
                productId: event.target.value,
                productName: product?.name ?? '',
                productPriceXof: product
                  ? String(product.basePriceXof)
                  : recipeForm.productPriceXof,
              });
            }}
            options={[
              { value: '', label: '—' },
              ...products.map((product) => ({ value: product.id, label: product.name })),
            ]}
          />
          <Input
            label={t('stocks.formProductPrice')}
            type="number"
            min={0}
            value={recipeForm.productPriceXof}
            onChange={(event) =>
              setRecipeForm({ ...recipeForm, productPriceXof: event.target.value })
            }
          />
          <Input
            label={t('stocks.formYield')}
            type="number"
            min={0.1}
            step="0.1"
            value={recipeForm.yieldQty}
            onChange={(event) => setRecipeForm({ ...recipeForm, yieldQty: event.target.value })}
          />
          <div className="console-stack">
            <strong>{t('stocks.ingredientsTitle')}</strong>
            {recipeForm.lines.map((line, index) => (
              <div key={index} className="console-2col">
                <Select
                  label={t('stocks.ingredientItem')}
                  value={line.itemId}
                  onChange={(event) => {
                    const lines = recipeForm.lines.map((entry, i) =>
                      i === index ? { ...entry, itemId: event.target.value } : entry,
                    );
                    setRecipeForm({ ...recipeForm, lines });
                  }}
                  options={items.map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.unit})`,
                  }))}
                />
                <Input
                  label={t('stocks.ingredientQty')}
                  type="number"
                  step="0.001"
                  value={line.quantity}
                  onChange={(event) => {
                    const lines = recipeForm.lines.map((entry, i) =>
                      i === index ? { ...entry, quantity: event.target.value } : entry,
                    );
                    setRecipeForm({ ...recipeForm, lines });
                  }}
                />
              </div>
            ))}
            <p className="console-muted">{t('stocks.noIngredients')}</p>
            <Button
              size="sm"
              variant="outline"
              iconLeft="plus"
              onClick={() =>
                setRecipeForm({
                  ...recipeForm,
                  lines: [...recipeForm.lines, { itemId: '', quantity: '' }],
                })
              }
            >
              {t('stocks.addIngredient')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={supplierModal}
        onClose={() => setSupplierModal(false)}
        title={t('stocks.addSupplier')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setSupplierModal(false)}>
              {t('stocks.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={supplierForm.name.trim().length < 2}
              onClick={() => void saveSupplier()}
            >
              {t('stocks.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('stocks.formName')}
            required
            value={supplierForm.name}
            onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })}
          />
          <Input
            label={t('stocks.formContact')}
            value={supplierForm.contactName}
            onChange={(event) =>
              setSupplierForm({ ...supplierForm, contactName: event.target.value })
            }
          />
          <Input
            label={t('stocks.formPhone')}
            value={supplierForm.phone}
            onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })}
          />
          <Input
            label={t('stocks.formEmail')}
            type="email"
            value={supplierForm.email}
            onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })}
          />
          <Input
            label={t('stocks.formTerms')}
            type="number"
            min={0}
            max={120}
            value={supplierForm.termsDays}
            onChange={(event) =>
              setSupplierForm({ ...supplierForm, termsDays: event.target.value })
            }
          />
          <Textarea
            label={t('stocks.formNotes')}
            value={supplierForm.notes}
            onChange={(event) => setSupplierForm({ ...supplierForm, notes: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={countModal}
        onClose={() => setCountModal(false)}
        size="lg"
        title={t('stocks.newCount')}
        description={t('stocks.countHint')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setCountModal(false)}>
              {t('stocks.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={!Object.values(counted).some((value) => value !== '')}
              onClick={() => void saveCount()}
            >
              {t('stocks.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('stocks.formCountDate')}
            type="date"
            value={countDate}
            onChange={(event) => setCountDate(event.target.value)}
          />
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <DataTable
              columns={[
                { key: 'name', header: t('stocks.colName'), render: (row: StockItem) => row.name },
                {
                  key: 'expected',
                  header: t('stocks.colQty'),
                  align: 'right',
                  render: (row: StockItem) => `${row.quantity} ${row.unit}`,
                },
                {
                  key: 'counted',
                  header: t('stocks.countedLabel'),
                  render: (row: StockItem) => (
                    <Input
                      aria-label={`${t('stocks.countedLabel')} ${row.name}`}
                      type="number"
                      step="0.001"
                      value={counted[row.id] ?? ''}
                      onChange={(event) => setCounted({ ...counted, [row.id]: event.target.value })}
                    />
                  ),
                },
              ]}
              rows={items}
              getRowId={(row) => row.id}
              caption={t('stocks.newCount')}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
