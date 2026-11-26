import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  SkeletonText,
  Textarea,
  formatTime,
  formatXof,
  useI18n,
  useToast,
} from '@resto-hub/design-system';
import { navigate } from '../lib/router';
import {
  errorMessage,
  orderApi,
  type OrderStatus,
  type PublicMenuProduct,
  type PublicOrder,
} from '../lib/api';

interface MenuData {
  categories: Array<{ id: string; name: string }>;
  products: PublicMenuProduct[];
}

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  choices: string[];
  optionNames: string[];
  unitPriceXof: number;
  quantity: number;
}

function lineKey(productId: string, variantId?: string, choices: string[] = []) {
  return [productId, variantId ?? '', [...choices].sort().join('+')].join('|');
}

function unitPrice(product: PublicMenuProduct, variantId?: string, choices: string[] = []): number {
  const variant = product.variants.find((entry) => entry.id === variantId);
  const base = variant ? variant.priceXof : product.priceXof;
  let extra = 0;
  for (const group of product.options) {
    for (const choice of group.choices) {
      if (choices.includes(choice.id)) extra += choice.priceDeltaXof;
    }
  }
  return base + extra;
}

const TABLE_TOKEN_KEY = (tenantId: string, code: string) => `restohub.tableToken.${tenantId}.${code}`;

export function PublicTablePage({
  tenantId,
  tableCode,
  tableToken,
}: {
  tenantId: string;
  tableCode: string;
  tableToken: string;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [tableBusy, setTableBusy] = useState(false);
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<'menu' | 'cart' | 'info'>('menu');
  const [config, setConfig] = useState<PublicMenuProduct | null>(null);
  const [customer, setCustomer] = useState({ name: '', phone: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [table, menuResult] = await Promise.all([
          orderApi.publicTable(tenantId, tableCode),
          orderApi.publicMenu(tenantId),
        ]);
        if (cancelled) return;
        setTableBusy(Boolean(table.table.orderId));
        setMenu({
          categories: menuResult.categories.map((entry) => ({ id: entry.id, name: entry.name })),
          products: menuResult.categories.flatMap((entry) => entry.products ?? []),
        });
        try {
          window.localStorage.setItem(TABLE_TOKEN_KEY(tenantId, tableCode), tableToken);
        } catch {
          /* stockage indisponible */
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, tableCode, tableToken]);

  const total = cart.reduce((sum, line) => sum + line.unitPriceXof * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const products = useMemo(() => {
    const all = menu?.products.filter((product) => product.available) ?? [];
    return category === 'all' ? all : all.filter((product) => product.categoryId === category);
  }, [menu, category]);

  const addProduct = (product: PublicMenuProduct, variantId?: string, choices: string[] = []) => {
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
        return current.map((line) => (line.key === key ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          productName: product.name,
          variantId,
          variantName: variant?.name,
          choices,
          optionNames,
          unitPriceXof: unitPrice(product, variantId, choices),
          quantity: 1,
        },
      ];
    });
    toast.push({ title: `${product.name} · ${t('publicOrder.addToCart')}`, tone: 'success' });
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
    if (customer.name.trim().length < 2 || customer.phone.trim().length < 8) {
      toast.push({ title: `${t('publicOrder.name')} · ${t('publicOrder.phone')}`, tone: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        channel: 'sur_place' as const,
        tableCode,
        tableToken,
        customer: {
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          ...(customer.note.trim() ? { note: customer.note.trim() } : {}),
        },
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          ...(line.choices.length ? { optionChoiceIds: line.choices } : {}),
        })),
        clientRequestId: `pub-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      const result = await orderApi.publicCreate(tenantId, payload);
      const trackingKey = new URL(result.trackingUrl).searchParams.get('k') ?? '';
      navigate(`/suivi/${tenantId}/${result.order.id}?k=${encodeURIComponent(trackingKey)}`);
    } catch (cause) {
      toast.push({ title: t('publicOrder.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pub-page">
        <Card><CardBody><SkeletonText lines={8} /><p className="console-muted">{t('publicOrder.loading')}</p></CardBody></Card>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="pub-page">
        <Card>
          <CardBody>
            <EmptyState icon="alert" title={t('publicOrder.error')} description={error ?? ''} action={<Button onClick={() => window.location.reload()}>{t('publicOrder.retry')}</Button>} />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__brand">
          <span className="pub-head__mark">RH</span>
          <div>
            <strong>RESTO-HUB</strong>
            <span>{t('publicOrder.table')} {tableCode}</span>
          </div>
        </div>
        <Badge tone={tableBusy ? 'warning' : 'success'} dot>
          {tableBusy ? t('orders.occupiedTable') : t('floor.statusLabel.libre')}
        </Badge>
      </header>

      {tableBusy && (
        <Card className="pub-notice">
          <CardBody>
            <p className="reg-note">{t('publicOrder.paymentAtTable')}</p>
          </CardBody>
        </Card>
      )}

      {step === 'menu' && (
        <>
          <div className="pub-hero">
            <h1>{t('publicOrder.menuTitle')}</h1>
            <p>{t('publicOrder.secureNote')}</p>
          </div>
          <div className="pub-cats" role="group" aria-label={t('publicOrder.menuTitle')}>
            <button type="button" className={category === 'all' ? 'pub-chip is-active' : 'pub-chip'} onClick={() => setCategory('all')}>
              {t('publicOrder.allCategories')}
            </button>
            {menu.categories.map((entry) => (
              <button key={entry.id} type="button" className={category === entry.id ? 'pub-chip is-active' : 'pub-chip'} onClick={() => setCategory(entry.id)}>
                {entry.name}
              </button>
            ))}
          </div>
          <div className="pub-products">
            {products.map((product) => (
              <article key={product.id} className="pub-product">
                <div className="pub-product__media" aria-hidden="true">
                  {product.photos[0] ? <img src={product.photos[0]} alt="" /> : <span>{product.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div className="pub-product__body">
                  <strong>{product.name}</strong>
                  {product.description && <span>{product.description}</span>}
                  <em>{formatXof(product.priceXof, locale)}</em>
                </div>
                <Button
                  size="sm"
                  iconLeft="plus"
                  disabled={tableBusy}
                  onClick={() => {
                    if (product.variants.length > 0 || product.options.length > 0) setConfig(product);
                    else addProduct(product);
                  }}
                >
                  {product.variants.length > 0 || product.options.length > 0 ? t('publicOrder.configure') : t('publicOrder.addToCart')}
                </Button>
              </article>
            ))}
          </div>
          <div className="pub-cartbar">
            <span>{count} × {t('publicOrder.cartTitle')} · <strong>{formatXof(total, locale)}</strong></span>
            <Button disabled={cart.length === 0 || tableBusy} onClick={() => setStep('cart')}>
              {t('publicOrder.seeCart')}
            </Button>
          </div>
        </>
      )}

      {step === 'cart' && (
        <Card>
          <CardHeader title={t('publicOrder.cartTitle')} action={<Button size="sm" variant="ghost" onClick={() => setStep('menu')}>{t('publicOrder.back')}</Button>} />
          <CardBody>
            {cart.length === 0 ? (
              <EmptyState icon="utensils" title={t('publicOrder.cartEmpty')} action={<Button size="sm" onClick={() => setStep('menu')}>{t('publicOrder.menuTitle')}</Button>} />
            ) : (
              <>
                <ul className="ord-cart__lines">
                  {cart.map((line) => (
                    <li key={line.key}>
                      <div>
                        <strong>{line.productName}</strong>
                        {(line.variantName || line.optionNames.length > 0) && (
                          <span>{[line.variantName, ...line.optionNames].filter(Boolean).join(' · ')}</span>
                        )}
                        <em>{formatXof(line.unitPriceXof, locale)}</em>
                      </div>
                      <div className="ord-qty">
                        <button type="button" aria-label="−" onClick={() => setQuantity(line.key, -1)}>−</button>
                        <span>{line.quantity}</span>
                        <button type="button" aria-label="+" onClick={() => setQuantity(line.key, 1)}>+</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="pub-total">
                  <span>{t('publicOrder.total')}</span>
                  <strong>{formatXof(total, locale)}</strong>
                </div>
                <Button size="lg" iconLeft="arrow-right" onClick={() => setStep('info')}>
                  {t('publicOrder.checkout')}
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {step === 'info' && (
        <Card>
          <CardHeader
            title={t('publicOrder.checkoutTitle')}
            subtitle={`${count} ${t('publicOrder.cartTitle').toLowerCase()} · ${formatXof(total, locale)}`}
            action={<Button size="sm" variant="ghost" onClick={() => setStep('cart')}>{t('publicOrder.back')}</Button>}
          />
          <CardBody>
            <div className="pub-form">
              <Input
                label={t('publicOrder.name')}
                value={customer.name}
                autoComplete="name"
                onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
              />
              <Input
                label={t('publicOrder.phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={customer.phone}
                onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
              />
              <Textarea
                label={t('publicOrder.note')}
                rows={2}
                value={customer.note}
                onChange={(event) => setCustomer({ ...customer, note: event.target.value })}
              />
            </div>
            <p className="reg-note">{t('publicOrder.paymentAtTable')}</p>
            <Button size="lg" iconLeft="check" loading={submitting} onClick={() => void submit()}>
              {t('publicOrder.send')}
            </Button>
          </CardBody>
        </Card>
      )}

      {config && (
        <PublicConfigModal
          product={config}
          onClose={() => setConfig(null)}
          onAdd={(variantId, choices) => {
            addProduct(config, variantId, choices);
            setConfig(null);
          }}
        />
      )}
    </div>
  );
}

function PublicConfigModal({
  product,
  onClose,
  onAdd,
}: {
  product: PublicMenuProduct;
  onClose: () => void;
  onAdd: (variantId: string | undefined, choices: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [choices, setChoices] = useState<string[]>(() =>
    product.options.flatMap((group) => (group.required ? group.choices.slice(0, Math.max(1, group.minSelect)).map((choice) => choice.id) : [])),
  );
  const [error, setError] = useState<string | null>(null);

  const toggle = (groupId: string, choiceId: string) => {
    const group = product.options.find((entry) => entry.id === groupId);
    if (!group) return;
    setChoices((current) => {
      const inGroup = current.filter((id) => group.choices.some((choice) => choice.id === id));
      if (inGroup.includes(choiceId)) return current.filter((id) => id !== choiceId);
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), choiceId];
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
      description={formatXof(unitPrice(product, variantId, choices), locale)}
      closeLabel={t('meta.close')}
      footer={
        <div className="ord-composer__footer-actions">
          <Button variant="ghost" onClick={onClose}>{t('publicOrder.back')}</Button>
          <Button iconLeft="plus" onClick={confirm}>{t('publicOrder.addToCart')}</Button>
        </div>
      }
    >
      <div className="ord-config">
        {product.variants.length > 0 && (
          <fieldset className="ord-config__group">
            <legend>{t('publicOrder.variant')}</legend>
            {product.variants.map((variant) => (
              <label key={variant.id} className={variant.id === variantId ? 'ord-config__option is-active' : 'ord-config__option'}>
                <input type="radio" name={`variant-${product.id}`} checked={variant.id === variantId} onChange={() => setVariantId(variant.id)} />
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
              {group.required && <span className="ord-config__required"> {t('publicOrder.required')}</span>}
            </legend>
            {group.choices.map((choice) => (
              <label key={choice.id} className={choices.includes(choice.id) ? 'ord-config__option is-active' : 'ord-config__option'}>
                <input
                  type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                  name={`group-${group.id}`}
                  checked={choices.includes(choice.id)}
                  onChange={() => toggle(group.id, choice.id)}
                />
                <span>{choice.name}</span>
                <em>{choice.priceDeltaXof ? `+${formatXof(choice.priceDeltaXof, locale)}` : '—'}</em>
              </label>
            ))}
          </fieldset>
        ))}
        {error && <p className="auth-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

const TIMELINE: OrderStatus[] = ['recue', 'en_preparation', 'prete', 'servie'];

export function PublicTrackingPage({
  tenantId,
  orderId,
  trackingKey,
}: {
  tenantId: string;
  orderId: string;
  trackingKey: string;
}) {
  const { t, locale } = useI18n();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await orderApi.publicTracking(tenantId, orderId, trackingKey);
        if (!cancelled) {
          setOrder(result.order);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void tick();
    const timer = window.setInterval(tick, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId, orderId, trackingKey]);

  if (loading) {
    return (
      <div className="pub-page">
        <Card><CardBody><SkeletonText lines={6} /></CardBody></Card>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="pub-page">
        <Card>
          <CardBody>
            <EmptyState icon="alert" title={t('publicOrder.invalidLink')} description={error ?? ''} action={<Button onClick={() => window.location.reload()}>{t('publicOrder.retry')}</Button>} />
          </CardBody>
        </Card>
      </div>
    );
  }

  const reached = new Set(order.timeline.map((entry) => entry.status));
  const token = order.tableCode
    ? (() => {
        try {
          return window.localStorage.getItem(TABLE_TOKEN_KEY(tenantId, order.tableCode));
        } catch {
          return null;
        }
      })()
    : null;
  const statusKey =
    order.status === 'recue'
      ? 'statusRecue'
      : order.status === 'en_preparation'
        ? 'statusEnPreparation'
        : order.status === 'prete'
          ? 'statusPrete'
          : order.status === 'servie'
            ? 'statusServie'
            : 'statusAnnulee';

  return (
    <div className="pub-page pub-tracking">
      <header className="pub-head">
        <div className="pub-head__brand">
          <span className="pub-head__mark">RH</span>
          <div>
            <strong>{t('publicOrder.trackingTitle')}</strong>
            <span>{t('publicOrder.orderNumber')} {order.number}{order.tableCode ? ` · ${order.tableCode}` : ''}</span>
          </div>
        </div>
        <Badge tone={order.status === 'annulee' ? 'danger' : order.status === 'servie' ? 'neutral' : 'success'} live>
          {t(`publicOrder.${statusKey}`)}
        </Badge>
      </header>

      <Card>
        <CardBody>
          <p className="pub-tracking__sub">{t('publicOrder.trackingSub')}</p>
          <ol className="pub-steps">
            {TIMELINE.map((status) => {
              const done = reached.has(status);
              const entry = order.timeline.find((item) => item.status === status);
              const label =
                status === 'recue' ? t('publicOrder.statusRecue')
                  : status === 'en_preparation' ? t('publicOrder.statusEnPreparation')
                    : status === 'prete' ? t('publicOrder.statusPrete')
                      : t('publicOrder.statusServie');
              return (
                <li key={status} className={done ? 'is-done' : undefined}>
                  <span className="pub-steps__dot" aria-hidden="true" />
                  <div>
                    <strong>{label}</strong>
                    <span>{entry ? formatTime(entry.at, locale) : '—'}</span>
                  </div>
                </li>
              );
            })}
            {order.status === 'annulee' && (
              <li className="is-canceled">
                <span className="pub-steps__dot" aria-hidden="true" />
                <div><strong>{t('publicOrder.statusAnnulee')}</strong></div>
              </li>
            )}
          </ol>

          <ul className="ord-lines">
            {order.lines.map((line, index) => (
              <li key={`${line.name}-${index}`}>
                <span className="ord-lines__qty">{line.quantity}×</span>
                <div className="ord-lines__body">
                  <strong>{line.name}{line.variantName ? ` — ${line.variantName}` : ''}</strong>
                </div>
                <strong className="ord-lines__total">{formatXof(line.lineTotalXof, locale)}</strong>
              </li>
            ))}
          </ul>

          <div className="pub-total">
            <span>{t('publicOrder.total')}</span>
            <strong>{formatXof(order.totalXof, locale)}</strong>
          </div>
          <p className="reg-note">{t('publicOrder.paymentAtTable')}</p>
          <p className="reg-note">{t('publicOrder.secureNote')}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('publicOrder.ticketsTitle')} />
        <CardBody>
          <div className="pub-tickets">
            {order.tickets.map((ticket) => (
              <div key={ticket.station} className={`ord-ticket ord-ticket--${ticket.status}`}>
                <Badge tone={ticket.station === 'bar' ? 'info' : 'accent'}>
                  {ticket.station === 'bar' ? t('publicOrder.stationBar') : t('publicOrder.stationCuisine')}
                </Badge>
                <span>{ticket.status === 'nouvelle' ? t('orders.ticketNouvelle') : ticket.status === 'prete' ? t('orders.ticketPrete') : t('orders.ticketEnPreparation')}</span>
              </div>
            ))}
          </div>
          {token && order.tableCode && (
            <Button variant="outline" iconLeft="utensils" onClick={() => navigate(`/t/${tenantId}/${encodeURIComponent(order.tableCode!)}?k=${encodeURIComponent(token)}`)}>
              {t('publicOrder.orderAgain')}
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
