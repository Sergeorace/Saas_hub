import { useEffect, useState } from 'react';
import { Icon, Skeleton, cx, formatXof, useI18n, useToast } from '@resto-hub/design-system';
import { ApiError, publicApi } from '../lib/api';
import { useEstablishment } from '../lib/hooks';
import { useTenantTheme } from '../lib/tenantTheme';
import { navigate } from '../lib/router';
import { cartSubtotal, clearCart, useCart } from '../lib/cart';
import { recordPublicOrder } from '../lib/localStore';
import { ClientHeader } from '../components/ClientChrome';
import { loadCustomerDraft } from './CartPage';

const DELIVERY_FEE = 1000;

export default function CheckoutPage({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { data, loading } = useEstablishment(slug);
  const establishment = data?.establishment;
  useTenantTheme(establishment ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor } : null);

  const cart = useCart(establishment?.id);
  const [method, setMethod] = useState<'server' | 'cashier' | 'mobile'>('server');
  const [placing, setPlacing] = useState(false);
  const draft = loadCustomerDraft();

  const hasTable = Boolean(cart.tableCode && cart.tableToken);
  const channel = hasTable && cart.channel === 'sur_place' ? 'sur_place' : cart.channel === 'sur_place' ? 'a_emporter' : cart.channel;
  const subtotal = cartSubtotal(cart);
  const deliveryFee = channel === 'livraison' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;

  useEffect(() => {
    if (!hasTable && method === 'server') setMethod('cashier');
    if (hasTable && method === 'cashier' && cart.channel === 'sur_place') setMethod('server');
  }, [hasTable, method, cart.channel]);

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.loading')} back={`/e/${slug}/panier`} />
        <main className="rh-client-page">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} height={96} />
          ))}
        </main>
      </div>
    );
  }

  if (!establishment) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.error')} back="/recherche" />
        <main className="rh-client-page">
          <p className="rh-client-muted">{t('common.error')}</p>
        </main>
      </div>
    );
  }

  const placeOrder = async () => {
    if (cart.items.length === 0) {
      navigate(`/e/${establishment.slug}/menu`);
      return;
    }
    if (!draft.name.trim() || !draft.phone.trim()) {
      toast.push({ title: t('checkout.customerRequired'), tone: 'warning' });
      navigate(`/e/${establishment.slug}/panier`);
      return;
    }
    if (channel === 'sur_place' && !cart.tableToken) {
      toast.push({ title: t('checkout.tableRequired'), tone: 'warning' });
      navigate(`/scan?tenant=${establishment.slug}`);
      return;
    }
    if (method === 'mobile') {
      toast.push({ title: t('checkout.mobileMoneySoon'), tone: 'info' });
      return;
    }
    setPlacing(true);
    try {
      const result = await publicApi.createOrder(establishment.id, {
        channel,
        items: cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          ...(item.optionChoiceIds.length > 0 ? { optionChoiceIds: item.optionChoiceIds } : {}),
          ...(item.notes ? { notes: item.notes } : {}),
        })),
        ...(channel === 'sur_place' ? { tableCode: cart.tableCode, tableToken: cart.tableToken } : {}),
        customer: {
          name: draft.name.trim(),
          phone: draft.phone.trim(),
          ...(channel === 'livraison' ? { address: draft.address.trim() } : {}),
          ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        },
        ...(channel === 'livraison' ? { deliveryFeeXof: deliveryFee } : {}),
        clientRequestId: `cli_${crypto.randomUUID()}`,
      });
      const tokenMatch = /[?&]k=([^&]+)/.exec(result.trackingUrl);
      const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
      recordPublicOrder({
        tenantId: establishment.id,
        tenantName: establishment.brandName,
        tenantSlug: establishment.slug,
        trackingToken: token,
        order: result.order,
      });
      clearCart(cart);
      toast.push({ title: t('checkout.orderSent'), description: t('checkout.sentHint'), tone: 'success' });
      navigate(`/suivi/${establishment.id}/${result.order.id}?k=${encodeURIComponent(token)}`, { replace: true });
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.code === 'table_token_required'
          ? t('checkout.tableRequired')
          : caught instanceof Error
            ? caught.message
            : t('common.error');
      toast.push({ title: t('common.error'), description: message, tone: 'error' });
    } finally {
      setPlacing(false);
    }
  };

  if (cart.items.length === 0) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('checkout.title')} back={`/e/${establishment.slug}/menu`} logo={establishment.logoUrl} />
        <main className="rh-client-page">
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="wallet" />
            </span>
            <h2>{t('cart.empty')}</h2>
            <p>{t('cart.emptyDesc')}</p>
            <button type="button" className="rh-client-btn rh-client-btn--primary" onClick={() => navigate(`/e/${establishment.slug}/menu`)}>
              {t('cart.browseMenu')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const paymentOptions = [
    {
      id: 'server' as const,
      icon: 'utensils' as const,
      title: t('checkout.payAtServer'),
      description: t('checkout.payAtServerDesc'),
      disabled: !hasTable,
      badge: hasTable ? null : t('checkout.serverOnly'),
    },
    {
      id: 'cashier' as const,
      icon: 'banknote' as const,
      title: t('checkout.payAtCashier'),
      description: t('checkout.payAtCashierDesc'),
      disabled: false,
      badge: null,
    },
    {
      id: 'mobile' as const,
      icon: 'smartphone' as const,
      title: t('checkout.mobileMoney'),
      description: t('checkout.mobileMoneyDesc'),
      disabled: true,
      badge: t('checkout.mobileMoneySoon'),
    },
  ];

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('checkout.title')} subtitle={establishment.brandName} back={`/e/${establishment.slug}/panier`} logo={establishment.logoUrl} />
      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-checkout-steps" aria-label={t('checkout.title')}>
          <span className="is-done">
            <Icon name="check" size="sm" /> {t('cart.title')}
          </span>
          <span className="is-current">2 · {t('checkout.payment')}</span>
          <span>3 · {t('tracking.title')}</span>
        </section>

        <section className="rh-checkout-pay">
          <h2>{t('checkout.payment')}</h2>
          {paymentOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cx('rh-pay-option', method === option.id && 'is-active', option.disabled && 'is-disabled')}
              role="radio"
              aria-checked={method === option.id}
              disabled={option.disabled}
              onClick={() => setMethod(option.id)}
            >
              <span className="rh-pay-option__icon">
                <Icon name={option.icon} />
              </span>
              <span className="rh-pay-option__body">
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </span>
              {option.badge && <span className="rh-client-pill rh-client-pill--info">{option.badge}</span>}
              <span className={cx('rh-pay-option__radio', method === option.id && 'is-on')} aria-hidden="true" />
            </button>
          ))}
          <p className="rh-client-hint">
            <Icon name="shield" size="sm" /> {t('checkout.infoNoCard')}
          </p>
        </section>

        <section className="rh-checkout-summary">
          <h2>{t('checkout.summary')}</h2>
          <div className="rh-checkout-lines">
            {cart.items.map((item) => (
              <div key={item.key}>
                <span>
                  {item.quantity} × {item.name}
                  {item.variantName ? ` · ${item.variantName}` : ''}
                </span>
                <strong>{formatXof(item.unitPriceXof * item.quantity, locale)}</strong>
              </div>
            ))}
          </div>
          <div className="rh-checkout-totals">
            <div>
              <span>{t('cart.subtotal')}</span>
              <span>{formatXof(subtotal, locale)}</span>
            </div>
            {deliveryFee > 0 && (
              <div>
                <span>{t('cart.deliveryFee')}</span>
                <span>{formatXof(deliveryFee, locale)}</span>
              </div>
            )}
            <div className="rh-cart-totals__grand">
              <span>{t('cart.total')}</span>
              <strong>{formatXof(total, locale)}</strong>
            </div>
          </div>
          <div className="rh-checkout-context">
            <span>
              <Icon name="users" size="sm" /> {draft.name || '—'} · {draft.phone || '—'}
            </span>
            <span>
              <Icon name={channel === 'sur_place' ? 'qr' : channel === 'livraison' ? 'truck' : 'box'} size="sm" />
              {channel === 'sur_place'
                ? t('cart.tableFromQr', { code: cart.tableCode ?? '' })
                : channel === 'livraison'
                  ? t('cart.livraison')
                  : channel === 'precommande'
                    ? t('cart.precommande')
                    : t('cart.aEmporter')}
            </span>
            <button type="button" className="rh-client-link-btn" onClick={() => navigate(`/e/${establishment.slug}/panier`)}>
              {t('checkout.backToCart')}
            </button>
          </div>
          <p className="rh-client-hint">
            {t('cart.items', { count: cart.items.length })} · {t('cart.taxesIncluded')}
          </p>
        </section>

        <div className="rh-checkout-actions">
          <button type="button" className="rh-client-btn rh-client-btn--primary rh-client-btn--block rh-client-btn--lg" onClick={placeOrder} disabled={placing}>
            {placing ? t('checkout.placing') : t('checkout.placeOrder')}
          </button>
        </div>
      </main>
    </div>
  );
}
