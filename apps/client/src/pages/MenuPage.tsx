import { useEffect, useMemo, useState } from 'react';
import {
  Icon,
  Modal,
  Skeleton,
  Textarea,
  cx,
  formatXof,
  useI18n,
  useToast,
} from '@resto-hub/design-system';
import { publicApi, type PublicMenuProduct } from '../lib/api';
import { useAsync, useEstablishment } from '../lib/hooks';
import { useTenantTheme } from '../lib/tenantTheme';
import { navigate, useLocation } from '../lib/router';
import { addItem, cartCount, cartSubtotal, updateCart, useCart } from '../lib/cart';
import { ClientHeader, PageLoading } from '../components/ClientChrome';

const ALL_ALLERGENS = [
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

function allergenLabel(t: (key: string) => string, key: string): string {
  return t(`allergens.${key}`);
}

export default function MenuPage({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const tableCode = location.query.get('table') ?? '';
  const tableToken = location.query.get('k') ?? '';

  const { data, loading, error, reload } = useEstablishment(slug);
  const establishment = data?.establishment;

  useTenantTheme(
    establishment
      ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor }
      : null,
  );

  const menuState = useAsync(async () => {
    if (!establishment) return null;
    return publicApi.menu(establishment.id);
  }, [establishment?.id]);

  const tableState = useAsync(async () => {
    if (!establishment || !tableCode) return null;
    return publicApi.table(establishment.id, tableCode);
  }, [establishment?.id, tableCode]);

  const cart = useCart(establishment?.id);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [hideUnavailable, setHideUnavailable] = useState(true);
  const [sheetProduct, setSheetProduct] = useState<PublicMenuProduct | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!cart || !tableCode || !tableToken) return;
    if (cart.tableCode !== tableCode || cart.tableToken !== tableToken) {
      updateCart(cart, { tableCode, tableToken, channel: 'sur_place' });
    }
  }, [cart, tableCode, tableToken]);

  const products = useMemo(() => {
    const list = menuState.data?.categories.flatMap((entry) => entry.products) ?? [];
    return list;
  }, [menuState.data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== 'all' && product.categoryId !== category) return false;
      if (needle && !`${product.name} ${product.description ?? ''}`.toLowerCase().includes(needle))
        return false;
      if (excluded.some((allergen) => product.allergens.includes(allergen))) return false;
      if (hideUnavailable && !product.available) return false;
      return true;
    });
  }, [products, category, search, excluded, hideUnavailable]);

  const grouped = useMemo(() => {
    const categories = menuState.data?.categories ?? [];
    return categories
      .map((entry) => ({
        ...entry,
        products: filtered.filter((product) => product.categoryId === entry.id),
      }))
      .filter((entry) => entry.products.length > 0);
  }, [menuState.data, filtered]);

  const count = cartCount(cart);
  const subtotal = cartSubtotal(cart);

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader
          title={t('common.loading')}
          back={establishment ? `/e/${slug}` : '/recherche'}
        />
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
            <button type="button" className="rh-client-link-btn" onClick={reload}>
              {t('common.retry')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const quickAdd = (product: PublicMenuProduct) => {
    if (product.variants.length > 0 || product.options.length > 0) {
      setSheetProduct(product);
      return;
    }
    addItem(cart, {
      productId: product.id,
      name: product.name,
      optionChoiceIds: [],
      options: [],
      unitPriceXof: product.priceXof,
      station: product.station,
      photo: product.photos[0],
    });
    toast.push({ title: t('common.saved'), description: product.name, tone: 'success' });
  };

  const hasTable = Boolean(tableCode && tableToken);
  const tableLabel = tableState.data?.table.code ?? tableCode;

  return (
    <div className="rh-client-screen rh-client-screen--cart">
      <ClientHeader
        title={t('menu.title')}
        subtitle={establishment.brandName}
        back={`/e/${establishment.slug}`}
        logo={establishment.logoUrl}
        actions={
          <button
            type="button"
            className={cx(
              'rh-chrome-btn rh-chrome-btn--round',
              (search || excluded.length > 0) && 'rh-chrome-btn--on',
            )}
            aria-label={t('menu.filters')}
            onClick={() => setShowFilters((value) => !value)}
          >
            <Icon name="filter" size="sm" />
            {excluded.length > 0 && <span className="rh-chrome-btn__dot">{excluded.length}</span>}
          </button>
        }
      />

      <main className="rh-client-page rh-client-page--flush">
        {hasTable && (
          <div className="rh-table-banner">
            <Icon name="qr" size="sm" />
            <span>
              {tableLabel
                ? t('menu.tableOrdering', { code: tableLabel })
                : t('menu.tableOrderingUnknown')}
            </span>
            <button
              type="button"
              onClick={() => navigate(`/e/${establishment.slug}/menu?table=&k=`)}
            >
              {t('menu.changeTable')}
            </button>
          </div>
        )}

        <div className="rh-menu-search">
          <Icon name="search" size="sm" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('menu.searchPlaceholder')}
            aria-label={t('common.search')}
          />
          {search && (
            <button type="button" aria-label={t('explore.reset')} onClick={() => setSearch('')}>
              <Icon name="x" size="sm" />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="rh-filter-panel">
            <div className="rh-filter-panel__head">
              <strong>{t('menu.allergensSafe')}</strong>
              {excluded.length > 0 && (
                <button
                  type="button"
                  className="rh-client-link-btn"
                  onClick={() => setExcluded([])}
                >
                  {t('explore.reset')}
                </button>
              )}
            </div>
            <div className="rh-client-chips rh-client-chips--wrap">
              {ALL_ALLERGENS.map((allergen) => {
                const active = excluded.includes(allergen);
                return (
                  <button
                    key={allergen}
                    type="button"
                    className={cx(
                      'rh-client-chip rh-client-chip--sm',
                      active && 'rh-client-chip--danger',
                    )}
                    aria-pressed={active}
                    onClick={() =>
                      setExcluded((current) =>
                        current.includes(allergen)
                          ? current.filter((item) => item !== allergen)
                          : [...current, allergen],
                      )
                    }
                  >
                    {active && <Icon name="x" size="sm" />} {allergenLabel(t, allergen)}
                  </button>
                );
              })}
            </div>
            <label className="rh-client-switchline">
              <input
                type="checkbox"
                checked={hideUnavailable}
                onChange={(event) => setHideUnavailable(event.target.checked)}
              />
              <span>{t('menu.hideUnavailable')}</span>
            </label>
          </div>
        )}

        <nav className="rh-menu-cats" aria-label={t('menu.categories')}>
          <button
            type="button"
            className={cx('rh-client-chip', category === 'all' && 'rh-client-chip--active')}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            {t('menu.allCategories')}
          </button>
          {menuState.data?.categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx('rh-client-chip', category === entry.id && 'rh-client-chip--active')}
              aria-pressed={category === entry.id}
              onClick={() => setCategory(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </nav>

        {menuState.loading ? (
          <div className="rh-menu-grid">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} height={214} />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="utensils" />
            </span>
            <h2>{t('menu.empty')}</h2>
            <p>{t('menu.emptyDesc')}</p>
            <button
              type="button"
              className="rh-client-link-btn"
              onClick={() => {
                setSearch('');
                setExcluded([]);
                setCategory('all');
              }}
            >
              {t('explore.reset')}
            </button>
          </div>
        ) : (
          grouped.map((entry) => (
            <section key={entry.id} className="rh-menu-section">
              <h2 className="rh-menu-section__title">{entry.name}</h2>
              <div className="rh-menu-grid">
                {entry.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAdd={() => quickAdd(product)}
                    labelAdd={t('menu.add')}
                    labelOut={t('menu.outOfStock')}
                    happyHourLabel={t('menu.happyHour')}
                    baseLabel={t('menu.basePrice', {
                      price: formatXof(product.basePriceXof, locale),
                    })}
                    allergensLabel={t('menu.allergensLabel')}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {(menuState.data?.menus.length ?? 0) > 0 && (
          <section className="rh-menu-section">
            <h2 className="rh-menu-section__title">{t('menu.formulas')}</h2>
            <div className="rh-formulas">
              {menuState.data?.menus.map((formula) => (
                <div className="rh-formula" key={formula.id}>
                  <div>
                    <strong>{formula.name}</strong>
                    {formula.description && <p>{formula.description}</p>}
                    <span>
                      {formula.items.map((item) => `${item.quantity} × ${item.name}`).join(' · ')}
                    </span>
                  </div>
                  <strong className="rh-formula__price">
                    {formatXof(formula.priceXof, locale)}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {(menuState.data?.promotions.length ?? 0) > 0 && (
          <section className="rh-menu-promo">
            <Icon name="sparkles" />
            <div>
              {menuState.data?.promotions.map((promotion) => (
                <span key={promotion.id}>
                  {promotion.name}
                  {promotion.code ? ` · ${promotion.code}` : ''}
                </span>
              ))}
            </div>
          </section>
        )}
      </main>

      {count > 0 && (
        <button
          type="button"
          className="rh-cart-bar"
          onClick={() => navigate(`/e/${establishment.slug}/panier`)}
        >
          <span className="rh-cart-bar__count">{count}</span>
          <span className="rh-cart-bar__label">
            {t('menu.itemsInCart', { count })}
            <small>{formatXof(subtotal, locale)}</small>
          </span>
          <span className="rh-cart-bar__cta">
            {t('menu.viewCart')} <Icon name="arrow-right" size="sm" />
          </span>
        </button>
      )}

      <ProductSheet
        product={sheetProduct}
        onClose={() => setSheetProduct(null)}
        onAdd={(payload) => {
          if (!sheetProduct) return;
          addItem(cart, {
            productId: sheetProduct.id,
            name: sheetProduct.name,
            variantId: payload.variantId,
            variantName: payload.variantName,
            optionChoiceIds: payload.optionChoiceIds,
            options: payload.options,
            unitPriceXof: payload.unitPriceXof,
            station: sheetProduct.station,
            notes: payload.notes,
            photo: sheetProduct.photos[0],
            quantity: payload.quantity,
          });
          toast.push({ title: t('common.saved'), description: sheetProduct.name, tone: 'success' });
          setSheetProduct(null);
        }}
      />
    </div>
  );
}

function ProductCard({
  product,
  onAdd,
  labelAdd,
  labelOut,
  happyHourLabel,
  baseLabel,
  allergensLabel,
}: {
  product: PublicMenuProduct;
  onAdd: () => void;
  labelAdd: string;
  labelOut: string;
  happyHourLabel: string;
  baseLabel: string;
  allergensLabel: string;
}) {
  const { t, locale } = useI18n();
  const hasOptions = product.variants.length > 0 || product.options.length > 0;
  const happyHour = product.priceXof < product.basePriceXof;
  return (
    <article className={cx('rh-product-card', !product.available && 'rh-product-card--out')}>
      <div className="rh-product-card__media">
        {product.photos[0] ? (
          <img src={product.photos[0]} alt={product.name} loading="lazy" />
        ) : (
          <div className="rh-product-card__placeholder" aria-hidden="true">
            <Icon name={product.station === 'bar' ? 'coffee' : 'utensils'} />
          </div>
        )}
        {happyHour && <span className="rh-product-card__hh">{happyHourLabel}</span>}
        {!product.available && <span className="rh-product-card__out">{labelOut}</span>}
      </div>
      <div className="rh-product-card__body">
        <h3>{product.name}</h3>
        {product.description && <p>{product.description}</p>}
        {product.allergens.length > 0 && (
          <div className="rh-product-card__allergens" aria-label={allergensLabel}>
            {product.allergens.map((allergen) => (
              <span key={allergen}>{t(`allergens.${allergen}`)}</span>
            ))}
          </div>
        )}
        <div className="rh-product-card__footer">
          <div className="rh-product-card__price">
            <strong>{formatXof(product.priceXof, locale)}</strong>
            {happyHour && <s>{formatXof(product.basePriceXof, locale)}</s>}
            {hasOptions && (
              <span>{t('menu.fromPrice', { price: formatXof(product.priceXof, locale) })}</span>
            )}
          </div>
          <button
            type="button"
            className={cx('rh-product-card__add', hasOptions && 'rh-product-card__add--text')}
            disabled={!product.available}
            onClick={onAdd}
            aria-label={`${labelAdd} ${product.name}`}
          >
            {hasOptions ? labelAdd : <Icon name="plus" size="sm" />}
          </button>
        </div>
        {happyHour && <span className="rh-product-card__base">{baseLabel}</span>}
      </div>
    </article>
  );
}

function ProductSheet({
  product,
  onClose,
  onAdd,
}: {
  product: PublicMenuProduct | null;
  onClose: () => void;
  onAdd: (payload: {
    variantId?: string;
    variantName?: string;
    optionChoiceIds: string[];
    options: Array<{ id: string; name: string; priceXof: number }>;
    unitPriceXof: number;
    notes?: string;
    quantity: number;
  }) => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [variantId, setVariantId] = useState<string | undefined>();
  const [choices, setChoices] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setVariantId(product?.variants[0]?.id);
    setChoices([]);
    setNotes('');
    setQuantity(1);
  }, [product?.id]);

  if (!product) return null;
  const variant = product.variants.find((item) => item.id === variantId);
  const basePrice = variant?.priceXof ?? product.priceXof;
  const selectedOptions = product.options.flatMap((group) =>
    group.choices
      .filter((choice) => choices.includes(choice.id))
      .map((choice) => ({
        id: choice.id,
        name: choice.name,
        priceXof: choice.priceDeltaXof,
      })),
  );
  const unitPrice = basePrice + selectedOptions.reduce((sum, option) => sum + option.priceXof, 0);

  const toggleChoice = (group: PublicMenuProduct['options'][number], choiceId: string) => {
    const groupChoiceIds = group.choices.map((choice) => choice.id);
    setChoices((current) => {
      const selectedInGroup = current.filter((id) => groupChoiceIds.includes(id));
      if (current.includes(choiceId)) return current.filter((id) => id !== choiceId);
      if (group.maxSelect === 1)
        return [...current.filter((id) => !groupChoiceIds.includes(id)), choiceId];
      if (selectedInGroup.length >= group.maxSelect) return current;
      return [...current, choiceId];
    });
  };

  const submit = () => {
    const missing = product.options.find(
      (group) =>
        group.required &&
        choices.filter((id) => group.choices.some((choice) => choice.id === id)).length <
          group.minSelect,
    );
    if (missing) {
      toast.push({
        title: t('menu.optionRequired', { count: missing.minSelect }),
        description: missing.name,
        tone: 'warning',
      });
      return;
    }
    onAdd({
      variantId,
      variantName: variant?.name,
      optionChoiceIds: choices,
      options: selectedOptions,
      unitPriceXof: unitPrice,
      notes: notes.trim() || undefined,
      quantity,
    });
  };

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title={product.name}
      description={product.description}
      size="lg"
    >
      <div className="rh-sheet">
        {product.photos[0] && (
          <img className="rh-sheet__img" src={product.photos[0]} alt={product.name} />
        )}
        {product.variants.length > 0 && (
          <fieldset className="rh-sheet__group">
            <legend>{t('menu.chooseVariant')}</legend>
            <div className="rh-sheet__choices">
              {product.variants.map((item) => (
                <label
                  key={item.id}
                  className={cx('rh-sheet__choice', variantId === item.id && 'is-selected')}
                >
                  <input
                    type="radio"
                    name="variant"
                    checked={variantId === item.id}
                    onChange={() => setVariantId(item.id)}
                  />
                  <span>{item.name}</span>
                  <strong>{formatXof(item.priceXof, locale)}</strong>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {product.options.map((group) => (
          <fieldset className="rh-sheet__group" key={group.id}>
            <legend>
              {group.name}
              <em>
                {group.required
                  ? t('menu.optionBetween', { min: group.minSelect, max: group.maxSelect })
                  : t('common.optional')}
              </em>
            </legend>
            <div className="rh-sheet__choices">
              {group.choices.map((choice) => {
                const checked = choices.includes(choice.id);
                return (
                  <label
                    key={choice.id}
                    className={cx('rh-sheet__choice', checked && 'is-selected')}
                  >
                    <input
                      type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                      name={group.id}
                      checked={checked}
                      onChange={() => toggleChoice(group, choice.id)}
                    />
                    <span>{choice.name}</span>
                    <strong>
                      {choice.priceDeltaXof > 0
                        ? `+ ${formatXof(choice.priceDeltaXof, locale)}`
                        : ''}
                    </strong>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {product.allergens.length > 0 && (
          <p className="rh-sheet__allergens">
            <Icon name="alert" size="sm" /> {t('menu.allergensLabel')} :{' '}
            {product.allergens.map((allergen) => t(`allergens.${allergen}`)).join(', ')}
          </p>
        )}

        <Textarea
          label={t('menu.notes')}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('menu.notesPlaceholder')}
          maxLength={180}
          rows={2}
        />

        <div className="rh-sheet__qty">
          <span>{t('cart.quantity')}</span>
          <div className="rh-qty">
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              aria-label={t('common.remove')}
            >
              <Icon name="minus" size="sm" />
            </button>
            <strong>{quantity}</strong>
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.min(20, value + 1))}
              aria-label={t('common.add')}
            >
              <Icon name="plus" size="sm" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="rh-client-btn rh-client-btn--primary rh-client-btn--block"
          onClick={submit}
        >
          {t('menu.addWithPrice', { price: formatXof(unitPrice * quantity, locale) })}
        </button>
      </div>
    </Modal>
  );
}
