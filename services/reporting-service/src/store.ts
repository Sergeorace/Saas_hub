import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';

export interface Site {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
}

export interface SalesLine {
  productId: string;
  productName: string;
  station: string;
  quantity: number;
  lineTotalXof: number;
}

export interface SalesFact {
  id: string;
  tenantId: string;
  siteId: string;
  orderId: string;
  number: string;
  channel: string;
  tableCode: string | null;
  guests: number | null;
  paidAt: string;
  subtotalXof: number;
  taxXof: number;
  totalXof: number;
  discountXof: number;
  method: string;
  lines: SalesLine[];
}

export interface RefundFact {
  id: string;
  tenantId: string;
  siteId: string;
  refundId: string;
  orderId: string;
  amountXof: number;
  reason: string | null;
  at: string;
}

export interface PaymentFailureFact {
  id: string;
  tenantId: string;
  siteId: string;
  transactionId: string;
  orderId: string;
  amountXof: number;
  reason: string | null;
  at: string;
}

export type ReservationStatus = 'reservee' | 'honoree' | 'annulee';

export interface ReservationFact {
  id: string;
  tenantId: string;
  siteId: string;
  reservationId: string;
  date: string;
  partySize: number;
  status: ReservationStatus;
  at: string;
}

export interface OccupancyFact {
  id: string;
  tenantId: string;
  siteId: string;
  date: string;
  seatsCapacity: number;
  covers: number;
  reservations: number;
  noShows: number;
}

export interface PayrollFact {
  id: string;
  tenantId: string;
  siteId: string;
  runId: string;
  period: string;
  headcount: number;
  totalXof: number;
  paidAt: string;
}

export interface StockFact {
  id: string;
  tenantId: string;
  siteId: string;
  at: string;
  stockValueXof: number;
  wasteXof: number;
  lowStockCount: number;
}

export type ReviewStatusFact = 'pending' | 'approved' | 'rejected';

export interface ReviewFact {
  id: string;
  tenantId: string;
  siteId: string;
  reviewId: string;
  rating: number;
  status: ReviewStatusFact;
  at: string;
}

export interface ReportingStore {
  sites: Map<string, Site>;
  sales: Map<string, SalesFact>;
  refunds: Map<string, RefundFact>;
  failures: Map<string, PaymentFailureFact>;
  reservations: Map<string, ReservationFact>;
  occupancy: Map<string, OccupancyFact>;
  payroll: Map<string, PayrollFact>;
  stock: Map<string, StockFact>;
  reviews: Map<string, ReviewFact>;
  handledEvents: Set<string>;
  audit: AuditEntry[];
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export interface DateFilter {
  tenantId: string;
  siteId: string | null;
  from: string;
  to: string;
}

export function createReportingStore(): ReportingStore {
  const store: ReportingStore = {
    sites: new Map(),
    sales: new Map(),
    refunds: new Map(),
    failures: new Map(),
    reservations: new Map(),
    occupancy: new Map(),
    payroll: new Map(),
    stock: new Map(),
    reviews: new Map(),
    handledEvents: new Set(),
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

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function inRange(iso: string, from: string, to: string): boolean {
  const day = dateOnly(iso);
  return day >= from && day <= to;
}

export function defaultSiteOf(store: ReportingStore, tenantId: string): Site | undefined {
  return [...store.sites.values()].find((site) => site.tenantId === tenantId && site.isDefault);
}

export function sitesOf(store: ReportingStore, tenantId: string): Site[] {
  return [...store.sites.values()].filter((site) => site.tenantId === tenantId);
}

function matched<
  T extends { tenantId: string; siteId: string; at?: string; date?: string; paidAt?: string },
>(entries: Iterable<T>, filter: DateFilter, pick: (entry: T) => string): T[] {
  return [...entries].filter(
    (entry) =>
      entry.tenantId === filter.tenantId &&
      (!filter.siteId || entry.siteId === filter.siteId) &&
      inRange(pick(entry), filter.from, filter.to),
  );
}

export function salesIn(store: ReportingStore, filter: DateFilter): SalesFact[] {
  return matched(store.sales.values(), filter, (entry) => entry.paidAt).sort((a, b) =>
    a.paidAt.localeCompare(b.paidAt),
  );
}

export function refundsIn(store: ReportingStore, filter: DateFilter): RefundFact[] {
  return matched(store.refunds.values(), filter, (entry) => entry.at).sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

export function failuresIn(store: ReportingStore, filter: DateFilter): PaymentFailureFact[] {
  return matched(store.failures.values(), filter, (entry) => entry.at);
}

export function occupancyIn(store: ReportingStore, filter: DateFilter): OccupancyFact[] {
  return matched(store.occupancy.values(), filter, (entry) => entry.date).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function stockIn(store: ReportingStore, filter: DateFilter): StockFact[] {
  return matched(store.stock.values(), filter, (entry) => entry.at).sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

export function payrollIn(store: ReportingStore, filter: DateFilter): PayrollFact[] {
  return matched(store.payroll.values(), filter, (entry) => entry.paidAt).sort((a, b) =>
    a.period.localeCompare(b.period),
  );
}

export function reviewsIn(store: ReportingStore, filter: DateFilter): ReviewFact[] {
  return matched(store.reviews.values(), filter, (entry) => entry.at).sort((a, b) =>
    a.at.localeCompare(b.at),
  );
}

export function reservationsIn(store: ReportingStore, filter: DateFilter): ReservationFact[] {
  return matched(store.reservations.values(), filter, (entry) => entry.date).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sharePct(part: number, whole: number): number {
  return whole > 0 ? round((part / whole) * 100, 1) : 0;
}

export function productRanking(sales: SalesFact[]) {
  const byProduct = new Map<
    string,
    {
      productId: string;
      productName: string;
      station: string;
      quantity: number;
      revenueXof: number;
    }
  >();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const current = byProduct.get(line.productId) ?? {
        productId: line.productId,
        productName: line.productName,
        station: line.station,
        quantity: 0,
        revenueXof: 0,
      };
      current.quantity += line.quantity;
      current.revenueXof += line.lineTotalXof;
      byProduct.set(line.productId, current);
    }
  }
  const revenue = sum([...byProduct.values()].map((entry) => entry.revenueXof));
  return [...byProduct.values()]
    .map((entry) => ({ ...entry, sharePct: sharePct(entry.revenueXof, revenue) }))
    .sort((a, b) => b.revenueXof - a.revenueXof);
}

export function peakHours(sales: SalesFact[]) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenueXof: 0 }));
  for (const sale of sales) {
    const hour = new Date(sale.paidAt).getUTCHours();
    const bucket = buckets[hour];
    bucket.orders += 1;
    bucket.revenueXof += sale.totalXof;
  }
  return buckets;
}

export function paymentMix(sales: SalesFact[], refunds: RefundFact[]) {
  const byMethod = new Map<
    string,
    { method: string; amountXof: number; count: number; refundedXof: number }
  >();
  for (const sale of sales) {
    const current = byMethod.get(sale.method) ?? {
      method: sale.method,
      amountXof: 0,
      count: 0,
      refundedXof: 0,
    };
    current.amountXof += sale.totalXof;
    current.count += 1;
    byMethod.set(sale.method, current);
  }
  for (const refund of refunds) {
    const sale = sales.find((entry) => entry.orderId === refund.orderId);
    if (!sale) continue;
    const current = byMethod.get(sale.method);
    if (current) current.refundedXof += refund.amountXof;
  }
  const total = sum([...byMethod.values()].map((entry) => entry.amountXof));
  return [...byMethod.values()]
    .map((entry) => ({ ...entry, sharePct: sharePct(entry.amountXof, total) }))
    .sort((a, b) => b.amountXof - a.amountXof);
}

export function channelMix(sales: SalesFact[]) {
  const byChannel = new Map<string, { channel: string; amountXof: number; count: number }>();
  for (const sale of sales) {
    const current = byChannel.get(sale.channel) ?? {
      channel: sale.channel,
      amountXof: 0,
      count: 0,
    };
    current.amountXof += sale.totalXof;
    current.count += 1;
    byChannel.set(sale.channel, current);
  }
  const total = sum([...byChannel.values()].map((entry) => entry.amountXof));
  return [...byChannel.values()]
    .map((entry) => ({ ...entry, sharePct: sharePct(entry.amountXof, total) }))
    .sort((a, b) => b.amountXof - a.amountXof);
}

export function dailySeries(sales: SalesFact[], refunds: RefundFact[], from: string, to: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days.map((date) => {
    const daySales = sales.filter((sale) => dateOnly(sale.paidAt) === date);
    const dayRefunds = refunds.filter((refund) => dateOnly(refund.at) === date);
    const revenue = sum(daySales.map((sale) => sale.totalXof));
    return {
      date,
      orders: daySales.length,
      revenueXof: revenue,
      taxXof: sum(daySales.map((sale) => sale.taxXof)),
      refundsXof: sum(dayRefunds.map((refund) => refund.amountXof)),
      averageTicketXof: daySales.length > 0 ? Math.round(revenue / daySales.length) : 0,
    };
  });
}

export function monthlySeries(sales: SalesFact[], refunds: RefundFact[]) {
  const buckets = new Map<
    string,
    { month: string; orders: number; revenueXof: number; taxXof: number; refundsXof: number }
  >();
  const ensure = (month: string) => {
    const current = buckets.get(month) ?? {
      month,
      orders: 0,
      revenueXof: 0,
      taxXof: 0,
      refundsXof: 0,
    };
    buckets.set(month, current);
    return current;
  };
  for (const sale of sales) {
    const bucket = ensure(sale.paidAt.slice(0, 7));
    bucket.orders += 1;
    bucket.revenueXof += sale.totalXof;
    bucket.taxXof += sale.taxXof;
  }
  for (const refund of refunds) {
    const bucket = ensure(refund.at.slice(0, 7));
    bucket.refundsXof += refund.amountXof;
  }
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      averageTicketXof: bucket.orders > 0 ? Math.round(bucket.revenueXof / bucket.orders) : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function reviewSummary(reviews: ReviewFact[]) {
  const approved = reviews.filter((entry) => entry.status === 'approved');
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of approved)
    distribution[review.rating] = (distribution[review.rating] ?? 0) + 1;
  return {
    count: approved.length,
    pending: reviews.filter((entry) => entry.status === 'pending').length,
    average:
      approved.length > 0
        ? round(sum(approved.map((entry) => entry.rating)) / approved.length, 1)
        : 0,
    distribution,
  };
}

export function taxSummary(sales: SalesFact[]) {
  return monthlySeries(sales, []).map((bucket) => ({
    month: bucket.month,
    taxableBaseXof: bucket.revenueXof - bucket.taxXof,
    taxXof: bucket.taxXof,
  }));
}

export function occupancySummary(facts: OccupancyFact[]) {
  const covers = sum(facts.map((entry) => entry.covers));
  const capacity = sum(facts.map((entry) => entry.seatsCapacity));
  return {
    days: facts.length,
    covers,
    capacitySeats: capacity,
    ratePct: capacity > 0 ? round((covers / capacity) * 100, 1) : 0,
    reservations: sum(facts.map((entry) => entry.reservations)),
    noShows: sum(facts.map((entry) => entry.noShows)),
  };
}

export function dashboardView(store: ReportingStore, filter: DateFilter, cogsXof: number | null) {
  const sales = salesIn(store, filter);
  const refunds = refundsIn(store, filter);
  const failures = failuresIn(store, filter);
  const reviews = reviewsIn(store, filter);
  const occupancy = occupancyIn(store, filter);
  const payroll = payrollIn(store, filter);
  const stock = stockIn(store, filter);
  const reservations = reservationsIn(store, filter);
  const revenue = sum(sales.map((sale) => sale.totalXof));
  const tax = sum(sales.map((sale) => sale.taxXof));
  const refunded = sum(refunds.map((refund) => refund.amountXof));
  const subtotal = sum(sales.map((sale) => sale.subtotalXof));
  const latestStock = stock[stock.length - 1];
  return {
    tenantId: filter.tenantId,
    siteId: filter.siteId,
    from: filter.from,
    to: filter.to,
    currency: 'XOF',
    revenueXof: revenue,
    netRevenueXof: revenue - refunded,
    orders: sales.length,
    averageTicketXof: sales.length > 0 ? Math.round(revenue / sales.length) : 0,
    taxXof: tax,
    subtotalXof: subtotal,
    discountXof: sum(sales.map((sale) => sale.discountXof)),
    refundsXof: refunded,
    refundCount: refunds.length,
    failedPayments: failures.length,
    cogsXof,
    grossMarginXof: cogsXof === null ? null : subtotal - cogsXof,
    marginRatePct:
      cogsXof === null || subtotal === 0 ? null : round(((subtotal - cogsXof) / subtotal) * 100, 1),
    paymentMix: paymentMix(sales, refunds),
    channelMix: channelMix(sales),
    topProducts: productRanking(sales).slice(0, 8),
    peakHours: peakHours(sales),
    occupancy: occupancySummary(occupancy),
    reservations: {
      count: reservations.length,
      covers: sum(reservations.map((entry) => entry.partySize)),
      cancelled: reservations.filter((entry) => entry.status === 'annulee').length,
    },
    payroll: { runs: payroll.length, totalXof: sum(payroll.map((entry) => entry.totalXof)) },
    reviews: reviewSummary(reviews),
    stock: {
      latestValueXof: latestStock?.stockValueXof ?? 0,
      wasteXof: sum(stock.map((entry) => entry.wasteXof)),
      lowStockCount: latestStock?.lowStockCount ?? 0,
    },
    generatedAt: nowIso(),
  };
}

export function seedReportingDemo(store: ReportingStore): void {
  if (store.sales.size > 0) return;
  const tenantId = 'tnt_sahelgrill';
  const plateau: Site = {
    id: 'ste_plateau',
    tenantId,
    name: 'Sahel Grill — Plateau',
    isDefault: true,
  };
  const lagune: Site = {
    id: 'ste_lagune',
    tenantId,
    name: 'Sahel Grill — Lagune',
    isDefault: false,
  };
  for (const site of [plateau, lagune]) store.sites.set(site.id, site);

  let seed = 20261125;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  const menu = [
    {
      productId: 'prd_sg_poulet',
      productName: 'Poulet braisé',
      priceXof: 4500,
      station: 'cuisine',
    },
    {
      productId: 'prd_sg_brochettes',
      productName: 'Brochettes de bœuf',
      priceXof: 3000,
      station: 'cuisine',
    },
    {
      productId: 'prd_sg_attieke',
      productName: 'Attiéké garni',
      priceXof: 3500,
      station: 'cuisine',
    },
    { productId: 'prd_sg_bissap', productName: 'Bissap maison', priceXof: 2000, station: 'bar' },
    { productId: 'prd_sg_biere', productName: 'Bière locale', priceXof: 1500, station: 'bar' },
    {
      productId: 'prd_sg_salade',
      productName: 'Salade de mangue',
      priceXof: 2000,
      station: 'cuisine',
    },
  ];
  const paymentMethods = ['tmoney', 'moov', 'especes', 'carte'];
  const taxRate = 0.18;
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  for (let dayOffset = 44; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(today.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    const date = day.toISOString().slice(0, 10);
    const weekend = [0, 5, 6].includes(day.getUTCDay());
    const orderCount = between(4, 8) + (weekend ? 2 : 0);
    let covers = 0;
    for (let index = 0; index < orderCount; index += 1) {
      const site = random() < 0.2 ? lagune : plateau;
      const channel = random() < 0.6 ? 'dine_in' : random() < 0.7 ? 'delivery' : 'takeaway';
      const lines = Array.from({ length: between(1, 3) }, () => {
        const product = pick(menu);
        const quantity = between(1, 3);
        return {
          productId: product.productId,
          productName: product.productName,
          station: product.station,
          quantity,
          lineTotalXof: product.priceXof * quantity,
        };
      });
      const subtotal = sum(lines.map((line) => line.lineTotalXof));
      const discount = random() < 0.12 ? Math.round(subtotal * 0.1) : 0;
      const taxable = subtotal - discount;
      const tax = Math.round(taxable * taxRate);
      const guests = channel === 'dine_in' ? between(2, 6) : 0;
      covers += guests;
      const paidAt = new Date(day);
      paidAt.setUTCHours(between(11, 22), between(0, 59), 0, 0);
      const orderNumber = `CMD-2026-${String(9000 + dayOffset * 10 + index).padStart(6, '0')}`;
      const fact: SalesFact = {
        id: newId('sf'),
        tenantId,
        siteId: site.id,
        orderId: `ord_seed_${dayOffset}_${index}`,
        number: orderNumber,
        channel,
        tableCode: channel === 'dine_in' ? `T${between(1, 12)}` : null,
        guests: guests || null,
        paidAt: paidAt.toISOString(),
        subtotalXof: subtotal,
        taxXof: tax,
        totalXof: taxable + tax,
        discountXof: discount,
        method: pick(paymentMethods),
        lines,
      };
      store.sales.set(fact.id, fact);

      if (index === 2 && dayOffset % 9 === 0) {
        const refund: RefundFact = {
          id: newId('rf'),
          tenantId,
          siteId: site.id,
          refundId: `rfd_seed_${dayOffset}`,
          orderId: fact.orderId,
          amountXof: Math.min(fact.totalXof, 3000),
          reason: pick(['Plat renvoyé', 'Erreur d’encaissement', 'Geste commercial']),
          at: new Date(paidAt.getTime() + 45 * 60 * 1000).toISOString(),
        };
        store.refunds.set(refund.id, refund);
      }
      if (index === 4 && dayOffset % 7 === 0) {
        const failure: PaymentFailureFact = {
          id: newId('pf'),
          tenantId,
          siteId: site.id,
          transactionId: `txn_seed_${dayOffset}`,
          orderId: fact.orderId,
          amountXof: fact.totalXof,
          reason: pick(['solde insuffisant', 'délai fournisseur', 'annulé par le client']),
          at: new Date(paidAt.getTime() - 10 * 60 * 1000).toISOString(),
        };
        store.failures.set(failure.id, failure);
      }
    }
    for (const site of [plateau, lagune]) {
      const fact: OccupancyFact = {
        id: newId('oc'),
        tenantId,
        siteId: site.id,
        date,
        seatsCapacity: site.id === plateau.id ? 48 : 30,
        covers: site.id === plateau.id ? covers : Math.max(0, Math.round(covers * 0.4)),
        reservations: between(2, 9),
        noShows: between(0, 2),
      };
      store.occupancy.set(fact.id, fact);
    }
    for (let reservationIndex = 0; reservationIndex < 2; reservationIndex += 1) {
      const reservation: ReservationFact = {
        id: newId('rsv'),
        tenantId,
        siteId: random() < 0.2 ? lagune.id : plateau.id,
        reservationId: `res_seed_${date}_${reservationIndex}`,
        date,
        partySize: between(2, 6),
        status: random() < 0.08 ? 'annulee' : 'honoree',
        at: new Date(day.getTime() + 9 * 60 * 60 * 1000).toISOString(),
      };
      store.reservations.set(reservation.id, reservation);
    }
    if (dayOffset % 7 === 0) {
      const fact: StockFact = {
        id: newId('stk'),
        tenantId,
        siteId: plateau.id,
        at: new Date(day.getTime() + 18 * 60 * 60 * 1000).toISOString(),
        stockValueXof: between(720000, 940000),
        wasteXof: between(8000, 42000),
        lowStockCount: between(1, 3),
      };
      store.stock.set(fact.id, fact);
    }
  }

  const payrollSeeds = [
    { period: '2026-09', headcount: 8, totalXof: 1250000 },
    { period: '2026-10', headcount: 8, totalXof: 1320000 },
  ];
  for (const entry of payrollSeeds) {
    const fact: PayrollFact = {
      id: newId('pay'),
      tenantId,
      siteId: plateau.id,
      runId: `run_${entry.period}`,
      period: entry.period,
      headcount: entry.headcount,
      totalXof: entry.totalXof,
      paidAt: new Date(`${entry.period}-28T17:00:00.000Z`).toISOString(),
    };
    store.payroll.set(fact.id, fact);
  }

  const reviewSeeds: Array<[number, ReviewStatusFact, number]> = [
    [5, 'approved', 2],
    [4, 'approved', 4],
    [5, 'approved', 6],
    [3, 'approved', 9],
    [5, 'approved', 12],
    [4, 'approved', 15],
    [5, 'pending', 1],
    [4, 'approved', 20],
  ];
  for (const [rating, status, daysAgo] of reviewSeeds) {
    const fact: ReviewFact = {
      id: newId('rvt'),
      tenantId,
      siteId: plateau.id,
      reviewId: `rev_seed_${rating}_${daysAgo}`,
      rating,
      status,
      at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    };
    store.reviews.set(fact.id, fact);
  }

  store.recordAudit({
    tenantId: null,
    actorId: 'usr_demo_seed',
    action: 'reporting.seeded',
    targetType: 'reporting',
    targetId: 'demo',
    meta: {
      sales: store.sales.size,
      refunds: store.refunds.size,
      failures: store.failures.size,
      occupancy: store.occupancy.size,
      payroll: store.payroll.size,
      reviews: store.reviews.size,
      sites: store.sites.size,
    },
  });
}
