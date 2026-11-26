import {
  HttpError,
  asObject,
  hasTenantPermission,
  optionalString,
  requireArray,
  requireEnum,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STATIONS,
  STATUS_TRANSITIONS,
  createTickets,
  newOrderId,
  nextNumber,
  taxBreakdown,
  ticketsForOrder,
  type CashSession,
  type Order,
  type OrderChannel,
  type OrderCustomer,
  type OrderLine,
  type OrderStore,
  type OrderPayment,
  type PaymentMethod,
  type Station,
} from './store.js';
import { buildReceiptPdf } from './receipt.js';

export interface OrderAppOptions {
  store: OrderStore;
  vatRate: number;
  timeZone: string;
  appPublicUrl: string;
  deps: {
    catalog: Pick<ServiceClient, 'get'>;
    floor: Pick<ServiceClient, 'get' | 'post'>;
    tenant: Pick<ServiceClient, 'get'>;
  };
  publish: (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}

interface PricingProduct {
  id: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  station: Station;
  priceXof: number;
  available: boolean;
  variants: Array<{ id: string; name: string; priceXof: number }>;
  options: Array<{
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    choices: Array<{ id: string; name: string; priceDeltaXof: number }>;
  }>;
}

interface LineInput {
  productId: string;
  quantity: number;
  variantId?: string;
  optionChoiceIds: string[];
  notes?: string;
}

interface TableRef {
  id: string;
  code: string;
  status: string;
  orderId?: string | null;
  mergedIntoCode?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  recue: 'Reçue',
  en_preparation: 'En préparation',
  prete: 'Prête',
  servie: 'Servie',
  annulee: 'Annulée',
};

function isoNow(): string {
  return new Date().toISOString();
}

function requireInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = source[field];
  const min = opts.min ?? 0;
  const max = opts.max ?? 1_000_000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être un entier entre ${min} et ${max}.`,
      {
        field,
      },
    );
  }
  return value;
}

function optionalInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  return requireInt(source, field, opts);
}

function tenantOf(
  ctx: RequestContext,
  permission: string,
): { tenantId: string; claims: AuthClaims } {
  const tenantId = ctx.params.tenantId ?? '';
  const claims = requireTenantPermission(ctx.auth, tenantId, permission);
  return { tenantId, claims };
}

function canAny(claims: AuthClaims, tenantId: string, permissions: string[]): boolean {
  return permissions.some((permission) => hasTenantPermission(claims, tenantId, permission));
}

function requireOrder(store: OrderStore, tenantId: string, id: string): Order {
  const order = store.orders.get(id);
  if (!order || order.tenantId !== tenantId) throw HttpError.notFound('Commande introuvable.');
  return order;
}

function paidXof(order: Order): number {
  return order.payments.reduce((sum, payment) => sum + payment.amountXof, 0);
}

function recomputeTotals(order: Order): void {
  const subtotal = order.lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
  order.subtotalXof = subtotal;
  let discountAmount = 0;
  if (order.discount) {
    discountAmount =
      order.discount.type === 'percent'
        ? Math.round((subtotal * order.discount.value) / 100)
        : Math.min(order.discount.value, subtotal);
    order.discount.amountXof = discountAmount;
  }
  order.totalXof = Math.max(0, subtotal - discountAmount + order.deliveryFeeXof);
  const tax = taxBreakdown(order.totalXof, order.taxRate);
  order.netXof = tax.netXof;
  order.taxXof = tax.taxXof;
}

function timeline(order: Order) {
  return [
    { status: 'recue', at: order.createdAt },
    order.preparingAt ? { status: 'en_preparation', at: order.preparingAt } : null,
    order.readyAt ? { status: 'prete', at: order.readyAt } : null,
    order.servedAt ? { status: 'servie', at: order.servedAt } : null,
    order.canceledAt ? { status: 'annulee', at: order.canceledAt } : null,
  ].filter((entry): entry is { status: string; at: string } => Boolean(entry));
}

function serializeOrder(store: OrderStore, order: Order, options: { includeToken?: boolean } = {}) {
  return {
    id: order.id,
    number: order.number,
    channel: order.channel,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status] ?? order.status,
    source: order.source,
    tableId: order.tableId,
    tableCode: order.tableCode,
    customer: order.customer,
    guests: order.guests,
    scheduledFor: order.scheduledFor,
    lines: order.lines,
    subtotalXof: order.subtotalXof,
    discount: order.discount,
    deliveryFeeXof: order.deliveryFeeXof,
    totalXof: order.totalXof,
    netXof: order.netXof,
    taxXof: order.taxXof,
    taxRate: order.taxRate,
    paidXof: paidXof(order),
    remainingXof: Math.max(0, order.totalXof - paidXof(order)),
    paymentStatus: order.paymentStatus,
    payments: order.payments,
    invoiceNumber: order.invoiceNumber,
    receiptNumber: order.receiptNumber,
    receiptIssuedAt: order.receiptIssuedAt,
    cancel: order.cancel,
    publicToken: options.includeToken ? order.publicToken : undefined,
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    servedAt: order.servedAt,
    canceledAt: order.canceledAt,
    timeline: timeline(order),
    tickets: ticketsForOrder(store, order.tenantId, order.id).map((ticket) => ({
      id: ticket.id,
      station: ticket.station,
      status: ticket.status,
      lineIds: ticket.lineIds,
    })),
  };
}

function publicView(store: OrderStore, order: Order) {
  return {
    id: order.id,
    number: order.number,
    channel: order.channel,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status] ?? order.status,
    tableCode: order.tableCode,
    lines: order.lines.map((line) => ({
      name: line.productName,
      variantName: line.variantName,
      quantity: line.quantity,
      lineTotalXof: line.lineTotalXof,
    })),
    totalXof: order.totalXof,
    paidXof: paidXof(order),
    paymentStatus: order.paymentStatus,
    scheduledFor: order.scheduledFor,
    createdAt: order.createdAt,
    timeline: timeline(order),
    tickets: ticketsForOrder(store, order.tenantId, order.id).map((ticket) => ({
      station: ticket.station,
      status: ticket.status,
    })),
  };
}

function listSummary(orders: Order[]) {
  const byStatus: Record<string, number> = {
    recue: 0,
    en_preparation: 0,
    prete: 0,
    servie: 0,
    annulee: 0,
  };
  let unpaidXof = 0;
  let paidTodayXof = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const order of orders) {
    byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
    if (order.status !== 'annulee' && order.paymentStatus !== 'payee')
      unpaidXof += order.totalXof - paidXof(order);
    if (order.paymentStatus === 'payee' && (order.receiptIssuedAt ?? '').slice(0, 10) === today)
      paidTodayXof += order.totalXof;
  }
  return {
    total: orders.length,
    byStatus,
    unpaidXof,
    paidTodayXof,
    open: orders.filter((order) =>
      ['recue', 'en_preparation', 'prete', 'servie'].includes(order.status),
    ).length,
  };
}

function parseItems(body: Record<string, unknown>): LineInput[] {
  const raw = requireArray(body, 'items', 60);
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw HttpError.unprocessable('validation_error', `Article ${index + 1} invalide.`, {
        index,
      });
    }
    const item = entry as Record<string, unknown>;
    const productId = requireString(item, 'productId', { max: 64 });
    const quantity = requireInt(item, 'quantity', { min: 1, max: 50 });
    const variantId = optionalString(item, 'variantId', { max: 64 });
    const notes = optionalString(item, 'notes', { max: 140 });
    let optionChoiceIds: string[] = [];
    if (item.optionChoiceIds !== undefined) {
      if (
        !Array.isArray(item.optionChoiceIds) ||
        item.optionChoiceIds.some((id) => typeof id !== 'string')
      ) {
        throw HttpError.unprocessable(
          'validation_error',
          `Options invalides pour l’article ${index + 1}.`,
          { index },
        );
      }
      optionChoiceIds = [...new Set(item.optionChoiceIds as string[])];
      if (optionChoiceIds.length > 30) {
        throw HttpError.unprocessable('validation_error', 'Trop d’options sélectionnées.', {
          field: 'optionChoiceIds',
        });
      }
    }
    return { productId, quantity, variantId, optionChoiceIds, notes };
  });
}

function priceLines(items: LineInput[], pricing: Map<string, PricingProduct>): OrderLine[] {
  return items.map((item) => {
    const product = pricing.get(item.productId);
    if (!product) {
      throw HttpError.unprocessable(
        'unknown_product',
        'Un article du panier n’existe plus ou appartient à un autre établissement.',
        {
          productId: item.productId,
        },
      );
    }
    if (!product.available) {
      throw HttpError.conflict(
        'product_unavailable',
        `« ${product.name} » est en rupture (86) et ne peut plus être commandé.`,
        {
          productId: product.id,
        },
      );
    }
    let base = product.priceXof;
    let variantName: string | undefined;
    if (item.variantId) {
      const variant = product.variants.find((entry) => entry.id === item.variantId);
      if (!variant) {
        throw HttpError.unprocessable(
          'unknown_variant',
          `Variante inconnue pour « ${product.name} ».`,
          {
            productId: product.id,
            variantId: item.variantId,
          },
        );
      }
      base = variant.priceXof;
      variantName = variant.name;
    }
    const allChoices = new Map(
      product.options.flatMap((group) => group.choices).map((choice) => [choice.id, choice]),
    );
    const unknownOptions = item.optionChoiceIds.filter((id) => !allChoices.has(id));
    if (unknownOptions.length > 0) {
      throw HttpError.unprocessable('unknown_option', `Option inconnue pour « ${product.name} ».`, {
        productId: product.id,
        optionChoiceIds: unknownOptions,
      });
    }
    const options: OrderLine['options'] = [];
    for (const group of product.options) {
      const chosen = group.choices.filter((choice) => item.optionChoiceIds.includes(choice.id));
      if (group.required && chosen.length < Math.max(1, group.minSelect)) {
        throw HttpError.unprocessable(
          'option_required',
          `Choisissez « ${group.name} » pour « ${product.name} ».`,
          {
            productId: product.id,
            group: group.name,
          },
        );
      }
      if (chosen.length > group.maxSelect) {
        throw HttpError.unprocessable('option_limit', `Trop de choix pour « ${group.name} ».`, {
          productId: product.id,
          group: group.name,
          max: group.maxSelect,
        });
      }
      for (const choice of chosen) {
        options.push({ id: choice.id, name: choice.name, priceXof: choice.priceDeltaXof });
      }
    }
    const unitPrice = base + options.reduce((sum, option) => sum + option.priceXof, 0);
    return {
      id: newOrderId('lin'),
      productId: product.id,
      productName: product.name,
      variantId: item.variantId,
      variantName,
      options,
      quantity: item.quantity,
      unitPriceXof: unitPrice,
      lineTotalXof: unitPrice * item.quantity,
      station: product.station,
      notes: item.notes,
    };
  });
}

function kdsPayload(store: OrderStore, tenantId: string, station: Station | 'all') {
  const now = Date.now();
  const active = [...store.orders.values()].filter(
    (order) =>
      order.tenantId === tenantId && ['recue', 'en_preparation', 'prete'].includes(order.status),
  );
  const tickets = [...store.tickets.values()]
    .filter((ticket) => {
      if (ticket.tenantId !== tenantId) return false;
      if (station !== 'all' && ticket.station !== station) return false;
      return active.some((order) => order.id === ticket.orderId);
    })
    .map((ticket) => {
      const order = store.orders.get(ticket.orderId)!;
      const uniqueLines = ticket.lineIds
        .map((id) => order.lines.find((line) => line.id === id))
        .filter((line): line is OrderLine => Boolean(line))
        .map((line) => ({
          name: line.productName,
          variantName: line.variantName,
          options: line.options.map((option) => option.name),
          quantity: line.quantity,
          notes: line.notes,
        }));
      const ageSeconds = Math.max(
        0,
        Math.round((now - new Date(order.createdAt).getTime()) / 1000),
      );
      return {
        id: ticket.id,
        orderId: order.id,
        orderNumber: order.number,
        channel: order.channel,
        tableCode: order.tableCode,
        orderStatus: order.status,
        station: ticket.station,
        status: ticket.status,
        createdAt: order.createdAt,
        ageSeconds,
        urgent: ageSeconds >= 600,
        critical: ageSeconds >= 900,
        scheduledFor: order.scheduledFor,
        lines: uniqueLines,
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    tenantId,
    station,
    live: true,
    generatedAt: isoNow(),
    counters: {
      nouvelle: tickets.filter((ticket) => ticket.status === 'nouvelle').length,
      en_preparation: tickets.filter((ticket) => ticket.status === 'en_preparation').length,
      prete: tickets.filter((ticket) => ticket.status === 'prete').length,
    },
    tickets,
  };
}

function currentSession(store: OrderStore, tenantId: string): CashSession | undefined {
  return [...store.sessions.values()].find(
    (session) => session.tenantId === tenantId && session.status === 'ouverte',
  );
}

function sessionReport(store: OrderStore, session: CashSession) {
  const payments = [...store.payments.values()].filter(
    (payment) => payment.sessionId === session.id,
  );
  const byMethod: Record<string, number> = { especes: 0, mobile_money: 0, carte: 0 };
  for (const payment of payments)
    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amountXof;
  const collected = payments.reduce((sum, payment) => sum + payment.amountXof, 0);
  return {
    ...session,
    payments: payments.length,
    byMethod,
    collectedXof: collected,
    liveExpectedXof: session.openingFloatXof + collected,
  };
}

function serializeSession(store: OrderStore, session: CashSession) {
  return sessionReport(store, session);
}

export function buildOrderApp(options: OrderAppOptions): Route[] {
  const { store, vatRate, appPublicUrl, deps, publish } = options;

  const pricingFor = async (tenantId: string): Promise<Map<string, PricingProduct>> => {
    let response: { products?: PricingProduct[] };
    try {
      response = await deps.catalog.get<{ products?: PricingProduct[] }>(
        `/internal/tenants/${tenantId}/catalog/pricing`,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        'catalog_unavailable',
        'Le catalogue est momentanément indisponible.',
      );
    }
    return new Map((response.products ?? []).map((product) => [product.id, product]));
  };

  const lookupTable = async (
    tenantId: string,
    code: string,
    token: string | null,
  ): Promise<TableRef> => {
    if (token !== null) {
      let response: { table?: TableRef };
      try {
        response = await deps.floor.post<{ table?: TableRef }>(
          `/internal/tenants/${tenantId}/floor/tables/${encodeURIComponent(code)}/verify`,
          { token },
        );
      } catch (error) {
        if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
          throw new HttpError(403, 'invalid_table_token', 'QR de place invalide ou révoqué.');
        }
        throw error;
      }
      if (!response.table) throw new HttpError(403, 'invalid_table_token', 'QR de place invalide.');
      return response.table;
    }
    let response: { table?: TableRef };
    try {
      response = await deps.floor.get<{ table?: TableRef }>(
        `/internal/tenants/${tenantId}/floor/tables/${encodeURIComponent(code)}`,
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw HttpError.unprocessable(
          'unknown_table',
          'Cette place n’existe pas dans le plan de salle.',
          { tableCode: code },
        );
      }
      throw error;
    }
    if (!response.table)
      throw HttpError.unprocessable('unknown_table', 'Place introuvable.', { tableCode: code });
    return response.table;
  };

  const attachTable = async (tenantId: string, tableCode: string, orderId: string) => {
    try {
      await deps.floor.post(
        `/internal/tenants/${tenantId}/floor/tables/${encodeURIComponent(tableCode)}/order`,
        {
          orderId,
        },
      );
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw error;
      throw new HttpError(
        503,
        'floor_unavailable',
        'Le plan de salle est momentanément indisponible.',
      );
    }
  };

  const releaseTable = async (tenantId: string, tableCode: string, orderId: string) => {
    try {
      await deps.floor.post(
        `/internal/tenants/${tenantId}/floor/tables/${encodeURIComponent(tableCode)}/release`,
        {
          orderId,
          to: 'libre',
        },
      );
    } catch {
      /* la libération de la place ne doit jamais bloquer l’annulation */
    }
  };

  const emitStatus = async (
    order: Order,
    from: string,
    actorId: string,
    extra: Record<string, unknown> = {},
  ) => {
    await publish('OrderStatusChanged', order.tenantId, {
      tenantId: order.tenantId,
      orderId: order.id,
      number: order.number,
      from,
      to: order.status,
      actorId,
      at: order.updatedAt,
      ...extra,
    });
  };

  const createOrder = async (input: {
    tenantId: string;
    actorId: string;
    source: 'client' | 'staff';
    body: Record<string, unknown>;
    tableToken: string | null;
  }) => {
    const { tenantId, actorId, source, body } = input;
    const channel = requireEnum(body, 'channel', ORDER_CHANNELS) as OrderChannel;
    const items = parseItems(body);

    const requestId = optionalString(body, 'clientRequestId', { max: 80 });
    if (requestId) {
      const existing = [...store.orders.values()].find(
        (order) => order.tenantId === tenantId && order.clientRequestId === requestId,
      );
      if (existing) return { order: existing, replayed: true };
    }

    let customer: OrderCustomer | undefined;
    if (body.customer !== undefined) {
      const raw = asObject(body.customer);
      customer = {
        name: requireString(raw, 'name', { min: 2, max: 80 }),
        phone: optionalString(raw, 'phone', { max: 24 }),
        address: optionalString(raw, 'address', { max: 200 }),
        note: optionalString(raw, 'note', { max: 200 }),
      };
    }
    if (source === 'client' && !customer) {
      throw HttpError.unprocessable(
        'customer_required',
        'Renseignez votre nom pour suivre la commande.',
        {
          field: 'customer.name',
        },
      );
    }
    if (source === 'client' && !customer?.phone) {
      throw HttpError.unprocessable(
        'customer_required',
        'Renseignez un numéro de téléphone pour être prévenu.',
        {
          field: 'customer.phone',
        },
      );
    }

    let scheduledFor: string | undefined;
    if (channel === 'precommande') {
      const raw = requireString(body, 'scheduledFor', { max: 40 });
      const date = new Date(raw);
      if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 5 * 60_000) {
        throw HttpError.unprocessable(
          'invalid_schedule',
          'La précommande doit être planifiée au moins 5 minutes à l’avance.',
          {
            field: 'scheduledFor',
          },
        );
      }
      scheduledFor = date.toISOString();
    }

    let deliveryFee = 0;
    if (channel === 'livraison') {
      if (!customer?.address) {
        throw HttpError.unprocessable('address_required', 'Une adresse de livraison est requise.', {
          field: 'customer.address',
        });
      }
      deliveryFee =
        source === 'staff'
          ? (optionalInt(body, 'deliveryFeeXof', { min: 0, max: 10_000 }) ?? 1_000)
          : 1_000;
    }

    let table: TableRef | undefined;
    const tableCode = optionalString(body, 'tableCode', { max: 40 });
    if (channel === 'sur_place') {
      if (!tableCode) {
        throw HttpError.unprocessable(
          'table_required',
          'Scannez le QR de la table ou choisissez une place.',
          {
            field: 'tableCode',
          },
        );
      }
      table = await lookupTable(tenantId, tableCode, source === 'client' ? input.tableToken : null);
      if (table.mergedIntoCode) {
        throw HttpError.conflict(
          'table_merged',
          `Cette place est fusionnée : utilisez ${table.mergedIntoCode}.`,
          {
            primaryTableCode: table.mergedIntoCode,
          },
        );
      }
      if (source === 'client' && table.orderId) {
        throw HttpError.conflict(
          'table_busy',
          'Cette table a déjà une commande en cours. Appelez un serveur.',
          {
            tableCode: table.code,
          },
        );
      }
    } else if (tableCode) {
      throw HttpError.unprocessable(
        'validation_error',
        'Le mode choisi ne doit pas référencer de table.',
        {
          field: 'tableCode',
        },
      );
    }

    const pricing = await pricingFor(tenantId);
    const lines = priceLines(items, pricing);
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
    const grossTotal = subtotal + deliveryFee;
    const tax = taxBreakdown(grossTotal, vatRate);

    const id = newOrderId('ord');
    if (channel === 'sur_place' && table) {
      await attachTable(tenantId, table.code, id);
    }

    const now = isoNow();
    const order: Order = {
      id,
      tenantId,
      number: nextNumber(store, tenantId, 'order'),
      channel,
      status: 'recue',
      source,
      createdBy: actorId,
      tableId: table?.id,
      tableCode: table?.code,
      customer,
      guests: optionalInt(body, 'guests', { min: 1, max: 40 }),
      scheduledFor,
      lines,
      subtotalXof: subtotal,
      deliveryFeeXof: deliveryFee,
      totalXof: grossTotal,
      netXof: tax.netXof,
      taxXof: tax.taxXof,
      taxRate: vatRate,
      payments: [],
      paymentStatus: 'impayee',
      clientRequestId: requestId,
      publicToken: newOrderId('trk'),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.orders.set(order.id, order);
    createTickets(store, order, actorId);
    store.recordAudit({
      tenantId,
      actorId,
      action: 'order.created',
      targetType: 'order',
      targetId: order.id,
      meta: {
        number: order.number,
        channel,
        source,
        tableCode: order.tableCode,
        totalXof: order.totalXof,
        lines: order.lines.length,
      },
    });
    await publish('OrderCreated', tenantId, {
      tenantId,
      orderId: order.id,
      number: order.number,
      channel: order.channel,
      tableCode: order.tableCode,
      status: order.status,
      totalXof: order.totalXof,
      source,
      at: now,
    });
    return { order, replayed: false };
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'order:view');
        const status = ctx.query.get('status');
        const channel = ctx.query.get('channel');
        const search = (ctx.query.get('q') ?? '').trim().toLowerCase();
        const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit') ?? 80) || 80));
        let orders = [...store.orders.values()].filter((order) => order.tenantId === tenantId);
        if (status && status !== 'all') {
          if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
            throw HttpError.unprocessable('validation_error', 'Statut de filtre invalide.', {
              field: 'status',
            });
          }
          orders = orders.filter((order) => order.status === status);
        }
        if (channel && channel !== 'all') {
          if (!(ORDER_CHANNELS as readonly string[]).includes(channel)) {
            throw HttpError.unprocessable('validation_error', 'Canal de filtre invalide.', {
              field: 'channel',
            });
          }
          orders = orders.filter((order) => order.channel === channel);
        }
        if (search) {
          orders = orders.filter(
            (order) =>
              order.number.toLowerCase().includes(search) ||
              (order.tableCode ?? '').toLowerCase().includes(search) ||
              (order.customer?.name ?? '').toLowerCase().includes(search),
          );
        }
        orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          body: {
            tenantId,
            generatedAt: isoNow(),
            summary: listSummary(
              [...store.orders.values()].filter((order) => order.tenantId === tenantId),
            ),
            items: orders.slice(0, limit).map((order) => serializeOrder(store, order)),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/orders',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'order:create');
        const body = asObject(ctx.body);
        const result = await createOrder({
          tenantId,
          actorId: claims.sub,
          source: 'staff',
          body,
          tableToken: null,
        });
        return {
          status: result.replayed ? 200 : 201,
          body: { order: serializeOrder(store, result.order), replayed: result.replayed },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders/export.csv',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:export');
        const from = ctx.query.get('from');
        const to = ctx.query.get('to');
        const fromTime = from ? new Date(from).getTime() : Date.now() - 24 * 3600_000;
        const toTime = to ? new Date(to).getTime() : Date.now() + 3600_000;
        if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
          throw HttpError.unprocessable('validation_error', 'Bornes de date invalides.', {
            field: 'from',
          });
        }
        const rows = [...store.orders.values()]
          .filter((order) => order.tenantId === tenantId)
          .filter((order) => {
            const at = new Date(order.createdAt).getTime();
            return at >= fromTime && at <= toTime;
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const header = [
          'numero',
          'date',
          'canal',
          'statut',
          'table',
          'client',
          'sous_total_xof',
          'remise_xof',
          'livraison_xof',
          'net_ht_xof',
          'tva_xof',
          'total_ttc_xof',
          'moyen_paiement',
          'facture',
          'annulation',
        ];
        const lines = rows.map((order) =>
          [
            order.number,
            order.createdAt,
            order.channel,
            order.status,
            order.tableCode ?? '',
            order.customer?.name ?? '',
            order.subtotalXof,
            order.discount?.amountXof ?? 0,
            order.deliveryFeeXof,
            order.netXof,
            order.taxXof,
            order.totalXof,
            order.payments[0]?.method ?? '',
            order.invoiceNumber ?? '',
            order.cancel?.reason ?? '',
          ]
            .map(escape)
            .join(';'),
        );
        const csv = `\uFEFF${header.join(';')}\n${lines.join('\n')}\n`;
        return {
          raw: {
            data: Buffer.from(csv, 'utf8'),
            contentType: 'text/csv; charset=utf-8',
            fileName: `commandes-${tenantId}.csv`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders/audit',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'audit:view');
        return {
          body: {
            entries: store.audit.filter((entry) => entry.tenantId === tenantId),
            integrity: verifyAuditChain(store.audit),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders/:id',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'order:view');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        return { body: { order: serializeOrder(store, order, { includeToken: true }) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders/:id/invoice',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'order:view');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        return {
          body: {
            invoice: order.invoiceNumber
              ? {
                  number: order.invoiceNumber,
                  receiptNumber: order.receiptNumber,
                  issuedAt: order.receiptIssuedAt,
                  totalXof: order.totalXof,
                  netXof: order.netXof,
                  taxXof: order.taxXof,
                  taxRate: order.taxRate,
                  paymentStatus: order.paymentStatus,
                  payments: order.payments,
                }
              : null,
            order: serializeOrder(store, order),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/orders/:id/receipt.pdf',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'order:view');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        let tenantName = 'Établissement';
        let tenantAddress: string | undefined;
        try {
          const summary = await deps.tenant.get<{ brandName?: string }>(
            `/internal/tenants/${tenantId}/summary`,
          );
          tenantName = summary.brandName ?? tenantName;
        } catch {
          tenantAddress = undefined;
        }
        const pdf = await buildReceiptPdf({
          order,
          tenantName,
          tenantAddress,
          printedAt: isoNow(),
        });
        return {
          raw: {
            data: Buffer.from(pdf),
            contentType: 'application/pdf',
            fileName: `ticket-${order.invoiceNumber ?? order.number}.pdf`,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/orders/:id/status',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'order:update');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const target = requireEnum(body, 'status', ORDER_STATUSES);
        if (target === 'annulee') {
          throw HttpError.unprocessable(
            'use_cancel_endpoint',
            'Utilisez l’annulation motivée dédiée.',
            {
              endpoint: 'POST /orders/:id/cancel',
            },
          );
        }
        if (target === order.status) {
          return { body: { order: serializeOrder(store, order), unchanged: true } };
        }
        const expectedVersion = optionalInt(body, 'expectedVersion', { min: 1 });
        if (expectedVersion !== undefined && expectedVersion !== order.version) {
          throw HttpError.conflict(
            'version_conflict',
            'La commande a été modifiée entre-temps. Rechargez-la.',
            {
              current: serializeOrder(store, order),
            },
          );
        }
        if (!STATUS_TRANSITIONS[order.status].includes(target)) {
          throw HttpError.conflict(
            'invalid_transition',
            `Passage « ${order.status} → ${target} » interdit.`,
            {
              from: order.status,
              to: target,
            },
          );
        }
        const from = order.status;
        const now = isoNow();
        order.status = target;
        order.version += 1;
        order.updatedAt = now;
        if (target === 'en_preparation') order.preparingAt = now;
        if (target === 'prete') {
          order.readyAt = now;
          for (const ticket of ticketsForOrder(store, tenantId, order.id)) {
            ticket.status = 'prete';
            ticket.updatedAt = now;
            ticket.updatedBy = claims.sub;
          }
        }
        if (target === 'servie') order.servedAt = now;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'order.status_changed',
          targetType: 'order',
          targetId: order.id,
          meta: { number: order.number, from, to: target },
        });
        await emitStatus(order, from, claims.sub);
        return { body: { order: serializeOrder(store, order) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/orders/:id/cancel',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'order:cancel');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const reason = requireString(body, 'reason', { min: 4, max: 200 });
        if (order.status === 'annulee') {
          throw HttpError.conflict('already_cancelled', 'Cette commande est déjà annulée.');
        }
        if (order.status === 'servie') {
          throw HttpError.conflict(
            'already_served',
            'Une commande servie ne peut plus être annulée : procédez à un remboursement.',
            {
              paid: order.paymentStatus === 'payee',
            },
          );
        }
        if (order.paymentStatus === 'payee' && !canAny(claims, tenantId, ['payment:refund'])) {
          throw new HttpError(
            403,
            'refund_validation_required',
            'Une commande payée exige la validation remboursement du gérant.',
          );
        }
        const from = order.status;
        const now = isoNow();
        order.status = 'annulee';
        order.cancel = { reason, by: claims.sub, at: now };
        order.canceledAt = now;
        order.version += 1;
        order.updatedAt = now;
        for (const ticket of ticketsForOrder(store, tenantId, order.id)) {
          ticket.status = 'prete';
          ticket.updatedAt = now;
          ticket.updatedBy = claims.sub;
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'order.cancelled',
          targetType: 'order',
          targetId: order.id,
          meta: { number: order.number, reason, from, paid: order.paymentStatus === 'payee' },
        });
        if (order.tableCode) await releaseTable(tenantId, order.tableCode, order.id);
        await emitStatus(order, from, claims.sub, { reason });
        return { body: { order: serializeOrder(store, order) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/orders/:id/discount',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'order:discount');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        if (order.status === 'annulee')
          throw HttpError.conflict('order_cancelled', 'Commande annulée.');
        if (order.payments.length > 0) {
          throw HttpError.conflict(
            'payments_started',
            'Des paiements ont déjà été encaissés : la remise est verrouillée.',
          );
        }
        const type = requireEnum(body, 'type', ['percent', 'amount'] as const);
        const value = requireInt(body, 'value', {
          min: 1,
          max: type === 'percent' ? 100 : 1_000_000,
        });
        const reason = requireString(body, 'reason', { min: 3, max: 120 });
        order.discount = {
          type,
          value,
          reason,
          amountXof: 0,
          authorizedBy: claims.sub,
          at: isoNow(),
        };
        recomputeTotals(order);
        order.version += 1;
        order.updatedAt = isoNow();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'order.discount.applied',
          targetType: 'order',
          targetId: order.id,
          meta: { number: order.number, type, value, amountXof: order.discount.amountXof, reason },
        });
        return { body: { order: serializeOrder(store, order) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/orders/:id/payments',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'pos:operate');
        const order = requireOrder(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        if (order.status === 'annulee')
          throw HttpError.conflict(
            'order_cancelled',
            'Commande annulée : aucun encaissement possible.',
          );
        if (order.paymentStatus === 'payee')
          throw HttpError.conflict('already_paid', 'Cette commande est déjà entièrement payée.');
        const method = requireEnum(body, 'method', PAYMENT_METHODS) as PaymentMethod;
        const remaining = order.totalXof - paidXof(order);
        const amount = requireInt(body, 'amountXof', { min: 1, max: remaining });
        const reference = optionalString(body, 'reference', { max: 120 });
        const session = currentSession(store, tenantId);
        const now = isoNow();
        const payment: OrderPayment = {
          id: newOrderId('pay'),
          tenantId,
          orderId: order.id,
          sessionId: session?.id,
          method,
          amountXof: amount,
          reference,
          at: now,
          by: claims.sub,
        };
        store.payments.set(payment.id, payment);
        order.payments.push(payment);
        order.paymentStatus = paidXof(order) >= order.totalXof ? 'payee' : 'partielle';
        order.version += 1;
        order.updatedAt = now;
        let invoiceIssued = false;
        if (order.paymentStatus === 'payee') {
          order.invoiceNumber = nextNumber(store, tenantId, 'invoice');
          order.receiptNumber = nextNumber(store, tenantId, 'receipt');
          order.receiptIssuedAt = now;
          invoiceIssued = true;
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'order.paid',
            targetType: 'order',
            targetId: order.id,
            meta: {
              number: order.number,
              invoiceNumber: order.invoiceNumber,
              method,
              amountXof: order.totalXof,
            },
          });
          await publish('OrderPaid', tenantId, {
            tenantId,
            orderId: order.id,
            number: order.number,
            invoiceNumber: order.invoiceNumber,
            method,
            amountXof: order.totalXof,
            totalXof: order.totalXof,
            at: now,
            actorId: claims.sub,
          });
        }
        return {
          status: 201,
          body: {
            payment,
            invoiceIssued,
            session: session ? serializeSession(store, session) : null,
            order: serializeOrder(store, order),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/kds',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'order:view');
        const stationRaw = ctx.query.get('station') ?? 'all';
        if (stationRaw !== 'all' && !(STATIONS as readonly string[]).includes(stationRaw)) {
          throw HttpError.unprocessable('validation_error', 'Poste inconnu.', { field: 'station' });
        }
        return { body: kdsPayload(store, tenantId, stationRaw as Station | 'all') };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/kds/tickets/:id/status',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'order:update');
        const ticket = store.tickets.get(ctx.params.id ?? '');
        if (!ticket || ticket.tenantId !== tenantId)
          throw HttpError.notFound('Ticket introuvable.');
        const order = requireOrder(store, tenantId, ticket.orderId);
        if (order.status === 'annulee' || order.status === 'servie') {
          throw HttpError.conflict('order_closed', 'Commande déjà clôturée sur ce poste.');
        }
        const body = asObject(ctx.body);
        const target = requireEnum(body, 'status', ['en_preparation', 'prete'] as const);
        const expectedVersion = optionalInt(body, 'expectedVersion', { min: 1 });
        if (expectedVersion !== undefined && expectedVersion !== order.version) {
          throw HttpError.conflict('version_conflict', 'La commande a changé. Rechargez le KDS.', {
            current: serializeOrder(store, order),
          });
        }
        const orderFrom = order.status;
        const now = isoNow();
        if (target === 'en_preparation' && ticket.status === 'nouvelle') {
          ticket.status = 'en_preparation';
        } else if (target === 'prete' && ticket.status !== 'prete') {
          ticket.status = 'prete';
        } else if (ticket.status === 'prete' && target === 'en_preparation') {
          throw HttpError.conflict(
            'invalid_transition',
            'Un ticket prêt ne peut pas revenir en préparation.',
          );
        }
        ticket.updatedAt = now;
        ticket.updatedBy = claims.sub;
        const tickets = ticketsForOrder(store, tenantId, order.id);
        if (tickets.length > 0 && tickets.every((entry) => entry.status === 'prete')) {
          if (order.status === 'recue' || order.status === 'en_preparation') {
            order.status = 'prete';
            order.readyAt = now;
          }
        } else if (order.status === 'recue') {
          order.status = 'en_preparation';
          order.preparingAt = now;
        }
        order.updatedAt = now;
        order.version += 1;
        if (order.status !== orderFrom) {
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'order.status_changed',
            targetType: 'order',
            targetId: order.id,
            meta: { number: order.number, from: orderFrom, to: order.status, via: 'kds' },
          });
          await emitStatus(order, orderFrom, claims.sub, { via: 'kds' });
        }
        return {
          body: {
            ticket,
            order: serializeOrder(store, order),
            kds: kdsPayload(store, tenantId, ticket.station),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/pos',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'order:view');
        if (!canAny(claims, tenantId, ['payment:view', 'pos:operate', 'pos:close'])) {
          throw HttpError.forbidden('Accès caisse refusé.');
        }
        const session = currentSession(store, tenantId);
        const lastClosed = [...store.sessions.values()]
          .filter((entry) => entry.tenantId === tenantId && entry.status === 'cloturee')
          .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
        const today = new Date().toISOString().slice(0, 10);
        const paymentsToday = [...store.payments.values()].filter(
          (payment) => payment.tenantId === tenantId && payment.at.slice(0, 10) === today,
        );
        const byMethod: Record<string, number> = { especes: 0, mobile_money: 0, carte: 0 };
        for (const payment of paymentsToday) byMethod[payment.method] += payment.amountXof;
        const toPay = [...store.orders.values()].filter(
          (order) =>
            order.tenantId === tenantId &&
            order.status !== 'annulee' &&
            order.paymentStatus !== 'payee',
        );
        return {
          body: {
            tenantId,
            generatedAt: isoNow(),
            session: session ? serializeSession(store, session) : null,
            lastClosed: lastClosed ? serializeSession(store, lastClosed) : null,
            today: {
              payments: paymentsToday.length,
              revenueXof: paymentsToday.reduce((sum, payment) => sum + payment.amountXof, 0),
              byMethod,
            },
            toPay: toPay
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((order) => serializeOrder(store, order)),
            toPayTotalXof: toPay.reduce((sum, order) => sum + order.totalXof - paidXof(order), 0),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/pos/session/open',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'pos:operate');
        const body = asObject(ctx.body);
        if (currentSession(store, tenantId)) {
          throw HttpError.conflict(
            'session_already_open',
            'Une caisse est déjà ouverte pour cet établissement.',
          );
        }
        const openingFloatXof =
          optionalInt(body, 'openingFloatXof', { min: 0, max: 5_000_000 }) ?? 0;
        const now = isoNow();
        const session: CashSession = {
          id: newOrderId('csh'),
          tenantId,
          status: 'ouverte',
          openedBy: claims.sub,
          openedAt: now,
          openingFloatXof,
        };
        store.sessions.set(session.id, session);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'pos.session.opened',
          targetType: 'cash_session',
          targetId: session.id,
          meta: { openingFloatXof },
        });
        return { status: 201, body: { session: serializeSession(store, session) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/pos/session/close',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'pos:close');
        const session = currentSession(store, tenantId);
        if (!session)
          throw HttpError.conflict('session_not_open', 'Aucune caisse ouverte à clôturer.');
        const body = asObject(ctx.body);
        const countedXof = requireInt(body, 'countedXof', { min: 0, max: 50_000_000 });
        const notes = optionalString(body, 'notes', { max: 300 });
        const payments = [...store.payments.values()].filter(
          (payment) => payment.sessionId === session.id,
        );
        const expectedXof =
          session.openingFloatXof + payments.reduce((sum, payment) => sum + payment.amountXof, 0);
        const now = isoNow();
        session.status = 'cloturee';
        session.closedBy = claims.sub;
        session.closedAt = now;
        session.countedXof = countedXof;
        session.expectedXof = expectedXof;
        session.differenceXof = countedXof - expectedXof;
        session.notes = notes;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'pos.session.closed',
          targetType: 'cash_session',
          targetId: session.id,
          meta: {
            expectedXof,
            countedXof,
            differenceXof: session.differenceXof,
            payments: payments.length,
          },
        });
        return { body: { session: serializeSession(store, session) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/public/tenants/:tenantId/orders',
      auth: false,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const body = asObject(ctx.body);
        const channel = body.channel;
        const tableToken = optionalString(body, 'tableToken', { max: 120 }) ?? null;
        if (channel === 'sur_place' && !tableToken) {
          throw HttpError.unprocessable(
            'table_token_required',
            'Scannez le QR de votre table pour commander.',
            {
              field: 'tableToken',
            },
          );
        }
        const result = await createOrder({
          tenantId,
          actorId: 'client',
          source: 'client',
          body,
          tableToken,
        });
        return {
          status: result.replayed ? 200 : 201,
          body: {
            order: publicView(store, result.order),
            trackingUrl: `${appPublicUrl}/suivi/${tenantId}/${result.order.id}?k=${result.order.publicToken}`,
            replayed: result.replayed,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/orders/:id',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const order = store.orders.get(ctx.params.id ?? '');
        if (!order || order.tenantId !== tenantId)
          throw HttpError.notFound('Commande introuvable.');
        const key = ctx.query.get('k') ?? '';
        if (!key || key !== order.publicToken) throw HttpError.forbidden('Lien de suivi invalide.');
        return { body: { order: publicView(store, order) } };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/orders/:orderId/provider-payments',
      service: true,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const order = requireOrder(store, tenantId, ctx.params.orderId ?? '');
        const body = asObject(ctx.body);
        const method = requireEnum(body, 'method', [
          'mobile_money',
          'carte',
        ] as const) as PaymentMethod;
        const reference = requireString(body, 'reference', { min: 3, max: 120 });
        const provider = requireString(body, 'provider', { min: 2, max: 40 });
        const existing = order.payments.find((payment) => payment.reference === reference);
        if (existing) {
          return {
            body: {
              payment: existing,
              replayed: true,
              invoiceIssued: Boolean(order.invoiceNumber),
              order: {
                id: order.id,
                number: order.number,
                paymentStatus: order.paymentStatus,
                totalXof: order.totalXof,
                invoiceNumber: order.invoiceNumber ?? null,
                receiptNumber: order.receiptNumber ?? null,
              },
            },
          };
        }
        if (order.status === 'annulee') {
          throw HttpError.conflict(
            'order_cancelled',
            'Commande annulée : aucun encaissement possible.',
          );
        }
        if (order.paymentStatus === 'payee') {
          throw HttpError.conflict('already_paid', 'Cette commande est déjà entièrement payée.');
        }
        const remaining = order.totalXof - paidXof(order);
        const amount = requireInt(body, 'amountXof', { min: 1, max: remaining });
        const now = isoNow();
        const payment: OrderPayment = {
          id: newOrderId('pay'),
          tenantId,
          orderId: order.id,
          sessionId: undefined,
          method,
          amountXof: amount,
          reference,
          at: now,
          by: `payment-service:${provider}`,
        };
        store.payments.set(payment.id, payment);
        order.payments.push(payment);
        order.paymentStatus = paidXof(order) >= order.totalXof ? 'payee' : 'partielle';
        order.version += 1;
        order.updatedAt = now;
        let invoiceIssued = false;
        if (order.paymentStatus === 'payee') {
          order.invoiceNumber = nextNumber(store, tenantId, 'invoice');
          order.receiptNumber = nextNumber(store, tenantId, 'receipt');
          order.receiptIssuedAt = now;
          invoiceIssued = true;
          store.recordAudit({
            tenantId,
            actorId: 'payment-service',
            action: 'order.paid',
            targetType: 'order',
            targetId: order.id,
            meta: {
              number: order.number,
              invoiceNumber: order.invoiceNumber,
              method,
              provider,
              reference,
              amountXof: order.totalXof,
              via: 'payment-service',
            },
          });
          await publish('OrderPaid', tenantId, {
            tenantId,
            orderId: order.id,
            number: order.number,
            invoiceNumber: order.invoiceNumber,
            method,
            provider,
            reference,
            amountXof: order.totalXof,
            totalXof: order.totalXof,
            at: now,
            actorId: 'payment-service',
          });
        }
        return {
          status: 201,
          body: {
            payment,
            replayed: false,
            invoiceIssued,
            order: {
              id: order.id,
              number: order.number,
              paymentStatus: order.paymentStatus,
              totalXof: order.totalXof,
              invoiceNumber: order.invoiceNumber ?? null,
              receiptNumber: order.receiptNumber ?? null,
            },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/orders/:orderId',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const order = store.orders.get(ctx.params.orderId ?? '');
        if (!order || order.tenantId !== tenantId)
          throw HttpError.notFound('Commande introuvable.');
        const lastPayment = order.payments[order.payments.length - 1];
        return {
          body: {
            order: {
              id: order.id,
              number: order.number,
              tenantId: order.tenantId,
              status: order.status,
              channel: order.channel,
              tableCode: order.tableCode ?? null,
              guests: order.guests ?? null,
              paymentStatus: order.paymentStatus,
              subtotalXof: order.subtotalXof,
              taxXof: order.taxXof,
              taxRate: order.taxRate,
              totalXof: order.totalXof,
              invoiceNumber: order.invoiceNumber ?? null,
              createdAt: order.createdAt,
              paidAt: order.paymentStatus === 'payee' ? (lastPayment?.at ?? order.updatedAt) : null,
              lines: order.lines.map((line) => ({
                id: line.id,
                productId: line.productId,
                productName: line.productName,
                variantName: line.variantName ?? null,
                station: line.station,
                quantity: line.quantity,
                unitPriceXof: line.unitPriceXof,
                lineTotalXof: line.lineTotalXof,
              })),
            },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/orders/summary',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const orders = [...store.orders.values()].filter((order) => order.tenantId === tenantId);
        const summary = listSummary(orders);
        return {
          body: {
            tenantId,
            orders: summary.total,
            open: summary.open,
            byStatus: summary.byStatus,
            paidTodayXof: summary.paidTodayXof,
            unpaidXof: summary.unpaidXof,
          },
        };
      },
    },
  ];
}
