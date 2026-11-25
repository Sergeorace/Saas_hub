import { useEffect, useState } from 'react';
import { Icon, Input, Textarea, cx, formatXof, useI18n, useToast } from '@resto-hub/design-system';
import type { OrderChannel } from '../lib/api';
import { useEstablishment } from '../lib/hooks';
import { useTenantTheme } from '../lib/tenantTheme';
import { navigate } from '../lib/router';
import { cartCount, cartSubtotal, removeItem, setQuantity, updateCart, useCart } from '../lib/cart';
import { ClientHeader, PageLoading } from '../components/ClientChrome';

const CUSTOMER_KEY = 'restohub.client.customer';

export interface CustomerDraft {
  name: string;
  phone: string;
  address: string;
  note: string;
}

export function loadCustomerDraft(): CustomerDraft {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_KEY);
    if (!raw) return { name: '', phone: '', address: '', note: '' };
    const parsed = JSON.parse(raw) as Partial<CustomerDraft>;
    return { name: parsed.name ?? '', phone: parsed.phone ?? '', address: parsed.address ?? '', note: parsed.note ?? '' };
  } catch {
    return { name: '', phone: '', address: '', note: '' };
  }
}

export function saveCustomerDraft(draft: CustomerDraft) {
  try {
    window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify(draft));
  } catch {
    /* stockage indisponible */
  }
}

const DELIVERY_FEE = 1000;

export default function CartPage({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { data, loading, error } = useEstablishment(slug);
  const establishment = data?.establishment;
  useTenantTheme(establishment ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor } : null);

  const cart = useCart(establishment?.id);
  const [draft, setDraft] = useState<CustomerDraft>(() => loadCustomerDraft());

  useEffect(() => {
    saveCustomerDraft(draft);
  }, [draft]);

  const hasTable = Boolean(cart.tableCode && cart.tableToken);
  const channel: OrderChannel = hasTable && cart.channel === 'sur_place' ? 'sur_place' : cart.channel === 'sur_place' ? 'a_emporter' : cart.channel;
  const subtotal = cartSubtotal(cart);
  const deliveryFee = channel === 'livraison' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;
  const count = cartCount(cart);

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.loading')} back={`/e/${slug}/menu`} />
        <PageLoading />
      </div>
    );
  }

  if (error || !establishment) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('common.error')} back="/recherche" />
        <main className="rh-client-page">
          <div className="rh-client-error">
            <p>{error?.message ?? t('common.error')}</p>
            <button type="button" className="rh-client-link-btn" onClick={() => navigate(`/e/${slug}/menu`)}>
              {t('cart.browseMenu')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const setChannel = (next: OrderChannel) => {
    if (next === 'sur_place' && !hasTable) {
      toast.push({ title: t('cart.surPlaceRequiresQr'), tone: 'warning' });
      navigate(`/scan?tenant=${establishment.slug}`);
      return;
    }
    updateCart(cart, { channel: next });
  };

  const goCheckout = () => {
    if (cart.items.length === 0) return;
    if (!draft.name.trim() || !draft.phone.trim()) {
      toast.push({ title: t('checkout.customerRequired'), tone: 'warning' });
      return;
    }
    if (channel === 'livraison' && !draft.address.trim()) {
      toast.push({ title: t('cart.address'), tone: 'warning' });
      return;
    }
    saveCustomerDraft(draft);
    updateCart(cart, { channel });
    navigate(`/e/${establishment.slug}/paiement`);
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader
        title={t('cart.title')}
        subtitle={`${count} ${t('cart.items', { count }).replace(String(count), '').trim()}`.trim()}
        back={`/e/${establishment.slug}/menu`}
        logo={establishment.logoUrl}
      />
      <main className="rh-client-page rh-client-page--flush">
        {cart.items.length === 0 ? (
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
        ) : (
          <>
            <section className="rh-cart-channel">
              <h2>{t('cart.channel')}</h2>
              <div className="rh-cart-channel__grid" role="radiogroup" aria-label={t('cart.channel')}>
                {([
                  ['sur_place', t('cart.surPlace'), 'utensils'],
                  ['a_emporter', t('cart.aEmporter'), 'box'],
                  ['livraison', t('cart.livraison'), 'truck'],
                  ['precommande', t('cart.precommande'), 'calendar'],
                ] as const).map(([value, label, icon]) => {
                  const disabled = value === 'sur_place' && !hasTable;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={channel === value}
                      className={cx('rh-cart-channel__btn', channel === value && 'is-active', disabled && 'is-disabled')}
                      onClick={() => setChannel(value)}
                    >
                      <Icon name={icon} size="sm" />
                      {label}
                    </button>
                  );
                })}
              </div>
              {hasTable ? (
                <p className="rh-client-hint">
                  <Icon name="qr" size="sm" /> {t('cart.tableFromQr', { code: cart.tableCode ?? '' })}
                </p>
              ) : (
                <p className="rh-client-hint">
                  {t('cart.tableMissing')}{' '}
                  <button type="button" className="rh-client-link-btn" onClick={() => navigate(`/scan?tenant=${establishment.slug}`)}>
                    {t('cart.tableMissingCta')}
                  </button>
                </p>
              )}
            </section>

            <section className="rh-cart-items">
              {cart.items.map((item) => (
                <article className="rh-cart-item" key={item.key}>
                  {item.photo ? (
                    <img src={item.photo} alt="" loading="lazy" />
                  ) : (
                    <span className="rh-cart-item__placeholder">
                      <Icon name={item.station === 'bar' ? 'coffee' : 'utensils'} size="sm" />
                    </span>
                  )}
                  <div className="rh-cart-item__body">
                    <strong>{item.name}</strong>
                    {item.variantName && <span>{item.variantName}</span>}
                    {item.options.length > 0 && <span>{item.options.map((option) => option.name).join(' · ')}</span>}
                    {item.notes && <em>{t('cart.notesShort')} : {item.notes}</em>}
                    <div className="rh-cart-item__bottom">
                      <div className="rh-qty rh-qty--sm">
                        <button type="button" aria-label={t('common.remove')} onClick={() => setQuantity(cart, item.key, item.quantity - 1)}>
                          <Icon name="minus" size="sm" />
                        </button>
                        <strong>{item.quantity}</strong>
                        <button type="button" aria-label={t('common.add')} onClick={() => setQuantity(cart, item.key, item.quantity + 1)}>
                          <Icon name="plus" size="sm" />
                        </button>
                      </div>
                      <strong>{formatXof(item.unitPriceXof * item.quantity, locale)}</strong>
                    </div>
                  </div>
                  <button type="button" className="rh-cart-item__remove" aria-label={t('common.remove')} onClick={() => removeItem(cart, item.key)}>
                    <Icon name="trash" size="sm" />
                  </button>
                </article>
              ))}
            </section>

            <section className="rh-cart-details">
              <h2>{t('cart.customerTitle')}</h2>
              <Input
                label={t('cart.name')}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                autoComplete="name"
                required
              />
              <Input
                label={t('cart.phone')}
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+228 90 12 34 56"
                required
              />
              {channel === 'livraison' && (
                <Input
                  label={t('cart.address')}
                  value={draft.address}
                  onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                  autoComplete="street-address"
                  required
                />
              )}
              <Textarea
                label={`${t('cart.note')} (${t('common.optional')})`}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                placeholder={t('cart.notePlaceholder')}
                rows={2}
                maxLength={240}
              />
            </section>

            <section className="rh-cart-totals">
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
              <p>{t('cart.taxesIncluded')}</p>
            </section>

            <div className="rh-cart-actions">
              <button type="button" className="rh-client-btn rh-client-btn--primary rh-client-btn--block" onClick={goCheckout}>
                {t('cart.checkout')} <Icon name="arrow-right" size="sm" />
              </button>
              <button type="button" className="rh-client-btn rh-client-btn--ghost rh-client-btn--block" onClick={() => navigate(`/e/${establishment.slug}/menu`)}>
                {t('cart.continueShopping')}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
