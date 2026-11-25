import { useEffect, useState } from 'react';
import type { OrderChannel } from './api';

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  optionChoiceIds: string[];
  options: Array<{ id: string; name: string; priceXof: number }>;
  unitPriceXof: number;
  quantity: number;
  station: 'cuisine' | 'bar';
  notes?: string;
  photo?: string;
}

export interface Cart {
  tenantId: string;
  channel: OrderChannel;
  tableCode?: string;
  tableToken?: string;
  items: CartItem[];
  updatedAt: string;
}

const cartKey = (tenantId: string) => `restohub.cart.${tenantId}`;
const changeEvent = (tenantId: string) => `restohub:cart:${tenantId}`;

export function emptyCart(tenantId: string): Cart {
  return { tenantId, channel: 'sur_place', items: [], updatedAt: new Date().toISOString() };
}

export function loadCart(tenantId: string): Cart {
  try {
    const raw = window.localStorage.getItem(cartKey(tenantId));
    if (!raw) return emptyCart(tenantId);
    const parsed = JSON.parse(raw) as Cart;
    if (!Array.isArray(parsed.items)) return emptyCart(tenantId);
    return { ...emptyCart(tenantId), ...parsed, tenantId };
  } catch {
    return emptyCart(tenantId);
  }
}

export function saveCart(cart: Cart): Cart {
  const next = { ...cart, updatedAt: new Date().toISOString() };
  try {
    if (next.items.length === 0 && !next.tableToken) {
      window.localStorage.removeItem(cartKey(next.tenantId));
    } else {
      window.localStorage.setItem(cartKey(next.tenantId), JSON.stringify(next));
    }
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new CustomEvent<Cart>(changeEvent(next.tenantId), { detail: next }));
  return next;
}

function itemKey(input: {
  productId: string;
  variantId?: string;
  optionChoiceIds: string[];
  notes?: string;
}): string {
  return [input.productId, input.variantId ?? '-', [...input.optionChoiceIds].sort().join('+'), input.notes ?? ''].join('|');
}

export function addItem(
  cart: Cart,
  input: Omit<CartItem, 'key' | 'quantity'> & { quantity?: number; notes?: string },
): Cart {
  const key = itemKey(input);
  const existing = cart.items.find((item) => item.key === key);
  const quantity = Math.max(1, input.quantity ?? 1);
  const items = existing
    ? cart.items.map((item) =>
        item.key === key ? { ...item, quantity: Math.min(30, item.quantity + quantity) } : item,
      )
    : [...cart.items, { ...input, key, quantity }];
  return saveCart({ ...cart, items });
}

export function setQuantity(cart: Cart, key: string, quantity: number): Cart {
  const items = cart.items
    .map((item) => (item.key === key ? { ...item, quantity: Math.max(0, Math.min(30, quantity)) } : item))
    .filter((item) => item.quantity > 0);
  return saveCart({ ...cart, items });
}

export function removeItem(cart: Cart, key: string): Cart {
  return saveCart({ ...cart, items: cart.items.filter((item) => item.key !== key) });
}

export function updateCart(cart: Cart, patch: Partial<Omit<Cart, 'tenantId' | 'items'>>): Cart {
  return saveCart({ ...cart, ...patch });
}

export function clearCart(cart: Cart): Cart {
  return saveCart({ ...emptyCart(cart.tenantId), channel: cart.channel, tableCode: cart.tableCode, tableToken: cart.tableToken });
}

export function cartCount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function cartSubtotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.unitPriceXof * item.quantity, 0);
}

export function useCart(tenantId: string | null | undefined): Cart {
  const [cart, setCart] = useState<Cart>(() => (tenantId ? loadCart(tenantId) : emptyCart('none')));

  useEffect(() => {
    if (!tenantId) return;
    setCart(loadCart(tenantId));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<Cart>).detail;
      setCart(detail ?? loadCart(tenantId));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === cartKey(tenantId)) setCart(loadCart(tenantId));
    };
    window.addEventListener(changeEvent(tenantId), onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(changeEvent(tenantId), onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [tenantId]);

  return cart;
}
