import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Select,
  SkeletonText,
  Textarea,
  formatTime,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Locale,
} from '@resto-hub/design-system';
import {
  catalogApi,
  errorMessage,
  floorApi,
  orderApi,
  type CatalogProduct,
  type CatalogSnapshot,
  type CreateOrderInput,
  type FloorSnapshot,
  type FloorStatus,
  type Order,
  type OrderChannel,
  type OrderListResponse,
  type OrderStatus,
} from '../lib/api';
import {
  clientRequestId,
  enqueueOrder,
  isTransportError,
  queuedOrders,
  removeQueued,
  syncQueue,
  type QueuedOrder,
} from '../lib/offline';

const STATUS_ORDER: OrderStatus[] = ['recue', 'en_preparation', 'prete', 'servie', 'annulee'];
const CHANNELS: OrderChannel[] = ['sur_place', 'a_emporter', 'livraison', 'precommande'];

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  recue: 'info',
  en_preparation: 'warning',
  prete: 'success',
  servie: 'neutral',
  annulee: 'danger',
};

const PAYMENT_TONE: Record<Order['paymentStatus'], BadgeTone> = {
  impayee: 'danger',
  partielle: 'warning',
  payee: 'success',
};

const TABLE_TONE: Record<FloorStatus, BadgeTone> = {
  libre: 'success',
  reservee: 'warning',
  occupee: 'danger',
  addition: 'primary',
  nettoyage: 'neutral',
  hors_service: 'neutral',
};

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  optionChoiceIds: string[];
  optionNames: string[];
  unitPriceXof: number;
  quantity: number;
  station: 'cuisine' | 'bar';
}

function lineKey(productId: string, variantId?: string, choices: string[] = []) {
  return [productId, variantId ?? '', [...choices].sort().join('+')].join('|');
}

function productUnitPrice(
  product: CatalogProduct,
  variantId?: string,
  choices: string[] = [],
): number {
  const variant = product.variants.find((entry) => entry.id === variantId);
  const base = variant ? variant.priceXof : product.effectivePriceXof;
  let extra = 0;
  for (const group of product.options) {
    for (const choice of group.choices) {
      if (choices.includes(choice.id)) extra += choice.priceDeltaXof;
    }
  }
  return base + extra;
}

/* ------------------------------------------------------------------ */
/* Composeur de commande (serveur : deux touches)                      */
/* ------------------------------------------------------------------ */

function OrderComposer({
  tenantId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  onClose: () => void;
  onCreated: (order: Order) => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [floor, setFloor] = useState<FloorSnapshot | null>(null);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channel, setChannel] = useState<OrderChannel>('sur_place');
  const [tableCode, setTableCode] = useState('');
  const [guests, setGuests] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '', note: '' });
  const [scheduledFor, setScheduledFor] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('1000');
  const [config, setConfig] = useState<CatalogProduct | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [floorResult, catalogResult] = await Promise.all([
          floorApi.snapshot(tenantId),
          catalogApi.snapshot(tenantId),
        ]);
        if (!cancelled) {
          setFloor(floorResult);
          setCatalog(catalogResult);
        }
      } catch (cause) {
        if (!cancelled) setLoadError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const products = useMemo(() => {
    if (!catalog) return [];
    const term = query.trim().toLowerCase();
    return catalog.products.filter((product) => {
      if (!product.active) return false;
      if (category !== 'all' && product.categoryId !== category) return false;
      if (!term) return true;
      return product.name.toLowerCase().includes(term);
    });
  }, [catalog, query, category]);

  const total = cart.reduce((sum, line) => sum + line.unitPriceXof * line.quantity, 0);
  const tables = (floor?.tables ?? []).filter((table) => !table.mergedIntoId);
  const zones = floor?.zones ?? [];

  const addProduct = (product: CatalogProduct, variantId?: string, choices: string[] = []) => {
    const key = lineKey(product.id, variantId, choices);
    const variant = product.variants.find((entry) => entry.id === variantId);
    const optionNames: string[] = [];
    for (const group of product.options) {
      for (const choice of group.choices) {
        if (choices.includes(choice.id)) optionNames.push(choice.name);
      }
    }
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          productName: product.name,
          variantId,
          variantName: variant?.name,
          optionChoiceIds: choices,
          optionNames,
          unitPriceXof: productUnitPrice(product, variantId, choices),
          quantity: 1,
          station: product.station,
        },
      ];
    });
  };

  const tapProduct = (product: CatalogProduct) => {
    if (!product.availability.available) return;
    if (product.variants.length > 0 || product.options.length > 0) {
      setConfig(product);
      return;
    }
    addProduct(product);
  };

  const setQuantity = (key: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  };

  const submit = async () => {
    if (cart.length === 0) return;
    if (channel === 'sur_place' && !tableCode) {
      toast.push({ title: t('orders.tableRequired'), tone: 'error' });
      return;
    }
    if (channel === 'livraison' && customer.address.trim().length < 5) {
      toast.push({ title: t('orders.customerAddress'), tone: 'error' });
      return;
    }
    if (channel === 'precommande' && !scheduledFor) {
      toast.push({ title: t('orders.scheduleFor'), tone: 'error' });
      return;
    }
    const items = cart.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      ...(line.optionChoiceIds.length ? { optionChoiceIds: line.optionChoiceIds } : {}),
    }));
    const payload: CreateOrderInput = {
      channel,
      items,
      clientRequestId: clientRequestId(tenantId),
      ...(channel === 'sur_place' ? { tableCode } : {}),
      ...(channel === 'sur_place' && guests.trim() ? { guests: Number(guests) } : {}),
      ...(channel === 'livraison' ? { deliveryFeeXof: Math.max(0, Number(deliveryFee) || 0) } : {}),
      ...(channel === 'precommande' ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
    };
    const hasCustomer =
      customer.name.trim() ||
      customer.phone.trim() ||
      customer.address.trim() ||
      customer.note.trim();
    if (hasCustomer) {
      payload.customer = {
        name: customer.name.trim() || 'Client comptoir',
        ...(customer.phone.trim() ? { phone: customer.phone.trim() } : {}),
        ...(customer.address.trim() ? { address: customer.address.trim() } : {}),
        ...(customer.note.trim() ? { note: customer.note.trim() } : {}),
      };
    }
    setSubmitting(true);
    try {
      const result = await orderApi.create(tenantId, payload);
      toast.push({
        title: t('orders.orderCreated', { number: result.order.number }),
        tone: 'success',
      });
      onCreated(result.order);
      onClose();
    } catch (cause) {
      if (isTransportError(cause)) {
        enqueueOrder(tenantId, payload, errorMessage(cause));
        toast.push({ title: t('orders.offlineQueued'), tone: 'warning' });
        onClose();
      } else {
        toast.push({
          title: t('orders.errorLoad'),
          description: errorMessage(cause),
          tone: 'error',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={t('orders.composerTitle')}
        description={t('orders.composerSubtitle')}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer">
            <span className="ord-composer__total">
              {t('orders.totalLabel')} <strong>{formatXof(total, locale)}</strong>
            </span>
            <div className="ord-composer__footer-actions">
              <Button variant="ghost" onClick={onClose}>
                {t('orders.back')}
              </Button>
              <Button
                iconLeft="check"
                loading={submitting}
                disabled={cart.length === 0}
                onClick={() => void submit()}
              >
                {t('orders.sendOrder')}
              </Button>
            </div>
          </div>
        }
      >
        {loading ? (
          <SkeletonText lines={6} />
        ) : loadError ? (
          <EmptyState icon="alert" title={t('orders.errorLoad')} description={loadError} />
        ) : (
          <div className="ord-composer">
            <div className="ord-channel-row" role="group" aria-label={t('orders.chooseChannel')}>
              {CHANNELS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={entry === channel ? 'ord-chip is-active' : 'ord-chip'}
                  aria-pressed={entry === channel}
                  onClick={() => {
                    setChannel(entry);
                    if (entry !== 'sur_place') setTableCode('');
                  }}
                >
                  {t(`orders.channel.${entry}`)}
                </button>
              ))}
            </div>

            {channel === 'sur_place' && (
              <section className="ord-tables" aria-label={t('orders.chooseTable')}>
                {zones.map((zone) => {
                  const zoneTables = tables.filter((table) => table.zoneId === zone.id);
                  if (zoneTables.length === 0) return null;
                  return (
                    <div key={zone.id} className="ord-tables__zone">
                      <span className="ord-tables__label">{zone.name}</span>
                      <div className="ord-tables__grid">
                        {zoneTables.map((table) => {
                          const free = table.status === 'libre' || table.status === 'reservee';
                          const active = tableCode === table.code;
                          return (
                            <button
                              key={table.id}
                              type="button"
                              disabled={!free}
                              title={free ? table.code : t('orders.occupiedTable')}
                              className={active ? 'ord-table is-active' : 'ord-table'}
                              aria-pressed={active}
                              onClick={() => setTableCode(table.code)}
                            >
                              <strong>{table.number}</strong>
                              <span>{table.capacity}p</span>
                              <Badge tone={TABLE_TONE[table.status]} dot>
                                {t(`floor.statusLabel.${table.status}`)}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <div className="ord-composer__grid">
              <section className="ord-products" aria-label={t('orders.products')}>
                <div className="ord-products__tools">
                  <Input
                    label={t('orders.searchProduct')}
                    leadingIcon="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Select
                    label={t('orders.category')}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    options={[
                      { value: 'all', label: t('orders.all') },
                      ...(catalog?.categories ?? []).map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                      })),
                    ]}
                  />
                </div>
                <div className="ord-products__grid">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={
                        product.availability.available ? 'ord-product' : 'ord-product is-off'
                      }
                      disabled={!product.availability.available}
                      onClick={() => tapProduct(product)}
                    >
                      <span className="ord-product__name">{product.name}</span>
                      <span className="ord-product__meta">
                        <strong>{formatXof(product.effectivePriceXof, locale)}</strong>
                        <Badge tone={product.station === 'bar' ? 'info' : 'accent'}>
                          {t(`kds.station${product.station === 'bar' ? 'Bar' : 'Cuisine'}`)}
                        </Badge>
                      </span>
                      {(product.variants.length > 0 || product.options.length > 0) && (
                        <span className="ord-product__badge">{t('orders.configure')}</span>
                      )}
                    </button>
                  ))}
                  {products.length === 0 && (
                    <p className="console-muted">{t('orders.cartEmpty')}</p>
                  )}
                </div>
              </section>

              <aside className="ord-cart" aria-label={t('orders.cart')}>
                <div className="ord-cart__head">
                  <strong>{t('orders.cart')}</strong>
                  {cart.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setCart([])}>
                      {t('orders.clearCart')}
                    </Button>
                  )}
                </div>
                {cart.length === 0 ? (
                  <p className="console-muted">{t('orders.cartEmpty')}</p>
                ) : (
                  <ul className="ord-cart__lines">
                    {cart.map((line) => (
                      <li key={line.key}>
                        <div>
                          <strong>{line.productName}</strong>
                          {(line.variantName || line.optionNames.length > 0) && (
                            <span>
                              {[line.variantName, ...line.optionNames].filter(Boolean).join(' · ')}
                            </span>
                          )}
                          <em>{formatXof(line.unitPriceXof, locale)}</em>
                        </div>
                        <div className="ord-qty">
                          <button
                            type="button"
                            aria-label="−"
                            onClick={() => setQuantity(line.key, -1)}
                          >
                            −
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            aria-label="+"
                            onClick={() => setQuantity(line.key, 1)}
                          >
                            +
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="ord-cart__fields">
                  {channel === 'sur_place' && (
                    <Input
                      label={t('orders.guests')}
                      type="number"
                      min={1}
                      max={40}
                      value={guests}
                      onChange={(event) => setGuests(event.target.value)}
                    />
                  )}
                  {channel === 'precommande' && (
                    <Input
                      label={t('orders.scheduleFor')}
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(event) => setScheduledFor(event.target.value)}
                    />
                  )}
                  <Input
                    label={t('orders.customerName')}
                    value={customer.name}
                    onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                  />
                  <Input
                    label={t('orders.customerPhone')}
                    type="tel"
                    value={customer.phone}
                    onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                  />
                  {channel === 'livraison' && (
                    <>
                      <Input
                        label={t('orders.customerAddress')}
                        value={customer.address}
                        onChange={(event) =>
                          setCustomer({ ...customer, address: event.target.value })
                        }
                      />
                      <Input
                        label={t('orders.deliveryFee')}
                        type="number"
                        min={0}
                        max={10000}
                        value={deliveryFee}
                        onChange={(event) => setDeliveryFee(event.target.value)}
                      />
                    </>
                  )}
                  <Textarea
                    label={t('orders.customerNote')}
                    rows={2}
                    value={customer.note}
                    onChange={(event) => setCustomer({ ...customer, note: event.target.value })}
                  />
                </div>
              </aside>
            </div>
          </div>
        )}
      </Modal>

      {config && (
        <ProductConfigModal
          product={config}
          onClose={() => setConfig(null)}
          onAdd={(variantId, choices) => {
            addProduct(config, variantId, choices);
            setConfig(null);
          }}
        />
      )}
    </>
  );
}

function ProductConfigModal({
  product,
  onClose,
  onAdd,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onAdd: (variantId: string | undefined, choices: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [choices, setChoices] = useState<string[]>(() =>
    product.options.flatMap((group) =>
      group.required
        ? group.choices.slice(0, Math.max(1, group.minSelect)).map((choice) => choice.id)
        : [],
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (groupId: string, choiceId: string) => {
    const group = product.options.find((entry) => entry.id === groupId);
    if (!group) return;
    setChoices((current) => {
      const inGroup = current.filter((id) => group.choices.some((choice) => choice.id === id));
      if (inGroup.includes(choiceId)) {
        return current.filter((id) => id !== choiceId);
      }
      if (group.maxSelect === 1) {
        return [...current.filter((id) => !inGroup.includes(id)), choiceId];
      }
      if (inGroup.length >= group.maxSelect) return current;
      return [...current, choiceId];
    });
  };

  const confirm = () => {
    for (const group of product.options) {
      const count = group.choices.filter((choice) => choices.includes(choice.id)).length;
      if (group.required && count < Math.max(1, group.minSelect)) {
        setError(`${group.name} — ${t('orders.optionRequired')}`);
        return;
      }
    }
    onAdd(product.variants.length > 0 ? variantId : undefined, choices);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      description={formatXof(productUnitPrice(product, variantId, choices), locale)}
      closeLabel={t('meta.close')}
      footer={
        <div className="ord-composer__footer-actions">
          <Button variant="ghost" onClick={onClose}>
            {t('orders.back')}
          </Button>
          <Button iconLeft="plus" onClick={confirm}>
            {t('orders.add')}
          </Button>
        </div>
      }
    >
      <div className="ord-config">
        {product.variants.length > 0 && (
          <fieldset className="ord-config__group">
            <legend>{t('orders.variant')}</legend>
            {product.variants.map((variant) => (
              <label
                key={variant.id}
                className={
                  variant.id === variantId ? 'ord-config__option is-active' : 'ord-config__option'
                }
              >
                <input
                  type="radio"
                  name={`variant-${product.id}`}
                  checked={variant.id === variantId}
                  onChange={() => setVariantId(variant.id)}
                />
                <span>{variant.name}</span>
                <em>{formatXof(variant.priceXof, locale)}</em>
              </label>
            ))}
          </fieldset>
        )}
        {product.options.map((group) => (
          <fieldset key={group.id} className="ord-config__group">
            <legend>
              {group.name}
              {group.required && (
                <span className="ord-config__required"> {t('publicOrder.required')}</span>
              )}
            </legend>
            {group.choices.map((choice) => (
              <label
                key={choice.id}
                className={
                  choices.includes(choice.id)
                    ? 'ord-config__option is-active'
                    : 'ord-config__option'
                }
              >
                <input
                  type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                  name={`group-${group.id}`}
                  checked={choices.includes(choice.id)}
                  onChange={() => toggle(group.id, choice.id)}
                />
                <span>{choice.name}</span>
                <em>
                  {choice.priceDeltaXof ? `+${formatXof(choice.priceDeltaXof, locale)}` : '—'}
                </em>
              </label>
            ))}
          </fieldset>
        ))}
        {product.options.length === 0 && product.variants.length === 0 && (
          <p className="console-muted">{product.description}</p>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Détail de commande                                                  */
/* ------------------------------------------------------------------ */

function OrderDetail({
  tenantId,
  order,
  locale,
  canUpdate,
  canCancel,
  canDiscount,
  onChanged,
}: {
  tenantId: string;
  order: Order;
  locale: Locale;
  canUpdate: boolean;
  canCancel: boolean;
  canDiscount: boolean;
  onChanged: (order: Order) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [acting, setActing] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('10');
  const [discountReason, setDiscountReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const transition = async (status: OrderStatus) => {
    setActing(status);
    try {
      const result = await orderApi.setStatus(tenantId, order.id, status, order.version);
      onChanged(result.order);
      toast.push({ title: t('orders.statusUpdated'), tone: 'success' });
    } catch (cause) {
      toast.push({ title: t('orders.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const downloadReceipt = async () => {
    setActing('receipt');
    try {
      const blob = await orderApi.receiptBlob(tenantId, order.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      toast.push({ title: t('orders.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const applyDiscount = async () => {
    if (discountReason.trim().length < 3) return;
    setActing('discount');
    try {
      const result = await orderApi.discount(tenantId, order.id, {
        type: discountType,
        value: Number(discountValue) || 0,
        reason: discountReason.trim(),
      });
      onChanged(result.order);
      setDiscountOpen(false);
      setDiscountReason('');
      toast.push({ title: t('orders.discountApplied'), tone: 'success' });
    } catch (cause) {
      toast.push({ title: t('orders.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const cancelOrder = async () => {
    if (cancelReason.trim().length < 4) return;
    setActing('cancel');
    try {
      const result = await orderApi.cancel(tenantId, order.id, cancelReason.trim());
      onChanged(result.order);
      setCancelOpen(false);
      setCancelReason('');
      toast.push({ title: t('orders.statusUpdated'), tone: 'success' });
    } catch (cause) {
      toast.push({ title: t('orders.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const nextAction =
    order.status === 'recue'
      ? {
          status: 'en_preparation' as const,
          label: t('orders.actionPrepare'),
          icon: 'chef' as const,
        }
      : order.status === 'en_preparation'
        ? { status: 'prete' as const, label: t('orders.actionReady'), icon: 'bell' as const }
        : order.status === 'prete'
          ? { status: 'servie' as const, label: t('orders.actionServed'), icon: 'check' as const }
          : null;

  return (
    <Card className="ord-detail">
      <CardHeader
        title={
          <span className="ord-detail__title">
            {order.number}
            <Badge tone={STATUS_TONE[order.status]} dot>
              {t(`orders.status.${order.status}`)}
            </Badge>
            <Badge tone={PAYMENT_TONE[order.paymentStatus]}>
              {t(`orders.paymentStatus.${order.paymentStatus}`)}
            </Badge>
          </span>
        }
        subtitle={[
          t(`orders.channel.${order.channel}`),
          order.tableCode,
          order.customer?.name,
          formatTime(order.createdAt, locale),
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <CardBody>
        <div className="ord-detail__actions">
          {nextAction && canUpdate && (
            <Button
              iconLeft={nextAction.icon}
              loading={acting === nextAction.status}
              onClick={() => void transition(nextAction.status)}
            >
              {nextAction.label}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            iconLeft="download"
            loading={acting === 'receipt'}
            onClick={() => void downloadReceipt()}
          >
            {t('orders.actionReceipt')}
          </Button>
          {canDiscount && order.paymentStatus === 'impayee' && order.status !== 'annulee' && (
            <Button
              variant="outline"
              size="sm"
              iconLeft="gift"
              onClick={() => setDiscountOpen(true)}
            >
              {t('orders.actionDiscount')}
            </Button>
          )}
          {canCancel && ['recue', 'en_preparation', 'prete'].includes(order.status) && (
            <Button variant="ghost" size="sm" iconLeft="x" onClick={() => setCancelOpen(true)}>
              {t('orders.actionCancel')}
            </Button>
          )}
        </div>

        <ul className="ord-lines">
          {order.lines.map((line) => (
            <li key={line.id}>
              <span className="ord-lines__qty">{line.quantity}×</span>
              <div className="ord-lines__body">
                <strong>
                  {line.productName}
                  {line.variantName ? ` — ${line.variantName}` : ''}
                </strong>
                {line.options.length > 0 && (
                  <span>{line.options.map((option) => option.name).join(' · ')}</span>
                )}
              </div>
              <span className="ord-lines__station">
                <Badge tone={line.station === 'bar' ? 'info' : 'accent'}>
                  {t(`orders.station${line.station === 'bar' ? 'Bar' : 'Cuisine'}`)}
                </Badge>
              </span>
              <strong className="ord-lines__total">{formatXof(line.lineTotalXof, locale)}</strong>
            </li>
          ))}
        </ul>

        <dl className="ord-totals">
          <div>
            <dt>{t('orders.subtotal')}</dt>
            <dd>{formatXof(order.subtotalXof, locale)}</dd>
          </div>
          {order.discount && (
            <div>
              <dt>
                {t('orders.discount')} — {order.discount.reason}
              </dt>
              <dd>−{formatXof(order.discount.amountXof, locale)}</dd>
            </div>
          )}
          {order.deliveryFeeXof > 0 && (
            <div>
              <dt>{t('orders.delivery')}</dt>
              <dd>{formatXof(order.deliveryFeeXof, locale)}</dd>
            </div>
          )}
          <div>
            <dt>{t('orders.netHt')}</dt>
            <dd>{formatXof(order.netXof, locale)}</dd>
          </div>
          <div>
            <dt>{t('orders.tax')}</dt>
            <dd>{formatXof(order.taxXof, locale)}</dd>
          </div>
          <div className="is-total">
            <dt>{t('orders.total')}</dt>
            <dd>{formatXof(order.totalXof, locale)}</dd>
          </div>
          {order.paidXof > 0 && (
            <div>
              <dt>{t('orders.paid')}</dt>
              <dd>{formatXof(order.paidXof, locale)}</dd>
            </div>
          )}
          {order.remainingXof > 0 && (
            <div>
              <dt>{t('orders.remaining')}</dt>
              <dd>{formatXof(order.remainingXof, locale)}</dd>
            </div>
          )}
        </dl>

        {(order.invoiceNumber || order.receiptNumber) && (
          <p className="ord-detail__invoice">
            {order.invoiceNumber && (
              <span>
                {t('orders.invoice')} <strong>{order.invoiceNumber}</strong>
              </span>
            )}
            {order.receiptNumber && (
              <span>
                {t('orders.receiptNumber')} <strong>{order.receiptNumber}</strong>
              </span>
            )}
          </p>
        )}

        <div className="ord-tickets">
          {order.tickets.map((ticket) => (
            <div key={ticket.id} className={`ord-ticket ord-ticket--${ticket.status}`}>
              <Badge tone={ticket.station === 'bar' ? 'info' : 'accent'}>
                {t(`orders.station${ticket.station === 'bar' ? 'Bar' : 'Cuisine'}`)}
              </Badge>
              <span>
                {t(
                  `orders.ticket${ticket.status === 'nouvelle' ? 'Nouvelle' : ticket.status === 'prete' ? 'Prete' : 'EnPreparation'}`,
                )}
              </span>
            </div>
          ))}
        </div>

        {order.payments.length > 0 && (
          <ul className="ord-payments">
            {order.payments.map((payment) => (
              <li key={payment.id}>
                <Badge tone="success">
                  {payment.method === 'especes'
                    ? t('pos.methodEspeces')
                    : payment.method === 'mobile_money'
                      ? t('pos.methodMobile')
                      : t('pos.methodCarte')}
                </Badge>
                <strong>{formatXof(payment.amountXof, locale)}</strong>
                <span>{formatTime(payment.at, locale)}</span>
                {payment.reference && <code>{payment.reference}</code>}
              </li>
            ))}
          </ul>
        )}

        {order.cancel && (
          <p className="ord-detail__cancel">
            {t('orders.cancelReason')} : {order.cancel.reason}
          </p>
        )}
      </CardBody>

      <Modal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        title={t('orders.actionDiscount')}
        description={`${order.number} · ${formatXof(order.totalXof, locale)}`}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setDiscountOpen(false)}>
              {t('orders.back')}
            </Button>
            <Button
              loading={acting === 'discount'}
              disabled={discountReason.trim().length < 3}
              onClick={() => void applyDiscount()}
            >
              {t('orders.discountApply')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('orders.discountType')}
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as 'percent' | 'amount')}
            options={[
              { value: 'percent', label: t('orders.discountPercent') },
              { value: 'amount', label: t('orders.discountAmount') },
            ]}
          />
          <Input
            label={t('orders.discountValue')}
            type="number"
            min={1}
            max={discountType === 'percent' ? 100 : order.subtotalXof}
            value={discountValue}
            onChange={(event) => setDiscountValue(event.target.value)}
          />
          <Input
            label={t('orders.discountReason')}
            value={discountReason}
            onChange={(event) => setDiscountReason(event.target.value)}
            placeholder={t('orders.cancelReasonPlaceholder')}
          />
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('orders.cancelTitle', { number: order.number })}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {t('orders.back')}
            </Button>
            <Button
              variant="danger"
              loading={acting === 'cancel'}
              disabled={cancelReason.trim().length < 4}
              onClick={() => void cancelOrder()}
            >
              {t('orders.cancelConfirm')}
            </Button>
          </div>
        }
      >
        <Textarea
          label={t('orders.cancelReason')}
          rows={3}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder={t('orders.cancelReasonPlaceholder')}
          hint={t('pos.cashierHint')}
        />
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet principal                                                    */
/* ------------------------------------------------------------------ */

export function OrdersTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canCreate = permissions.includes('order:create');
  const canUpdate = permissions.includes('order:update');
  const canCancel = permissions.includes('order:cancel');
  const canDiscount = permissions.includes('order:discount');
  const canExport = permissions.includes('report:export');

  const [list, setList] = useState<OrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [channel, setChannel] = useState<'all' | OrderChannel>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedOrder[]>(() => queuedOrders(tenantId));
  const [exporting, setExporting] = useState(false);
  const loadRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const result = await orderApi.list(tenantId, {
          status: status === 'all' ? undefined : status,
          channel: channel === 'all' ? undefined : channel,
          limit: 80,
        });
        setList(result);
        setError(null);
        setSelectedId((current) =>
          current && result.items.some((order) => order.id === current)
            ? current
            : (result.items[0]?.id ?? null),
        );
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [tenantId, status, channel],
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadRef.current(true), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshQueue = () => setQueue(queuedOrders(tenantId));
    refreshQueue();
    window.addEventListener('restohub:queue-changed', refreshQueue);
    window.addEventListener('online', refreshQueue);
    return () => {
      window.removeEventListener('restohub:queue-changed', refreshQueue);
      window.removeEventListener('online', refreshQueue);
    };
  }, [tenantId]);

  const runSync = useCallback(async () => {
    if (!canCreate) return;
    const outcome = await syncQueue(tenantId);
    setQueue(queuedOrders(tenantId));
    if (outcome.synced.length > 0) {
      toast.push({ title: t('orders.offlineSent'), tone: 'success' });
      void loadRef.current(true);
    }
    for (const conflict of outcome.conflicts) {
      toast.push({
        title: t('orders.offlineConflict', { message: conflict.lastError ?? '' }),
        description: conflict.payload.items
          .map((item) => `${item.quantity}× ${item.productId}`)
          .join(', '),
        tone: 'warning',
      });
    }
  }, [canCreate, tenantId, t, toast]);

  const syncRef = useRef(runSync);
  useEffect(() => {
    syncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    if (!canCreate) return;
    void syncRef.current();
    const timer = window.setInterval(() => void syncRef.current(), 15_000);
    const onOnline = () => void syncRef.current();
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [canCreate]);

  const items = useMemo(() => {
    const source = list?.items ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return source;
    return source.filter(
      (order) =>
        order.number.toLowerCase().includes(term) ||
        (order.tableCode ?? '').toLowerCase().includes(term) ||
        (order.customer?.name ?? '').toLowerCase().includes(term),
    );
  }, [list, search]);

  const selected =
    items.find((order) => order.id === selectedId) ??
    list?.items.find((order) => order.id === selectedId) ??
    null;
  const summary = list?.summary;

  const replaceOrder = (updated: Order) => {
    setList((current) =>
      current
        ? {
            ...current,
            items: current.items.map((order) => (order.id === updated.id ? updated : order)),
          }
        : current,
    );
    void loadRef.current(true);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await orderApi.exportCsvBlob(tenantId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `commandes-${tenantId}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      toast.push({ title: t('orders.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="ord-topbar">
        <div className="ord-topbar__stats">
          <div className="ord-stat">
            <span>{t('orders.statsTotal')}</span>
            <strong>{summary?.total ?? 0}</strong>
          </div>
          <div className="ord-stat">
            <span>{t('orders.statsOpen')}</span>
            <strong>
              {summary
                ? summary.byStatus.recue + summary.byStatus.en_preparation + summary.byStatus.prete
                : 0}
            </strong>
          </div>
          <div className="ord-stat">
            <span>{t('orders.statsUnpaid')}</span>
            <strong>{formatXof(summary?.unpaidXof ?? 0, locale)}</strong>
          </div>
          <div className="ord-stat">
            <span>{t('orders.statsPaid')}</span>
            <strong>{formatXof(summary?.paidTodayXof ?? 0, locale)}</strong>
          </div>
        </div>
        <div className="ord-topbar__actions">
          <Button
            variant="ghost"
            iconOnly
            iconLeft="refresh"
            aria-label={t('orders.refresh')}
            onClick={() => void load()}
          />
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              iconLeft="download"
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              {t('orders.actionExport')}
            </Button>
          )}
          {canCreate && (
            <Button iconLeft="plus" onClick={() => setComposerOpen(true)}>
              {t('orders.newOrder')}
            </Button>
          )}
        </div>
      </div>

      {queue.length > 0 && (
        <Card className="ord-offline">
          <CardBody>
            <div className="ord-offline__row">
              <Badge tone="warning" dot>
                {t('orders.offlinePending', { count: queue.length })}
              </Badge>
              <div className="ord-offline__actions">
                <Button
                  size="sm"
                  variant="outline"
                  iconLeft="refresh"
                  onClick={() => void runSync()}
                >
                  {t('orders.offlineSync')}
                </Button>
                {queue.some((entry) => entry.conflicted) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      queue
                        .filter((entry) => entry.conflicted)
                        .forEach((entry) => removeQueued(entry.id));
                      setQueue(queuedOrders(tenantId));
                    }}
                  >
                    {t('orders.offlineDiscard')}
                  </Button>
                )}
              </div>
            </div>
            <ul className="ord-offline__list">
              {queue.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.payload.channel}</code>
                  <span>
                    {entry.payload.items
                      .map((item) => `${item.quantity}× ${item.productId}`)
                      .join(', ')}
                  </span>
                  {entry.lastError && <em>{entry.lastError}</em>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {error && (
        <Card className="console-alert">
          <CardBody>
            <p className="auth-error" role="alert">
              {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('workspace.retry')}
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="ord-filters">
        <div className="ord-filters__chips" role="group" aria-label={t('orders.filterStatus')}>
          <button
            type="button"
            className={status === 'all' ? 'ord-chip is-active' : 'ord-chip'}
            onClick={() => setStatus('all')}
          >
            {t('orders.all')}
          </button>
          {STATUS_ORDER.map((entry) => (
            <button
              key={entry}
              type="button"
              className={status === entry ? 'ord-chip is-active' : 'ord-chip'}
              onClick={() => setStatus(entry)}
            >
              {t(`orders.status.${entry}`)}
            </button>
          ))}
        </div>
        <div className="ord-filters__tools">
          <Select
            label={t('orders.filterChannel')}
            value={channel}
            onChange={(event) => setChannel(event.target.value as 'all' | OrderChannel)}
            options={[
              { value: 'all', label: t('orders.all') },
              ...CHANNELS.map((entry) => ({ value: entry, label: t(`orders.channel.${entry}`) })),
            ]}
          />
          <Input
            label={t('orders.search')}
            leadingIcon="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="ord-layout">
        <Card className="ord-list">
          <CardHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
          <CardBody>
            {loading ? (
              <SkeletonText lines={8} />
            ) : items.length === 0 ? (
              <EmptyState
                icon="receipt"
                title={t('orders.emptyTitle')}
                description={t('orders.emptyBody')}
                action={
                  canCreate ? (
                    <Button size="sm" iconLeft="plus" onClick={() => setComposerOpen(true)}>
                      {t('orders.newOrder')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="ord-rows">
                {items.map((order) => (
                  <li key={order.id}>
                    <button
                      type="button"
                      className={order.id === selectedId ? 'ord-row is-active' : 'ord-row'}
                      onClick={() => setSelectedId(order.id)}
                      aria-pressed={order.id === selectedId}
                    >
                      <span className="ord-row__main">
                        <strong>{order.number}</strong>
                        <span>
                          {t(`orders.channel.${order.channel}`)}
                          {order.tableCode ? ` · ${order.tableCode}` : ''}
                          {order.customer?.name ? ` · ${order.customer.name}` : ''}
                        </span>
                      </span>
                      <span className="ord-row__status">
                        <Badge tone={STATUS_TONE[order.status]} dot>
                          {t(`orders.status.${order.status}`)}
                        </Badge>
                        <Badge tone={PAYMENT_TONE[order.paymentStatus]}>
                          {t(`orders.paymentStatus.${order.paymentStatus}`)}
                        </Badge>
                      </span>
                      <span className="ord-row__amount">
                        <strong>{formatXof(order.totalXof, locale)}</strong>
                        <span>{formatTime(order.createdAt, locale)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="ord-detail-wrap">
          {loading ? (
            <Card>
              <CardBody>
                <SkeletonText lines={6} />
              </CardBody>
            </Card>
          ) : selected ? (
            <OrderDetail
              key={selected.id}
              tenantId={tenantId}
              order={selected}
              locale={locale}
              canUpdate={canUpdate}
              canCancel={canCancel}
              canDiscount={canDiscount}
              onChanged={replaceOrder}
            />
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon="receipt"
                  title={t('orders.detailTitle')}
                  description={t('orders.detailEmpty')}
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {composerOpen && (
        <OrderComposer
          tenantId={tenantId}
          onClose={() => setComposerOpen(false)}
          onCreated={(order) => {
            setSelectedId(order.id);
            void loadRef.current(true);
          }}
        />
      )}
    </>
  );
}
