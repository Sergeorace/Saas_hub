import {
  buildAuditEntry,
  newId,
  nowIso,
  randomToken,
  type AuditEntry,
} from '@resto-hub/service-kit';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type OrderStatus,
  type PaymentMethod,
} from '@resto-hub/shared-contracts';

export { ORDER_STATUSES, PAYMENT_METHODS, type OrderStatus, type PaymentMethod };

export const ORDER_CHANNELS = ['sur_place', 'a_emporter', 'livraison', 'precommande'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  recue: ['en_preparation', 'annulee'],
  en_preparation: ['prete', 'annulee'],
  prete: ['servie', 'annulee'],
  servie: [],
  annulee: [],
};

export const STATIONS = ['cuisine', 'bar'] as const;
export type Station = (typeof STATIONS)[number];

export const TICKET_STATUSES = ['nouvelle', 'en_preparation', 'prete'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type PaymentStatus = 'impayee' | 'partielle' | 'payee';

export interface OrderOption {
  id: string;
  name: string;
  priceXof: number;
}

export interface OrderLine {
  id: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  options: OrderOption[];
  quantity: number;
  unitPriceXof: number;
  lineTotalXof: number;
  station: Station;
  notes?: string;
}

export interface OrderDiscount {
  type: 'percent' | 'amount';
  value: number;
  reason: string;
  amountXof: number;
  authorizedBy: string;
  at: string;
}

export interface OrderCustomer {
  name: string;
  phone?: string;
  address?: string;
  note?: string;
}

export interface OrderPayment {
  id: string;
  tenantId: string;
  orderId: string;
  sessionId?: string;
  method: PaymentMethod;
  amountXof: number;
  reference?: string;
  at: string;
  by: string;
}

export interface Order {
  id: string;
  tenantId: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  source: 'client' | 'staff';
  createdBy: string;
  tableId?: string;
  tableCode?: string;
  customer?: OrderCustomer;
  guests?: number;
  scheduledFor?: string;
  lines: OrderLine[];
  subtotalXof: number;
  discount?: OrderDiscount;
  deliveryFeeXof: number;
  totalXof: number;
  netXof: number;
  taxXof: number;
  taxRate: number;
  payments: OrderPayment[];
  paymentStatus: PaymentStatus;
  invoiceNumber?: string;
  receiptNumber?: string;
  receiptIssuedAt?: string;
  cancel?: { reason: string; by: string; at: string };
  clientRequestId?: string;
  publicToken: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  preparingAt?: string;
  readyAt?: string;
  servedAt?: string;
  canceledAt?: string;
}

export interface StationTicket {
  id: string;
  tenantId: string;
  orderId: string;
  station: Station;
  status: TicketStatus;
  lineIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CashSession {
  id: string;
  tenantId: string;
  status: 'ouverte' | 'cloturee';
  openedBy: string;
  openedAt: string;
  openingFloatXof: number;
  closedBy?: string;
  closedAt?: string;
  countedXof?: number;
  expectedXof?: number;
  differenceXof?: number;
  notes?: string;
}

export interface OrderCounters {
  year: number;
  order: number;
  invoice: number;
  receipt: number;
}

export interface OrderStore {
  orders: Map<string, Order>;
  tickets: Map<string, StationTicket>;
  payments: Map<string, OrderPayment>;
  sessions: Map<string, CashSession>;
  counters: Map<string, OrderCounters>;
  audit: AuditEntry[];
  recordAudit(input: {
    tenantId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  }): AuditEntry;
}

export function createOrderStore(): OrderStore {
  const store: OrderStore = {
    orders: new Map(),
    tickets: new Map(),
    payments: new Map(),
    sessions: new Map(),
    counters: new Map(),
    audit: [],
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
  };
  return store;
}

export function newOrderId(prefix: string): string {
  return newId(prefix);
}

export function taxBreakdown(
  totalXof: number,
  taxRate: number,
): { netXof: number; taxXof: number } {
  const netXof = Math.round(totalXof / (1 + taxRate));
  return { netXof, taxXof: totalXof - netXof };
}

export function nextNumber(
  store: OrderStore,
  tenantId: string,
  kind: 'order' | 'invoice' | 'receipt',
): string {
  const year = new Date().getUTCFullYear();
  let counters = store.counters.get(tenantId);
  if (!counters || counters.year !== year) {
    counters = {
      year,
      order: 0,
      invoice: 0,
      receipt: 0,
      ...(counters?.year === year
        ? { order: counters.order, invoice: counters.invoice, receipt: counters.receipt }
        : {}),
    };
    store.counters.set(tenantId, counters);
  }
  counters[kind] += 1;
  const seq = String(counters[kind]).padStart(6, '0');
  const prefix = kind === 'order' ? 'CMD' : kind === 'invoice' ? 'FA' : 'REC';
  return `${prefix}-${year}-${seq}`;
}

export function ticketsForOrder(
  store: OrderStore,
  tenantId: string,
  orderId: string,
): StationTicket[] {
  return [...store.tickets.values()]
    .filter((ticket) => ticket.tenantId === tenantId && ticket.orderId === orderId)
    .sort((a, b) => a.station.localeCompare(b.station));
}

export function createTickets(store: OrderStore, order: Order, actorId: string): StationTicket[] {
  const now = nowIso();
  const tickets: StationTicket[] = [];
  for (const station of STATIONS) {
    const lineIds = order.lines.filter((line) => line.station === station).map((line) => line.id);
    if (lineIds.length === 0) continue;
    const ticket: StationTicket = {
      id: newOrderId('tkt'),
      tenantId: order.tenantId,
      orderId: order.id,
      station,
      status: 'nouvelle',
      lineIds,
      createdAt: now,
      updatedAt: now,
      updatedBy: actorId,
    };
    store.tickets.set(ticket.id, ticket);
    tickets.push(ticket);
  }
  return tickets;
}

export function seedOrderDemo(store: OrderStore): void {
  if (store.orders.size > 0) return;
  const tenantId = 'tnt_sahelgrill';
  const actor = 'usr_demo_seed';
  const year = new Date().getUTCFullYear();
  store.counters.set(tenantId, { year, order: 7, invoice: 2, receipt: 2 });

  const line = (
    id: string,
    productId: string,
    productName: string,
    unitPriceXof: number,
    quantity: number,
    station: Station,
    extra: Partial<OrderLine> = {},
  ): OrderLine => ({
    id,
    productId,
    productName,
    options: [],
    quantity,
    unitPriceXof,
    lineTotalXof: unitPriceXof * quantity,
    station,
    ...extra,
  });

  const buildOrder = (input: {
    id: string;
    seq: number;
    channel: OrderChannel;
    status: OrderStatus;
    tableCode?: string;
    tableId?: string;
    lines: OrderLine[];
    source?: 'client' | 'staff';
    customer?: OrderCustomer;
    scheduledFor?: string;
    deliveryFeeXof?: number;
    paymentMethod?: PaymentMethod;
    invoiceSeq?: number;
    cancelReason?: string;
    minutesAgo?: number;
  }): Order => {
    const subtotalXof = input.lines.reduce((sum, entry) => sum + entry.lineTotalXof, 0);
    const deliveryFeeXof = input.deliveryFeeXof ?? 0;
    const totalXof = subtotalXof + deliveryFeeXof;
    const { netXof, taxXof } = taxBreakdown(totalXof, 0.18);
    const created = new Date(Date.now() - (input.minutesAgo ?? 5) * 60_000).toISOString();
    const order: Order = {
      id: input.id,
      tenantId,
      number: `CMD-${year}-${String(input.seq).padStart(6, '0')}`,
      channel: input.channel,
      status: input.status,
      source: input.source ?? 'staff',
      createdBy: actor,
      tableId: input.tableId,
      tableCode: input.tableCode,
      customer: input.customer,
      scheduledFor: input.scheduledFor,
      lines: input.lines,
      subtotalXof,
      deliveryFeeXof,
      totalXof,
      netXof,
      taxXof,
      taxRate: 0.18,
      payments: [],
      paymentStatus: 'impayee',
      publicToken: randomToken(8),
      version: 1,
      createdAt: created,
      updatedAt: created,
      preparingAt: input.status !== 'recue' && input.status !== 'annulee' ? created : undefined,
      readyAt: input.status === 'prete' || input.status === 'servie' ? created : undefined,
      servedAt: input.status === 'servie' ? created : undefined,
      canceledAt: input.status === 'annulee' ? created : undefined,
      cancel: input.cancelReason
        ? { reason: input.cancelReason, by: actor, at: created }
        : undefined,
    };
    if (input.paymentMethod) {
      const payment: OrderPayment = {
        id: newOrderId('pay'),
        tenantId,
        orderId: order.id,
        method: input.paymentMethod,
        amountXof: totalXof,
        at: created,
        by: actor,
      };
      order.payments.push(payment);
      order.paymentStatus = 'payee';
      order.invoiceNumber = `FA-${year}-${String(input.invoiceSeq ?? 1).padStart(6, '0')}`;
      order.receiptNumber = `REC-${year}-${String(input.invoiceSeq ?? 1).padStart(6, '0')}`;
      order.receiptIssuedAt = created;
      store.payments.set(payment.id, payment);
    }
    store.orders.set(order.id, order);
    const ticketStatus: TicketStatus =
      input.status === 'recue'
        ? 'nouvelle'
        : input.status === 'en_preparation'
          ? 'en_preparation'
          : 'prete';
    const ticketLines = new Map<Station, string[]>();
    for (const entry of order.lines) {
      ticketLines.set(entry.station, [...(ticketLines.get(entry.station) ?? []), entry.id]);
    }
    for (const [station, lineIds] of ticketLines) {
      const ticket: StationTicket = {
        id: newOrderId('tkt'),
        tenantId,
        orderId: order.id,
        station,
        status: input.status === 'annulee' ? 'prete' : ticketStatus,
        lineIds,
        createdAt: created,
        updatedAt: created,
        updatedBy: actor,
      };
      store.tickets.set(ticket.id, ticket);
    }
    return order;
  };

  buildOrder({
    id: 'ord_demo_1001',
    seq: 1,
    channel: 'sur_place',
    status: 'en_preparation',
    tableCode: 'LOME01-SAL-001',
    tableId: 'tbl_sg_s1',
    minutesAgo: 12,
    lines: [
      line('lin_d1_1', 'prd_sg_poulet', 'Poulet braisé', 5000, 1, 'cuisine', {
        variantId: 'var_sg_poulet_entier',
        variantName: 'Entier',
        options: [{ id: 'cho_sg_frites', name: 'Frites', priceXof: 500 }],
        notes: 'Bien épicé',
      }),
      line('lin_d1_2', 'prd_sg_bissap', 'Cocktail Bissap', 2000, 2, 'bar', {
        variantId: 'var_sg_bissap_classique',
        variantName: 'Classique',
      }),
    ],
  });
  buildOrder({
    id: 'ord_demo_1002',
    seq: 2,
    channel: 'sur_place',
    status: 'servie',
    tableCode: 'LOME01-SAL-004',
    tableId: 'tbl_sg_s4',
    minutesAgo: 42,
    lines: [
      line('lin_d2_1', 'prd_sg_attieke', 'Attiéké poisson', 3500, 1, 'cuisine'),
      line('lin_d2_2', 'prd_sg_biere', 'Bière locale', 1500, 1, 'bar'),
    ],
  });
  buildOrder({
    id: 'ord_demo_1003',
    seq: 3,
    channel: 'sur_place',
    status: 'recue',
    tableCode: 'LOME01-TER-002',
    tableId: 'tbl_sg_t2',
    minutesAgo: 3,
    lines: [
      line('lin_d3_1', 'prd_sg_brochettes', 'Brochettes de bœuf', 3000, 1, 'cuisine'),
      line('lin_d3_2', 'prd_sg_biere', 'Bière locale', 1500, 1, 'bar'),
    ],
  });
  buildOrder({
    id: 'ord_demo_1004',
    seq: 4,
    channel: 'sur_place',
    status: 'servie',
    tableCode: 'LOME01-BAR-001',
    tableId: 'tbl_sg_b1',
    minutesAgo: 75,
    paymentMethod: 'especes',
    invoiceSeq: 1,
    lines: [
      line('lin_d4_1', 'prd_sg_bissap', 'Cocktail Bissap', 3500, 1, 'bar', {
        variantId: 'var_sg_bissap_grand',
        variantName: 'Grand',
      }),
      line('lin_d4_2', 'prd_sg_biere', 'Bière locale', 1500, 1, 'bar'),
    ],
  });
  buildOrder({
    id: 'ord_demo_1005',
    seq: 5,
    channel: 'a_emporter',
    status: 'servie',
    minutesAgo: 95,
    source: 'client',
    paymentMethod: 'mobile_money',
    invoiceSeq: 2,
    customer: { name: 'Akouvi Mensah', phone: '+228 90 12 34 56' },
    lines: [line('lin_d5_1', 'prd_sg_salade', 'Salade de fruits', 2000, 2, 'cuisine')],
  });
  buildOrder({
    id: 'ord_demo_1006',
    seq: 6,
    channel: 'livraison',
    status: 'recue',
    minutesAgo: 7,
    source: 'client',
    deliveryFeeXof: 1000,
    customer: {
      name: 'Kossi Adjo',
      phone: '+228 91 55 02 11',
      address: 'Rue des Palmiers, Kégué, Lomé',
    },
    lines: [
      line('lin_d6_1', 'prd_sg_poulet', 'Poulet braisé', 4500, 1, 'cuisine', {
        variantId: 'var_sg_poulet_entier',
        variantName: 'Entier',
        options: [{ id: 'cho_sg_alloco', name: 'Alloco', priceXof: 500 }],
      }),
      line('lin_d6_2', 'prd_sg_bissap', 'Cocktail Bissap', 2000, 1, 'bar'),
    ],
  });
  buildOrder({
    id: 'ord_demo_1007',
    seq: 7,
    channel: 'sur_place',
    status: 'annulee',
    tableCode: 'LOME01-TER-003',
    tableId: 'tbl_sg_t3',
    minutesAgo: 130,
    cancelReason: 'Erreur de saisie du serveur',
    lines: [line('lin_d7_1', 'prd_sg_brochettes', 'Brochettes de bœuf', 3000, 1, 'cuisine')],
  });

  store.recordAudit({
    tenantId,
    actorId: actor,
    action: 'order.seeded',
    targetType: 'orders',
    targetId: tenantId,
    meta: { orders: store.orders.size, tickets: store.tickets.size },
  });
}
