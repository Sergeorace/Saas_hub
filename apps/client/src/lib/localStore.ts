import type {
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  PublicOrder,
  Reservation,
  ReservationStatus,
} from './api';

const ORDERS_KEY = 'restohub.client.orders';
const RESERVATIONS_KEY = 'restohub.client.reservations';

export interface LocalOrder {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  orderId: string;
  trackingToken: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalXof: number;
  tableCode?: string;
  createdAt: string;
  updatedAt: string;
  lines: Array<{ name: string; variantName?: string; quantity: number; lineTotalXof: number }>;
}

export interface LocalReservation {
  tenantId: string;
  tenantName: string;
  reservationId: string;
  token: string;
  reference: string;
  date: string;
  time: string;
  partySize: number;
  tableCode: string | null;
  status: ReservationStatus;
  createdAt: string;
}

function readList<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, items: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new CustomEvent('restohub:client-history'));
}

export function listOrders(): LocalOrder[] {
  return readList<LocalOrder>(ORDERS_KEY).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrder(orderId: string): LocalOrder | undefined {
  return listOrders().find((order) => order.orderId === orderId);
}

export function saveOrder(entry: LocalOrder): LocalOrder {
  const others = readList<LocalOrder>(ORDERS_KEY).filter(
    (order) => order.orderId !== entry.orderId,
  );
  writeList(ORDERS_KEY, [entry, ...others].slice(0, 40));
  return entry;
}

export function recordPublicOrder(input: {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  trackingToken: string;
  order: PublicOrder;
}): LocalOrder {
  const now = new Date().toISOString();
  const existing = getOrder(input.order.id);
  return saveOrder({
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    tenantSlug: input.tenantSlug,
    orderId: input.order.id,
    trackingToken: input.trackingToken,
    number: input.order.number,
    channel: input.order.channel,
    status: input.order.status,
    paymentStatus: input.order.paymentStatus,
    totalXof: input.order.totalXof,
    tableCode: input.order.tableCode,
    createdAt: existing?.createdAt ?? input.order.createdAt ?? now,
    updatedAt: now,
    lines: input.order.lines,
  });
}

export function syncOrder(order: PublicOrder): LocalOrder | undefined {
  const existing = getOrder(order.id);
  if (!existing) return undefined;
  return saveOrder({
    ...existing,
    status: order.status,
    paymentStatus: order.paymentStatus,
    updatedAt: new Date().toISOString(),
  });
}

export function listReservations(): LocalReservation[] {
  return readList<LocalReservation>(RESERVATIONS_KEY).sort((a, b) =>
    `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`),
  );
}

export function saveReservation(entry: LocalReservation): LocalReservation {
  const others = readList<LocalReservation>(RESERVATIONS_KEY).filter(
    (item) => item.reservationId !== entry.reservationId,
  );
  writeList(RESERVATIONS_KEY, [entry, ...others].slice(0, 40));
  return entry;
}

export function recordReservation(input: {
  tenantId: string;
  tenantName: string;
  token: string;
  reservation: Reservation;
}): LocalReservation {
  const existing = listReservations().find((item) => item.reservationId === input.reservation.id);
  return saveReservation({
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    reservationId: input.reservation.id,
    token: input.token,
    reference: input.reservation.reference,
    date: input.reservation.date,
    time: input.reservation.time,
    partySize: input.reservation.partySize,
    tableCode: input.reservation.tableCode,
    status: input.reservation.status,
    createdAt: existing?.createdAt ?? input.reservation.createdAt,
  });
}

export function updateReservationStatus(reservationId: string, status: ReservationStatus): void {
  const items = readList<LocalReservation>(RESERVATIONS_KEY).map((item) =>
    item.reservationId === reservationId ? { ...item, status } : item,
  );
  writeList(RESERVATIONS_KEY, items);
}
