import {
  HttpError,
  newId,
  optionalString,
  requireTenantPermission,
  verifyAuditChain,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import { reportPdf } from './pdf.js';
import { buildXlsx, type Sheet } from './xlsx.js';
import {
  dailySeries,
  dashboardView,
  dateOnly,
  defaultSiteOf,
  monthlySeries,
  occupancyIn,
  occupancySummary,
  payrollIn,
  peakHours,
  productRanking,
  reviewsIn,
  reviewSummary,
  salesIn,
  sitesOf,
  stockIn,
  sum,
  taxSummary,
  refundsIn,
  type DateFilter,
  type ReportingStore,
  type SalesFact,
} from './store.js';

export interface OrderSnapshot {
  order: {
    id: string;
    number: string;
    tenantId: string;
    status: string;
    channel: string;
    tableCode: string | null;
    guests: number | null;
    paymentStatus: string;
    subtotalXof: number;
    taxXof: number;
    taxRate: number;
    totalXof: number;
    invoiceNumber: string | null;
    createdAt: string;
    paidAt: string | null;
    lines: Array<{
      id: string;
      productId: string;
      productName: string;
      variantName: string | null;
      station: string;
      quantity: number;
      unitPriceXof: number;
      lineTotalXof: number;
    }>;
  };
}

export type OrderFactReader = (tenantId: string, orderId: string) => Promise<OrderSnapshot | null>;

export interface ReportingAppOptions {
  store: ReportingStore;
  readOrder: OrderFactReader;
  cogs: (tenantId: string, from: string, to: string) => Promise<number>;
  capacity: (tenantId: string) => Promise<{ seats: number; tables: number } | null>;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
const REPORT_NAMES = ['dashboard', 'sales', 'products', 'occupancy', 'taxes', 'payroll', 'stock', 'reviews'] as const;
type ReportName = (typeof REPORT_NAMES)[number];

function nowIso(): string {
  return new Date().toISOString();
}

function formatXof(value: number): string {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F CFA`;
}

function formatNumber(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function today(): string {
  return dateOnly(new Date().toISOString());
}

function shiftDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateParam(value: string | null, fallback: string, field: string): string {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw HttpError.unprocessable('validation_error', `Date ${field} attendue au format AAAA-MM-JJ.`, { field });
  }
  return value;
}

function filterOf(ctx: RequestContext, store: ReportingStore): DateFilter {
  const tenantId = ctx.params.tenantId ?? '';
  const from = dateParam(ctx.query.get('from'), shiftDays(29), 'from');
  const to = dateParam(ctx.query.get('to'), today(), 'to');
  if (from > to) throw HttpError.unprocessable('validation_error', 'La période est inversée.', { field: 'from' });
  const siteId = ctx.query.get('siteId');
  if (siteId && !sitesOf(store, tenantId).some((site) => site.id === siteId)) {
    throw HttpError.unprocessable('site_unknown', 'Site inconnu pour cet établissement.', { field: 'siteId' });
  }
  return { tenantId, siteId: siteId || null, from, to };
}

async function safeCogs(options: ReportingAppOptions, filter: DateFilter): Promise<number | null> {
  try {
    const value = await options.cogs(filter.tenantId, filter.from, filter.to);
    return Number.isFinite(value) ? Math.round(value) : null;
  } catch {
    return null;
  }
}

interface TableData {
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  kpis: Array<{ label: string; value: string }>;
  note?: string;
}

function salesRows(sales: SalesFact[], refunds: ReturnType<typeof refundsIn>, group: 'day' | 'month'): Array<Array<string | number>> {
  if (group === 'month') {
    return monthlySeries(sales, refunds).map((bucket) => [
      bucket.month,
      bucket.orders,
      bucket.revenueXof,
      bucket.taxXof,
      bucket.refundsXof,
      bucket.revenueXof - bucket.refundsXof,
      bucket.averageTicketXof,
    ]);
  }
  const from = sales.length > 0 ? dateOnly(sales[0].paidAt) : today();
  const to = sales.length > 0 ? dateOnly(sales[sales.length - 1].paidAt) : from;
  return dailySeries(sales, refunds, from, to).map((point) => [
    point.date,
    point.orders,
    point.revenueXof,
    point.taxXof,
    point.refundsXof,
    point.revenueXof - point.refundsXof,
    point.averageTicketXof,
  ]);
}

function salesColumns(group: 'day' | 'month'): string[] {
  return [group === 'month' ? 'Mois' : 'Date', 'Commandes', 'CA (XOF)', 'TVA (XOF)', 'Remboursements (XOF)', 'Net (XOF)', 'Panier moyen (XOF)'];
}

async function tableData(
  options: ReportingAppOptions,
  filter: DateFilter,
  report: ReportName,
): Promise<TableData> {
  const { store } = options;
  const periodLabel = `${filter.from} → ${filter.to}`;
  if (report === 'dashboard') {
    const cogs = await safeCogs(options, filter);
    const view = dashboardView(store, filter, cogs);
    return {
      title: 'Tableau de bord',
      subtitle: `Période ${periodLabel}${filter.siteId ? ` · site ${filter.siteId}` : ''}`,
      columns: ['Indicateur', 'Valeur'],
      rows: [
        ['Chiffre d’affaires', view.revenueXof],
        ['CA net', view.netRevenueXof],
        ['Commandes payées', view.orders],
        ['Panier moyen', view.averageTicketXof],
        ['TVA collectée', view.taxXof],
        ['Remboursements', view.refundsXof],
        ['Coût des marchandises', view.cogsXof ?? 0],
        ['Marge brute', view.grossMarginXof ?? 0],
        ['Taux de marge (%)', view.marginRatePct ?? 0],
        ['Taux d’occupation (%)', view.occupancy.ratePct],
        ['Couverts', view.occupancy.covers],
        ['Note moyenne clients', view.reviews.average],
        ['Masse salariale versée', view.payroll.totalXof],
        ['Valeur du stock', view.stock.latestValueXof],
      ],
      kpis: [
        { label: 'Chiffre d’affaires', value: formatXof(view.revenueXof) },
        { label: 'Panier moyen', value: formatXof(view.averageTicketXof) },
        { label: 'Commandes', value: formatNumber(view.orders) },
        { label: 'Taux d’occupation', value: `${view.occupancy.ratePct} %` },
        { label: 'Marge brute', value: view.grossMarginXof === null ? 'n/d' : formatXof(view.grossMarginXof) },
        { label: 'Note clients', value: `${view.reviews.average}/5` },
      ],
    };
  }
  if (report === 'sales') {
    const sales = salesIn(store, filter);
    const refunds = refundsIn(store, filter);
    const revenue = sum(sales.map((sale) => sale.totalXof));
    return {
      title: 'Rapport des ventes',
      subtitle: `Période ${periodLabel}`,
      columns: salesColumns('day'),
      rows: salesRows(sales, refunds, 'day'),
      kpis: [
        { label: 'CA', value: formatXof(revenue) },
        { label: 'Commandes', value: formatNumber(sales.length) },
        { label: 'Panier moyen', value: formatXof(sales.length > 0 ? revenue / sales.length : 0) },
      ],
    };
  }
  if (report === 'products') {
    const sales = salesIn(store, filter);
    const ranking = productRanking(sales);
    return {
      title: 'Produits les plus vendus',
      subtitle: `Période ${periodLabel}`,
      columns: ['Produit', 'Poste', 'Quantité', 'CA (XOF)', 'Part (%)'],
      rows: ranking.map((entry) => [entry.productName, entry.station, entry.quantity, entry.revenueXof, entry.sharePct]),
      kpis: [
        { label: 'Références vendues', value: formatNumber(ranking.length) },
        { label: 'Meilleure vente', value: ranking[0]?.productName ?? '—' },
      ],
    };
  }
  if (report === 'occupancy') {
    const facts = occupancyIn(store, filter);
    const summary = occupancySummary(facts);
    return {
      title: 'Taux d’occupation',
      subtitle: `Période ${periodLabel}`,
      columns: ['Date', 'Site', 'Couverts', 'Places', 'Taux (%)', 'Réservations', 'No-shows'],
      rows: facts.map((fact) => [
        fact.date,
        sitesOf(store, filter.tenantId).find((site) => site.id === fact.siteId)?.name ?? fact.siteId,
        fact.covers,
        fact.seatsCapacity,
        fact.seatsCapacity > 0 ? Math.round((fact.covers / fact.seatsCapacity) * 1000) / 10 : 0,
        fact.reservations,
        fact.noShows,
      ]),
      kpis: [
        { label: 'Taux moyen', value: `${summary.ratePct} %` },
        { label: 'Couverts', value: formatNumber(summary.covers) },
        { label: 'No-shows', value: formatNumber(summary.noShows) },
      ],
    };
  }
  if (report === 'taxes') {
    const sales = salesIn(store, filter);
    const rows = taxSummary(sales);
    return {
      title: 'Déclaration TVA',
      subtitle: `Période ${periodLabel}`,
      columns: ['Mois', 'Base imposable (XOF)', 'TVA collectée (XOF)'],
      rows: rows.map((row) => [row.month, row.taxableBaseXof, row.taxXof]),
      kpis: [
        { label: 'TVA à déclarer', value: formatXof(sum(rows.map((row) => row.taxXof))) },
        { label: 'Base imposable', value: formatXof(sum(rows.map((row) => row.taxableBaseXof))) },
      ],
      note: 'Taux de TVA appliqué : 18 % (Togo). Document indicatif, à rapprocher de la liasse fiscale.',
    };
  }
  if (report === 'payroll') {
    const facts = payrollIn(store, filter);
    return {
      title: 'Masse salariale',
      subtitle: `Période ${periodLabel}`,
      columns: ['Période', 'Effectif', 'Total versé (XOF)', 'Référence'],
      rows: facts.map((fact) => [fact.period, fact.headcount, fact.totalXof, fact.runId]),
      kpis: [
        { label: 'Total versé', value: formatXof(sum(facts.map((fact) => fact.totalXof))) },
        { label: 'Bulletins', value: formatNumber(sum(facts.map((fact) => fact.headcount))) },
      ],
    };
  }
  if (report === 'stock') {
    const facts = stockIn(store, filter);
    const latest = facts[facts.length - 1];
    return {
      title: 'Valorisation du stock',
      subtitle: `Période ${periodLabel}`,
      columns: ['Date', 'Valeur du stock (XOF)', 'Pertes (XOF)', 'Articles sous seuil'],
      rows: facts.map((fact) => [dateOnly(fact.at), fact.stockValueXof, fact.wasteXof, fact.lowStockCount]),
      kpis: [
        { label: 'Dernière valorisation', value: formatXof(latest?.stockValueXof ?? 0) },
        { label: 'Pertes cumulées', value: formatXof(sum(facts.map((fact) => fact.wasteXof))) },
        { label: 'Articles en alerte', value: formatNumber(latest?.lowStockCount ?? 0) },
      ],
    };
  }
  const reviews = reviewsIn(store, filter);
  const summary = reviewSummary(reviews);
  return {
    title: 'Avis clients',
    subtitle: `Période ${periodLabel}`,
    columns: ['Date', 'Note', 'Statut'],
    rows: reviews.map((review) => [dateOnly(review.at), review.rating, review.status]),
    kpis: [
      { label: 'Note moyenne', value: `${summary.average}/5` },
      { label: 'Avis publiés', value: formatNumber(summary.count) },
      { label: 'En attente', value: formatNumber(summary.pending) },
    ],
  };
}

function csvValue(value: string | number): string {
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(columns: string[], rows: Array<Array<string | number>>): string {
  const lines = [columns, ...rows].map((row) => row.map(csvValue).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function handleReportingEvent(
  options: ReportingAppOptions,
  tenantId: string,
  event: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  const { store } = options;
  const payload = event.payload;
  const site = defaultSiteOf(store, tenantId);
  const siteId = typeof payload.siteId === 'string' ? payload.siteId : site?.id ?? 'site_principal';
  const keyOf = (suffix: string) => `${tenantId}:${event.type}:${suffix}`;
  if (!tenantId) return;

  switch (event.type) {
    case 'OrderPaid': {
      const orderId = String(payload.orderId ?? '');
      if (!orderId || store.handledEvents.has(keyOf(orderId))) return;
      store.handledEvents.add(keyOf(orderId));
      const snapshot = await options.readOrder(tenantId, orderId);
      const paidAt = snapshot?.order.paidAt ?? String(payload.at ?? nowIso());
      const total = snapshot?.order.totalXof ?? Number(payload.totalXof ?? payload.amountXof ?? 0);
      const tax = snapshot?.order.taxXof ?? Math.round(total - total / 1.18);
      const lines = (snapshot?.order.lines ?? []).map((line) => ({
        productId: line.productId,
        productName: line.productName,
        station: line.station,
        quantity: line.quantity,
        lineTotalXof: line.lineTotalXof,
      }));
      const fact = {
        id: newId('sf'),
        tenantId,
        siteId,
        orderId,
        number: snapshot?.order.number ?? String(payload.number ?? orderId),
        channel: snapshot?.order.channel ?? String(payload.channel ?? 'dine_in'),
        tableCode: snapshot?.order.tableCode ?? null,
        guests: snapshot?.order.guests ?? null,
        paidAt,
        subtotalXof: snapshot?.order.subtotalXof ?? Math.max(0, total - tax),
        taxXof: tax,
        totalXof: total,
        discountXof: 0,
        method: String(payload.method ?? 'especes'),
        lines,
      };
      store.sales.set(fact.id, fact);
      return;
    }
    case 'RefundIssued': {
      const refundId = String(payload.refundId ?? '');
      if (!refundId || store.handledEvents.has(keyOf(refundId))) return;
      store.handledEvents.add(keyOf(refundId));
      const fact = {
        id: newId('rf'),
        tenantId,
        siteId,
        refundId,
        orderId: String(payload.orderId ?? ''),
        amountXof: Number(payload.amountXof ?? 0),
        reason: optionalString(payload, 'reason', { max: 160 }) ?? null,
        at: String(payload.at ?? nowIso()),
      };
      store.refunds.set(fact.id, fact);
      return;
    }
    case 'PaymentFailed': {
      const transactionId = String(payload.transactionId ?? payload.paymentId ?? payload.orderId ?? '');
      if (!transactionId || store.handledEvents.has(keyOf(transactionId))) return;
      store.handledEvents.add(keyOf(transactionId));
      const fact = {
        id: newId('pf'),
        tenantId,
        siteId,
        transactionId,
        orderId: String(payload.orderId ?? ''),
        amountXof: Number(payload.amountXof ?? 0),
        reason: String(payload.reason ?? payload.code ?? 'refus'),
        at: String(payload.at ?? nowIso()),
      };
      store.failures.set(fact.id, fact);
      return;
    }
    case 'ReservationCreated': {
      const reservationId = String(payload.reservationId ?? '');
      if (!reservationId || store.handledEvents.has(keyOf(reservationId))) return;
      store.handledEvents.add(keyOf(reservationId));
      const fact = {
        id: newId('rsv'),
        tenantId,
        siteId,
        reservationId,
        date: String(payload.date ?? today()),
        partySize: Number(payload.partySize ?? 0),
        status: 'reservee' as const,
        at: String(payload.at ?? nowIso()),
      };
      store.reservations.set(fact.id, fact);
      return;
    }
    case 'PayrollPaid': {
      const runId = String(payload.runId ?? '');
      if (!runId || store.handledEvents.has(keyOf(runId))) return;
      store.handledEvents.add(keyOf(runId));
      const fact = {
        id: newId('pay'),
        tenantId,
        siteId,
        runId,
        period: String(payload.period ?? ''),
        headcount: Number(payload.headcount ?? 0),
        totalXof: Number(payload.totalXof ?? 0),
        paidAt: String(payload.at ?? nowIso()),
      };
      store.payroll.set(fact.id, fact);
      return;
    }
    case 'ReviewSubmitted':
    case 'ReviewModerated': {
      const reviewId = String(payload.reviewId ?? '');
      if (!reviewId) return;
      const status =
        event.type === 'ReviewModerated'
          ? payload.status === 'approved'
            ? 'approved'
            : payload.status === 'rejected'
              ? 'rejected'
              : 'pending'
          : 'pending';
      if (event.type === 'ReviewModerated' && status === 'rejected') {
        for (const [id, fact] of store.reviews) {
          if (fact.tenantId === tenantId && fact.reviewId === reviewId) store.reviews.delete(id);
        }
        return;
      }
      const existing = [...store.reviews.values()].find(
        (fact) => fact.tenantId === tenantId && fact.reviewId === reviewId,
      );
      const rating = Number(payload.rating ?? existing?.rating ?? 0);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
      if (existing) {
        existing.rating = rating;
        existing.status = status;
        existing.at = String(payload.at ?? existing.at);
        return;
      }
      const fact = {
        id: newId('rvt'),
        tenantId,
        siteId,
        reviewId,
        rating,
        status: status as 'pending' | 'approved' | 'rejected',
        at: String(payload.at ?? nowIso()),
      };
      store.reviews.set(fact.id, fact);
      return;
    }
    default:
      return;
  }
}

export function buildReportingApp(options: ReportingAppOptions): Route[] {
  const { store, publish } = options;

  const tenantOf = (ctx: RequestContext, permission: string) => {
    const tenantId = ctx.params.tenantId ?? '';
    const claims = requireTenantPermission(ctx.auth, tenantId, permission);
    return { tenantId, claims };
  };

  const report = async (ctx: RequestContext, name: ReportName) => {
    tenantOf(ctx, 'report:view');
    const filter = filterOf(ctx, store);
    return { filter, data: await tableData(options, filter, name) };
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/sites',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:view');
        return { body: { tenantId, items: sitesOf(store, tenantId) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/dashboard',
      handler: async (ctx) => {
        const { filter } = await report(ctx, 'dashboard');
        const cogs = await safeCogs(options, filter);
        return { body: { dashboard: dashboardView(store, filter, cogs), sites: sitesOf(store, filter.tenantId) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/timeseries',
      handler: async (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const granularity = ctx.query.get('granularity') === 'month' ? 'month' : 'day';
        const sales = salesIn(store, filter);
        const refunds = refundsIn(store, filter);
        if (granularity === 'month') {
          const points = monthlySeries(sales, refunds).map((bucket) => ({
            bucket: bucket.month,
            orders: bucket.orders,
            revenueXof: bucket.revenueXof,
            averageTicketXof: bucket.averageTicketXof,
            refundsXof: bucket.refundsXof,
          }));
          return { body: { granularity, points, generatedAt: nowIso() } };
        }
        const from = sales.length > 0 ? dateOnly(sales[0].paidAt) : filter.from;
        const to = sales.length > 0 ? dateOnly(sales[sales.length - 1].paidAt) : filter.to;
        const points = dailySeries(sales, refunds, from, to).map((point) => ({
          bucket: point.date,
          orders: point.orders,
          revenueXof: point.revenueXof,
          averageTicketXof: point.averageTicketXof,
          refundsXof: point.refundsXof,
        }));
        return { body: { granularity, points, generatedAt: nowIso() } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/sales',
      handler: async (ctx) => {
        const group = ctx.query.get('group') === 'month' ? 'month' : 'day';
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const sales = salesIn(store, filter);
        const refunds = refundsIn(store, filter);
        return {
          body: {
            group,
            columns: salesColumns(group),
            rows: salesRows(sales, refunds, group),
            totals: {
              orders: sales.length,
              revenueXof: sum(sales.map((sale) => sale.totalXof)),
              taxXof: sum(sales.map((sale) => sale.taxXof)),
              refundsXof: sum(refunds.map((refund) => refund.amountXof)),
            },
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/products',
      handler: async (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const limit = Math.min(50, Math.max(1, Number(ctx.query.get('limit') ?? 20) || 20));
        const ranking = productRanking(salesIn(store, filter)).slice(0, limit);
        return { body: { items: ranking, generatedAt: nowIso() } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/peak-hours',
      handler: (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const buckets = peakHours(salesIn(store, filter));
        const peak = [...buckets].sort((a, b) => b.orders - a.orders).slice(0, 3).filter((bucket) => bucket.orders > 0);
        return { body: { buckets, peak, generatedAt: nowIso() } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/occupancy',
      handler: async (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const facts = occupancyIn(store, filter);
        return {
          body: {
            summary: occupancySummary(facts),
            items: facts.map((fact) => ({
              ...fact,
              ratePct: fact.seatsCapacity > 0 ? Math.round((fact.covers / fact.seatsCapacity) * 1000) / 10 : 0,
            })),
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/occupancy/live',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:view');
        const live = await options.capacity(tenantId);
        if (!live) throw new HttpError(503, 'floor_unavailable', 'Plan de salle indisponible.');
        return {
          body: {
            tenantId,
            seats: live.seats,
            tables: live.tables,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/taxes',
      handler: async (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const rows = taxSummary(salesIn(store, filter));
        return {
          body: {
            ratePct: 18,
            rows,
            totals: { taxableBaseXof: sum(rows.map((row) => row.taxableBaseXof)), taxXof: sum(rows.map((row) => row.taxXof)) },
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/payroll',
      handler: (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const facts = payrollIn(store, filter);
        return {
          body: { items: facts, totals: { runs: facts.length, totalXof: sum(facts.map((fact) => fact.totalXof)) }, generatedAt: nowIso() },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/stock',
      handler: (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const facts = stockIn(store, filter);
        return {
          body: {
            items: facts,
            latest: facts[facts.length - 1] ?? null,
            totals: { wasteXof: sum(facts.map((fact) => fact.wasteXof)) },
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/reviews',
      handler: (ctx) => {
        tenantOf(ctx, 'report:view');
        const filter = filterOf(ctx, store);
        const facts = reviewsIn(store, filter);
        return {
          body: { summary: reviewSummary(facts), items: facts, generatedAt: nowIso() },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/export',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'report:export');
        const name = ctx.query.get('report') ?? 'dashboard';
        if (!REPORT_NAMES.includes(name as ReportName)) {
          throw HttpError.unprocessable('report_unknown', 'Rapport inconnu.', { field: 'report' });
        }
        const format = ctx.query.get('format') ?? 'csv';
        if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
          throw HttpError.unprocessable('format_unknown', 'Format attendu : csv, xlsx ou pdf.', { field: 'format' });
        }
        const filter = filterOf(ctx, store);
        const data = await tableData(options, filter, name as ReportName);
        const baseName = `resto-hub-${name}-${filter.from}-${filter.to}`;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'report.exported',
          targetType: 'report',
          targetId: name,
          meta: { format, from: filter.from, to: filter.to, siteId: filter.siteId, rows: data.rows.length },
        });
        await publish('ReportExported', tenantId, {
          tenantId,
          report: name,
          format,
          from: filter.from,
          to: filter.to,
          siteId: filter.siteId,
          actorId: claims.sub,
          at: nowIso(),
        });

        if (format === 'csv') {
          return {
            raw: {
              contentType: 'text/csv; charset=utf-8',
              data: Buffer.from(toCsv(data.columns, data.rows), 'utf8'),
              fileName: `${baseName}.csv`,
            },
          };
        }
        if (format === 'xlsx') {
          const sheets: Sheet[] = [
            {
              name: data.title,
              rows: [
                [data.title],
                [`Période ${filter.from} → ${filter.to}`],
                [],
                data.columns,
                ...data.rows,
              ],
            },
          ];
          return {
            raw: {
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              data: buildXlsx(sheets),
              fileName: `${baseName}.xlsx`,
            },
          };
        }
        const pdf = await reportPdf({
          title: data.title,
          subtitle: `Période ${filter.from} → ${filter.to}${filter.siteId ? ` · site ${filter.siteId}` : ''}`,
          tenantName: tenantId,
          periodLabel: `${filter.from} → ${filter.to}`,
          generatedAt: nowIso(),
          kpis: data.kpis,
          columns: data.columns,
          rows: data.rows.map((row) => row.map((cell) => (typeof cell === 'number' ? formatNumber(cell) : cell))),
          note: data.note,
        });
        return {
          raw: {
            contentType: 'application/pdf',
            data: Buffer.from(pdf),
            fileName: `${baseName}.pdf`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reports/audit',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:view');
        const items = store.audit.filter((entry) => entry.tenantId === tenantId || entry.tenantId === null).slice(-100).reverse();
        return { body: { items, integrity: verifyAuditChain(store.audit) } };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/reports/summary',
      service: true,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const filter: DateFilter = { tenantId, siteId: null, from: shiftDays(29), to: today() };
        const view = dashboardView(store, filter, null);
        return {
          body: {
            tenantId,
            from: filter.from,
            to: filter.to,
            revenueXof: view.revenueXof,
            orders: view.orders,
            averageTicketXof: view.averageTicketXof,
            refundsXof: view.refundsXof,
            occupancyRatePct: view.occupancy.ratePct,
            reviewAverage: view.reviews.average,
            sites: sitesOf(store, tenantId).length,
            generatedAt: nowIso(),
          },
        };
      },
    },
  ];
}
