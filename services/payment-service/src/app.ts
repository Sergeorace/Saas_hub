import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  HttpError,
  asObject,
  hasPlatformPermission,
  optionalString,
  requireEnum,
  requirePlatformPermission,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import {
  PAYMENT_METHODS,
  PROVIDERS,
  getProvider,
  routeProvider,
  type PaymentMethod,
} from './providers.js';
import {
  DISPUTE_STATUSES,
  FRAUD_LIMITS,
  SETTLEMENT_MODES,
  activeBlock,
  bookCashIncome,
  bookConfirmation,
  bookDisbursement,
  bookRefund,
  bookSettlement,
  feeBreakdown,
  getWallet,
  raiseBlock,
  routingSnapshot,
  runReconciliation,
  serializeBlock,
  serializeDispute,
  serializeSettlement,
  serializeSplit,
  serializeTransaction,
  serializeWallet,
  type Dispute,
  type PaymentStore,
  type PaymentTransaction,
  type RefundRecord,
  type Settlement,
  type SplitGroup,
} from './store.js';
import { ledgerBalances, verifyLedger } from './ledger.js';
import { transactionsCsv, transactionsPdf, transactionsXls } from './exports.js';

export interface PaymentAppOptions {
  store: PaymentStore;
  sandbox: boolean;
  providerKeys: Record<string, string | undefined>;
  webhookSecrets: Record<string, string>;
  deps: {
    tenant: Pick<ServiceClient, 'get'>;
    order: Pick<ServiceClient, 'get' | 'post'>;
  };
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

function isoNow(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = source[field];
  const min = opts.min ?? 0;
  const max = opts.max ?? 100_000_000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw HttpError.unprocessable('validation_error', `« ${field} » doit être un entier entre ${min} et ${max}.`, { field });
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

function tenantOf(ctx: RequestContext, permission: string): { tenantId: string; claims: AuthClaims } {
  const tenantId = ctx.params.tenantId ?? '';
  const claims = requireTenantPermission(ctx.auth, tenantId, permission);
  return { tenantId, claims };
}

function platformAny(ctx: RequestContext, permissions: string[]): AuthClaims {
  const claims = ctx.auth;
  if (!claims) throw HttpError.unauthorized();
  if (!permissions.some((permission) => hasPlatformPermission(claims, permission))) {
    throw HttpError.forbidden('Permission plateforme requise.');
  }
  return claims;
}

function routingKeys(options: PaymentAppOptions): Record<string, string | undefined> {
  if (!options.sandbox) return options.providerKeys;
  return Object.fromEntries(PROVIDERS.map((provider) => [provider.id, 'sandbox']));
}

interface OrderSnapshot {
  id: string;
  number: string;
  tenantId: string;
  status: string;
  paymentStatus: string;
  totalXof: number;
  invoiceNumber: string | null;
}

async function fetchOrder(options: PaymentAppOptions, tenantId: string, orderId: string): Promise<OrderSnapshot> {
  try {
    const payload = await options.deps.order.get<{ order: OrderSnapshot }>(
      `/internal/tenants/${tenantId}/orders/${encodeURIComponent(orderId)}`,
    );
    return payload.order;
  } catch {
    throw HttpError.notFound('Commande introuvable pour cet établissement.');
  }
}

async function tenantPlan(options: PaymentAppOptions, tenantId: string): Promise<string> {
  try {
    const payload = await options.deps.tenant.get<{ plan?: string }>(`/internal/tenants/${tenantId}/summary`);
    return payload.plan ?? 'pro';
  } catch {
    return 'pro';
  }
}

/* ------------------------------------------------------------------ */
/* Anti-fraude                                                         */
/* ------------------------------------------------------------------ */

function guardFraud(store: PaymentStore, tenantId: string, userId: string, amountXof: number): void {
  const block = activeBlock(store, tenantId, userId);
  if (block) {
    throw new HttpError(429, 'fraud_blocked', 'Paiements temporairement bloqués pour ce compte.', {
      blockId: block.id,
      rule: block.rule,
      expiresAt: block.expiresAt,
    });
  }
  if (amountXof > FRAUD_LIMITS.maxAmountXof) {
    const raised = raiseBlock(store, {
      tenantId,
      userId,
      rule: 'montant_max',
      reason: `Montant ${amountXof} XOF supérieur au plafond de ${FRAUD_LIMITS.maxAmountXof} XOF.`,
    });
    throw new HttpError(429, 'fraud_blocked', 'Montant inhabituel : paiement bloqué temporairement.', {
      blockId: raised.id,
      rule: raised.rule,
      expiresAt: raised.expiresAt,
    });
  }
  const now = Date.now();
  const recent = [...store.transactions.values()].filter(
    (transaction) =>
      transaction.tenantId === tenantId &&
      transaction.actorId === userId &&
      now - new Date(transaction.createdAt).getTime() < FRAUD_LIMITS.velocityWindowMs,
  );
  if (recent.length >= FRAUD_LIMITS.velocityMax) {
    const raised = raiseBlock(store, {
      tenantId,
      userId,
      rule: 'velocite',
      reason: `${recent.length} tentatives en moins de 10 minutes.`,
    });
    throw new HttpError(429, 'fraud_blocked', 'Trop de tentatives de paiement : blocage temporaire.', {
      blockId: raised.id,
      rule: raised.rule,
      expiresAt: raised.expiresAt,
    });
  }
  const failures = [...store.transactions.values()].filter(
    (transaction) =>
      transaction.tenantId === tenantId &&
      transaction.actorId === userId &&
      (transaction.status === 'echouee' || transaction.status === 'expiree') &&
      now - new Date(transaction.updatedAt).getTime() < FRAUD_LIMITS.failureWindowMs,
  );
  if (failures.length >= FRAUD_LIMITS.failureMax) {
    const raised = raiseBlock(store, {
      tenantId,
      userId,
      rule: 'echecs_repetes',
      reason: `${failures.length} échecs consécutifs en moins de 15 minutes.`,
    });
    throw new HttpError(429, 'fraud_blocked', 'Échecs répétés : blocage temporaire.', {
      blockId: raised.id,
      rule: raised.rule,
      expiresAt: raised.expiresAt,
    });
  }
  const confirmed = [...store.transactions.values()].filter(
    (transaction) => transaction.tenantId === tenantId && transaction.source === 'agregateur' && transaction.status === 'confirmee',
  );
  if (confirmed.length >= 3) {
    const average = confirmed.reduce((sum, transaction) => sum + transaction.amountXof, 0) / confirmed.length;
    if (amountXof > 50_000 && amountXof > average * 4) {
      const raised = raiseBlock(store, {
        tenantId,
        userId,
        rule: 'anomalie_montant',
        reason: `Montant ${amountXof} XOF très supérieur à la moyenne (${Math.round(average)} XOF).`,
      });
      throw new HttpError(429, 'fraud_blocked', 'Montant atypique : vérification anti-fraude requise.', {
        blockId: raised.id,
        rule: raised.rule,
        expiresAt: raised.expiresAt,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Intentions et cycle de vie                                          */
/* ------------------------------------------------------------------ */

interface IntentInput {
  tenantId: string;
  actorId: string;
  orderId: string | null;
  orderNumber: string | null;
  amountXof: number;
  method: PaymentMethod;
  provider?: string;
  note?: string;
  customerPhone?: string;
  customerName?: string;
  splitId: string | null;
  tipXof: number;
  tipStaffIds: string[];
  plan: string;
}

function prepareIntent(options: PaymentAppOptions, input: IntentInput): PaymentTransaction {
  const decision = routeProvider({
    method: input.method,
    amountXof: input.amountXof,
    preferred: input.provider,
    health: options.store.providerHealth,
    keys: routingKeys(options),
  });
  if (!decision.chosen) {
    throw new HttpError(503, 'provider_unavailable', 'Aucun fournisseur disponible pour ce moyen de paiement.', {
      candidates: decision.candidates,
    });
  }
  const chosen = decision.chosen;
  const quote = chosen.quote(input.amountXof);
  if (quote.feeXof >= input.amountXof) {
    throw HttpError.unprocessable('amount_too_small', 'Montant insuffisant pour couvrir les frais du fournisseur.', {
      feeXof: quote.feeXof,
    });
  }
  const fees = feeBreakdown(input.amountXof, quote.feeXof, input.plan);
  const initiated = chosen.initiate({
    intentId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    amountXof: input.amountXof,
    phone: input.customerPhone,
    customerName: input.customerName,
    method: input.method,
  });
  const now = isoNow();
  const tipAllocations = input.tipXof > 0 && input.tipStaffIds.length > 0
    ? distributeTip(input.tipXof, input.tipStaffIds)
    : [];
  return {
    id: `txn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    amountXof: input.amountXof,
    method: input.method,
    provider: chosen.id,
    providerReference: initiated.reference,
    status: 'en_attente',
    source: 'agregateur',
    splitId: input.splitId,
    customerPhone: input.customerPhone ?? null,
    customerName: input.customerName ?? null,
    note: input.note ?? null,
    fees,
    refunds: [],
    refundedXof: 0,
    tipXof: input.tipXof,
    tipAllocations,
    routing: routingSnapshot(decision),
    instructions: initiated.instructions,
    requires3ds: initiated.requires3ds,
    threeDsUrl: initiated.threeDsUrl ?? null,
    actorId: input.actorId,
    simulated: options.sandbox,
    invoiceNumber: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  };
}

function distributeTip(totalXof: number, staffIds: string[]): Array<{ staffId: string; amountXof: number }> {
  const unique = [...new Set(staffIds)].slice(0, 10);
  const base = Math.floor(totalXof / unique.length);
  const remainder = totalXof - base * unique.length;
  return unique.map((staffId, index) => ({
    staffId,
    amountXof: base + (index < remainder ? 1 : 0),
  }));
}

function requireTransaction(store: PaymentStore, tenantId: string, id: string): PaymentTransaction {
  const transaction = store.transactions.get(id);
  if (!transaction || transaction.tenantId !== tenantId) throw HttpError.notFound('Transaction introuvable.');
  return transaction;
}

async function finalizeConfirmation(
  options: PaymentAppOptions,
  transaction: PaymentTransaction,
  actorId: string,
  via: 'webhook' | 'sandbox' | '3ds',
): Promise<{ orderSynced: boolean; warning: string | null }> {
  if (transaction.status !== 'en_attente') {
    return { orderSynced: true, warning: null };
  }
  const { store } = options;
  const now = isoNow();
  transaction.status = 'confirmee';
  transaction.confirmedAt = now;
  transaction.updatedAt = now;
  bookConfirmation(store, transaction);

  let orderSynced = false;
  let warning: string | null = null;
  if (transaction.orderId) {
    try {
      const payload = await options.deps.order.post<{
        order: { number: string; invoiceNumber: string | null };
        replayed: boolean;
      }>(`/internal/tenants/${transaction.tenantId}/orders/${encodeURIComponent(transaction.orderId)}/provider-payments`, {
        amountXof: transaction.amountXof,
        method: transaction.method,
        provider: transaction.provider,
        reference: `provider:${transaction.providerReference}`,
      });
      transaction.orderNumber = payload.order.number;
      transaction.invoiceNumber = payload.order.invoiceNumber;
      orderSynced = true;
    } catch (error) {
      warning = error instanceof Error ? error.message : 'Synchronisation commande impossible.';
      store.recordAudit({
        tenantId: transaction.tenantId,
        actorId,
        action: 'payment.order_sync_failed',
        targetType: 'transaction',
        targetId: transaction.id,
        meta: { orderId: transaction.orderId, warning },
      });
    }
  }

  store.recordAudit({
    tenantId: transaction.tenantId,
    actorId,
    action: 'payment.confirmed',
    targetType: 'transaction',
    targetId: transaction.id,
    meta: {
      amountXof: transaction.amountXof,
      provider: transaction.provider,
      reference: transaction.providerReference,
      via,
      netXof: transaction.fees.netXof,
      commissionXof: transaction.fees.commissionXof,
    },
  });
  await options.publish('PaymentConfirmed', transaction.tenantId, {
    tenantId: transaction.tenantId,
    transactionId: transaction.id,
    orderId: transaction.orderId,
    amountXof: transaction.amountXof,
    method: transaction.method,
    provider: transaction.provider,
    netXof: transaction.fees.netXof,
    commissionXof: transaction.fees.commissionXof,
    invoiceNumber: transaction.invoiceNumber,
    at: now,
  });
  if (transaction.tipXof > 0) {
    await options.publish('TipDistributed', transaction.tenantId, {
      tenantId: transaction.tenantId,
      transactionId: transaction.id,
      totalTipXof: transaction.tipXof,
      allocations: transaction.tipAllocations,
      at: now,
    });
  }
  if (transaction.splitId) {
    const split = store.splits.get(transaction.splitId);
    if (split) {
      const snapshot = serializeSplit(store, split);
      if (snapshot.status === 'confirmee') {
        await options.publish('SplitCompleted', transaction.tenantId, {
          tenantId: transaction.tenantId,
          splitId: split.id,
          orderId: split.orderId,
          totalXof: split.totalXof,
          at: now,
        });
      }
    }
  }
  return { orderSynced, warning };
}

async function failTransaction(
  options: PaymentAppOptions,
  transaction: PaymentTransaction,
  reason: string,
  actorId: string,
  finalStatus: 'echouee' | 'expiree' = 'echouee',
): Promise<void> {
  if (transaction.status !== 'en_attente') return;
  transaction.status = finalStatus;
  transaction.failureReason = reason;
  transaction.updatedAt = isoNow();
  options.store.recordAudit({
    tenantId: transaction.tenantId,
    actorId,
    action: 'payment.failed',
    targetType: 'transaction',
    targetId: transaction.id,
    meta: { reason, status: finalStatus, provider: transaction.provider },
  });
  await options.publish('PaymentFailed', transaction.tenantId, {
    tenantId: transaction.tenantId,
    transactionId: transaction.id,
    orderId: transaction.orderId,
    amountXof: transaction.amountXof,
    provider: transaction.provider,
    reason,
    status: finalStatus,
    at: transaction.updatedAt,
  });
}

async function applyRefund(
  options: PaymentAppOptions,
  transaction: PaymentTransaction,
  amountXof: number,
  reason: string,
  actorId: string,
): Promise<RefundRecord> {
  if (transaction.status !== 'confirmee' && transaction.status !== 'remboursee_partielle') {
    throw HttpError.conflict('not_refundable', 'Seule une transaction confirmée peut être remboursée.');
  }
  const remaining = transaction.amountXof - transaction.refundedXof;
  if (amountXof < 1 || amountXof > remaining) {
    throw HttpError.unprocessable('invalid_refund_amount', `Montant remboursable : 1 à ${remaining} XOF.`, {
      remainingXof: remaining,
    });
  }
  const provider = getProvider(transaction.provider);
  if (!provider) throw new HttpError(500, 'provider_missing', 'Fournisseur de paiement introuvable.');
  const providerRefund = provider.refund({ reference: transaction.providerReference, amountXof });
  const refund: RefundRecord = {
    id: `rfd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    amountXof,
    reason,
    by: actorId,
    at: isoNow(),
    providerReference: providerRefund.reference,
  };
  transaction.refunds.push(refund);
  transaction.refundedXof += amountXof;
  transaction.status = transaction.refundedXof >= transaction.amountXof ? 'remboursee' : 'remboursee_partielle';
  transaction.updatedAt = refund.at;
  bookRefund(options.store, transaction, refund);
  options.store.recordAudit({
    tenantId: transaction.tenantId,
    actorId,
    action: 'payment.refunded',
    targetType: 'transaction',
    targetId: transaction.id,
    meta: { refundId: refund.id, amountXof, reason, totalRefunded: transaction.refundedXof, providerReference: refund.providerReference },
  });
  await options.publish('RefundIssued', transaction.tenantId, {
    tenantId: transaction.tenantId,
    transactionId: transaction.id,
    orderId: transaction.orderId,
    refundId: refund.id,
    amountXof,
    totalRefundedXof: transaction.refundedXof,
    status: transaction.status,
    at: refund.at,
  });
  return refund;
}

/* ------------------------------------------------------------------ */
/* Webhooks signés                                                     */
/* ------------------------------------------------------------------ */

const WEBHOOK_TYPES = ['payment.confirmed', 'payment.failed', 'payment.expired', 'refund.confirmed'] as const;

function webhookCanonical(timestamp: string, eventId: string, type: string, reference: string, amount: number | undefined): string {
  return `${timestamp}.${eventId}.${type}.${reference}.${amount ?? ''}`;
}

function verifySignature(secret: string, canonical: string, header: string): boolean {
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');
  const provided = header.startsWith('sha256=') ? header.slice(7) : header;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function boolFlag(value: unknown): boolean {
  return value === true || value === '1' || value === 'true';
}

function filtersFrom(query: URLSearchParams) {
  return {
    status: query.get('status') ?? '',
    method: query.get('method') ?? '',
    from: query.get('from') ?? '',
    to: query.get('to') ?? '',
    q: (query.get('q') ?? '').trim().toLowerCase(),
    limit: Math.min(Number(query.get('limit') ?? 50) || 50, 200),
  };
}

function filteredTransactions(store: PaymentStore, tenantId: string, query: URLSearchParams): PaymentTransaction[] {
  const filters = filtersFrom(query);
  return [...store.transactions.values()]
    .filter((transaction) => transaction.tenantId === tenantId)
    .filter((transaction) => (filters.status ? transaction.status === filters.status : true))
    .filter((transaction) => (filters.method ? transaction.method === filters.method : true))
    .filter((transaction) => (filters.from ? transaction.createdAt >= filters.from : true))
    .filter((transaction) => (filters.to ? transaction.createdAt <= `${filters.to}T23:59:59.999Z` : true))
    .filter((transaction) => {
      if (!filters.q) return true;
      const haystack = [
        transaction.id,
        transaction.orderNumber ?? '',
        transaction.orderId ?? '',
        transaction.providerReference,
        transaction.provider,
        transaction.customerName ?? '',
        transaction.customerPhone ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(filters.q);
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, filters.limit);
}

export function buildPaymentApp(options: PaymentAppOptions): Route[] {
  const { store } = options;

  const overview = (tenantId: string, plan: string) => {
    const wallet = getWallet(store, tenantId);
    const transactions = [...store.transactions.values()].filter((transaction) => transaction.tenantId === tenantId);
    const today = todayIso();
    const confirmedToday = transactions.filter(
      (transaction) => transaction.status === 'confirmee' && transaction.confirmedAt?.slice(0, 10) === today,
    );
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const recent = transactions.filter((transaction) => transaction.createdAt >= thirtyDaysAgo);
    const pendingSettlements = [...store.settlements.values()].filter(
      (settlement) => settlement.tenantId === tenantId && settlement.status === 'en_attente',
    );
    const blocks = [...store.fraudBlocks.values()]
      .filter((block) => block.tenantId === tenantId && !block.liftedAt && new Date(block.expiresAt).getTime() > Date.now())
      .map(serializeBlock);
    const lastReconciliation = store.reconciliations
      .filter((run) => run.tenantId === tenantId)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0] ?? null;
    const commissionPercent = feeBreakdown(0, 0, plan).commissionPercent;
    return {
      tenantId,
      currency: 'XOF',
      plan,
      commissionPercent,
      wallet: serializeWallet(wallet),
      stats: {
        todayVolumeXof: confirmedToday.reduce((sum, transaction) => sum + transaction.amountXof, 0),
        todayCount: confirmedToday.length,
        commission30dXof: recent.reduce((sum, transaction) => sum + transaction.fees.commissionXof, 0),
        refundedXof: transactions.reduce((sum, transaction) => sum + transaction.refundedXof, 0),
        pendingCount: transactions.filter((transaction) => transaction.status === 'en_attente').length,
        failedCount: transactions.filter((transaction) => transaction.status === 'echouee' || transaction.status === 'expiree').length,
        pendingSettlementsXof: pendingSettlements.reduce((sum, settlement) => sum + settlement.amountXof, 0),
        pendingSettlements: pendingSettlements.length,
      },
      activeBlocks: blocks,
      lastReconciliation,
      generatedAt: isoNow(),
    };
  };

  return [
    /* --------------------------- Vérification --------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/overview',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const plan = await tenantPlan(options, tenantId);
        return { body: overview(tenantId, plan) };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/providers',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const keys = routingKeys(options);
        const items = PROVIDERS.map((provider) => ({
          id: provider.id,
          label: provider.label,
          methods: provider.methods,
          percent: provider.quote(10_000).percent,
          fixedXof: provider.quote(10_000).fixedXof,
          supports3ds: provider.supports3ds,
          configured: provider.isConfigured(keys),
          sandbox: options.sandbox,
          health: store.providerHealth[provider.id] ?? 'up',
          instructions: provider.sandboxInstructions,
        }));
        return { body: { tenantId, items, sandbox: options.sandbox, generatedAt: isoNow() } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/providers/:providerId/health',
      handler: (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const provider = getProvider(ctx.params.providerId ?? '');
        if (!provider) throw HttpError.notFound('Fournisseur inconnu.');
        const body = asObject(ctx.body);
        const status = requireEnum(body, 'status', ['up', 'down'] as const);
        store.providerHealth[provider.id] = status;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'provider.health',
          targetType: 'provider',
          targetId: provider.id,
          meta: { status },
        });
        return { body: { provider: provider.id, status } };
      },
    },

    /* --------------------------- Transactions --------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/transactions',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const items = filteredTransactions(store, tenantId, ctx.query);
        return {
          body: {
            tenantId,
            items: items.map(serializeTransaction),
            count: items.length,
            generatedAt: isoNow(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/transactions',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const body = asObject(ctx.body);
        const method = requireEnum(body, 'method', PAYMENT_METHODS) as PaymentMethod;
        const orderId = optionalString(body, 'orderId', { max: 60 }) ?? null;
        let order: OrderSnapshot | null = null;
        if (orderId) order = await fetchOrder(options, tenantId, orderId);
        const amountXof = order
          ? optionalInt(body, 'amountXof', { min: 1, max: 10_000_000 }) ?? order.totalXof
          : requireInt(body, 'amountXof', { min: 100, max: 10_000_000 });
        guardFraud(store, tenantId, claims.sub, amountXof);
        const tipXof = optionalInt(body, 'tipXof', { min: 0, max: 500_000 }) ?? 0;
        if (tipXof > Math.floor(amountXof / 2)) {
          throw HttpError.unprocessable('invalid_tip', 'Le pourboire ne peut pas dépasser la moitié du montant.');
        }
        const tipStaffIds = Array.isArray(body.tipStaffIds)
          ? body.tipStaffIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
          : [];
        const plan = await tenantPlan(options, tenantId);
        const transaction = prepareIntent(options, {
          tenantId,
          actorId: claims.sub,
          orderId,
          orderNumber: order?.number ?? null,
          amountXof,
          method,
          provider: optionalString(body, 'provider', { max: 30 }),
          note: optionalString(body, 'note', { max: 200 }),
          customerPhone: optionalString(body, 'customerPhone', { max: 20 }),
          customerName: optionalString(body, 'customerName', { max: 80 }),
          splitId: null,
          tipXof,
          tipStaffIds,
          plan,
        });
        store.transactions.set(transaction.id, transaction);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payment.initiated',
          targetType: 'transaction',
          targetId: transaction.id,
          meta: {
            amountXof,
            method,
            provider: transaction.provider,
            orderId,
            providerReference: transaction.providerReference,
          },
        });
        await options.publish('PaymentInitiated', tenantId, {
          tenantId,
          transactionId: transaction.id,
          orderId,
          amountXof,
          method,
          provider: transaction.provider,
          at: transaction.createdAt,
        });
        return {
          status: 201,
          body: {
            transaction: serializeTransaction(transaction),
            wallet: serializeWallet(getWallet(store, tenantId)),
            sandbox: options.sandbox,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/transactions/:id',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const transaction = requireTransaction(store, tenantId, ctx.params.id ?? '');
        return { body: { transaction: serializeTransaction(transaction) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/transactions/:id/cancel',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const transaction = requireTransaction(store, tenantId, ctx.params.id ?? '');
        if (transaction.status !== 'en_attente') {
          throw HttpError.conflict('not_cancellable', 'Seule une transaction en attente peut être annulée.');
        }
        transaction.status = 'annulee';
        transaction.failureReason = 'Annulée avant confirmation.';
        transaction.updatedAt = isoNow();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payment.cancelled',
          targetType: 'transaction',
          targetId: transaction.id,
          meta: { provider: transaction.provider },
        });
        await options.publish('PaymentCancelled', tenantId, {
          tenantId,
          transactionId: transaction.id,
          orderId: transaction.orderId,
          amountXof: transaction.amountXof,
          at: transaction.updatedAt,
        });
        return { body: { transaction: serializeTransaction(transaction) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/transactions/:id/refund',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:refund');
        const transaction = requireTransaction(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const remaining = transaction.amountXof - transaction.refundedXof;
        const amountXof = optionalInt(body, 'amountXof', { min: 1, max: remaining }) ?? remaining;
        const reason = requireString(body, 'reason', { min: 3, max: 200 });
        const refund = await applyRefund(options, transaction, amountXof, reason, claims.sub);
        return {
          status: 201,
          body: {
            refund,
            transaction: serializeTransaction(transaction),
            wallet: serializeWallet(getWallet(store, tenantId)),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/transactions/:id/sandbox',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        if (!options.sandbox) throw HttpError.forbidden('Le bac à sable est désactivé.');
        const transaction = requireTransaction(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const outcome = requireEnum(body, 'outcome', ['confirme', 'echoue', 'expire'] as const);
        if (outcome === 'confirme') {
          const result = await finalizeConfirmation(options, transaction, claims.sub, 'sandbox');
          return { body: { transaction: serializeTransaction(transaction), ...result } };
        }
        await failTransaction(
          options,
          transaction,
          outcome === 'expire' ? 'Délai fournisseur dépassé.' : 'Paiement refusé par le fournisseur.',
          claims.sub,
          outcome === 'expire' ? 'expiree' : 'echouee',
        );
        return { body: { transaction: serializeTransaction(transaction) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/transactions/:id/confirm-3ds',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const transaction = requireTransaction(store, tenantId, ctx.params.id ?? '');
        if (!transaction.requires3ds) {
          throw HttpError.conflict('no_3ds', 'Cette transaction n’exige pas de 3-D Secure.');
        }
        const result = await finalizeConfirmation(options, transaction, claims.sub, '3ds');
        return { body: { transaction: serializeTransaction(transaction), ...result } };
      },
    },

    /* ----------------------------- Paiement fractionné ----------------------------- */
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/splits',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const body = asObject(ctx.body);
        const orderId = requireString(body, 'orderId', { max: 60 });
        const order = await fetchOrder(options, tenantId, orderId);
        const partsRaw = Array.isArray(body.parts) ? body.parts : [];
        if (partsRaw.length < 2 || partsRaw.length > 8) {
          throw HttpError.unprocessable('invalid_parts', 'Le paiement fractionné exige 2 à 8 convives.');
        }
        const plan = await tenantPlan(options, tenantId);
        const tipXof = optionalInt(body, 'tipXof', { min: 0, max: 200_000 }) ?? 0;
        const splitId = `spl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const prepared: PaymentTransaction[] = [];
        let totalXof = 0;
        for (const raw of partsRaw) {
          const part = asObject(raw);
          const amountXof = requireInt(part, 'amountXof', { min: 100, max: order.totalXof });
          const method = requireEnum(part, 'method', PAYMENT_METHODS) as PaymentMethod;
          totalXof += amountXof;
          guardFraud(store, tenantId, claims.sub, amountXof);
          prepared.push(
            prepareIntent(options, {
              tenantId,
              actorId: claims.sub,
              orderId,
              orderNumber: order.number,
              amountXof,
              method,
              provider: optionalString(part, 'provider', { max: 30 }),
              note: optionalString(part, 'label', { max: 40 }),
              customerPhone: optionalString(part, 'customerPhone', { max: 20 }),
              customerName: optionalString(part, 'label', { max: 80 }),
              splitId,
              tipXof: partsRaw.length === prepared.length + 1 ? tipXof : 0,
              tipStaffIds: [],
              plan,
            }),
          );
        }
        if (totalXof !== order.totalXof) {
          throw HttpError.unprocessable('split_mismatch', `La somme des parts (${totalXof}) doit égaler le total de la commande (${order.totalXof}).`, {
            expectedXof: order.totalXof,
            providedXof: totalXof,
          });
        }
        const split: SplitGroup = {
          id: splitId,
          tenantId,
          orderId,
          totalXof,
          tipXof,
          parts: prepared.map((transaction, index) => {
            const raw = asObject(partsRaw[index]);
            return {
              transactionId: transaction.id,
              label: optionalString(raw, 'label', { max: 40 }) ?? `Convive ${index + 1}`,
              amountXof: transaction.amountXof,
            };
          }),
          createdAt: isoNow(),
        };
        for (const transaction of prepared) store.transactions.set(transaction.id, transaction);
        store.splits.set(split.id, split);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payment.split.created',
          targetType: 'split',
          targetId: split.id,
          meta: { orderId, totalXof, parts: prepared.length },
        });
        return { status: 201, body: { split: serializeSplit(store, split) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/splits/:id',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const split = store.splits.get(ctx.params.id ?? '');
        if (!split || split.tenantId !== tenantId) throw HttpError.notFound('Partage introuvable.');
        return { body: { split: serializeSplit(store, split) } };
      },
    },

    /* ----------------------------- Portefeuille ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/wallet',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const wallet = getWallet(store, tenantId);
        const settlements = [...store.settlements.values()]
          .filter((settlement) => settlement.tenantId === tenantId)
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .slice(0, 50);
        return {
          body: {
            wallet: serializeWallet(wallet),
            settlements: settlements.map(serializeSettlement),
            generatedAt: isoNow(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/settlements',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const body = asObject(ctx.body);
        const wallet = getWallet(store, tenantId);
        const amountXof = requireInt(body, 'amountXof', { min: 100, max: Math.max(100, wallet.availableXof) });
        if (amountXof > wallet.availableXof) {
          throw HttpError.unprocessable('insufficient_wallet', 'Solde disponible insuffisant pour ce reversement.', {
            availableXof: wallet.availableXof,
          });
        }
        const mode = requireEnum(body, 'mode', SETTLEMENT_MODES);
        const destination = requireString(body, 'destination', { min: 3, max: 120 });
        const settlement: Settlement = {
          id: `set_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          tenantId,
          amountXof,
          mode,
          status: 'en_attente',
          destination,
          requestedBy: claims.sub,
          createdAt: isoNow(),
          approvedBy: null,
          approvedAt: null,
          note: optionalString(body, 'note', { max: 200 }) ?? null,
        };
        store.settlements.set(settlement.id, settlement);
        if (mode === 'instant') {
          bookSettlement(store, settlement, claims.sub);
          await options.publish('SettlementPaid', tenantId, {
            tenantId,
            settlementId: settlement.id,
            amountXof,
            mode,
            destination,
            at: settlement.approvedAt,
          });
        } else {
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'settlement.requested',
            targetType: 'settlement',
            targetId: settlement.id,
            meta: { amountXof, mode, destination },
          });
          await options.publish('SettlementRequested', tenantId, {
            tenantId,
            settlementId: settlement.id,
            amountXof,
            mode,
            at: settlement.createdAt,
          });
        }
        return {
          status: 201,
          body: { settlement: serializeSettlement(settlement), wallet: serializeWallet(getWallet(store, tenantId)) },
        };
      },
    },

    /* ----------------------------- Réconciliation ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/reconciliation',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const runs = store.reconciliations
          .filter((run) => run.tenantId === tenantId)
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .slice(0, 20);
        return { body: { tenantId, items: runs, generatedAt: isoNow() } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/reconciliation/run',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const body = ctx.body ? asObject(ctx.body) : {};
        const date = optionalString(body, 'date', { max: 10 }) ?? todayIso();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw HttpError.unprocessable('validation_error', 'Date attendue au format AAAA-MM-JJ.', { field: 'date' });
        }
        const injectAnomalies = boolFlag(body.injectAnomalies);
        const run = runReconciliation(store, tenantId, date, injectAnomalies, claims.sub);
        await options.publish('ReconciliationCompleted', tenantId, {
          tenantId,
          runId: run.id,
          date,
          balanced: run.balanced,
          missing: run.missingInStatement.length,
          mismatches: run.amountMismatches.length,
          orphans: run.orphanRows.length,
          at: run.createdAt,
        });
        return { status: 201, body: { run } };
      },
    },

    /* ----------------------------- Grand livre ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/ledger',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const limit = Math.min(Number(ctx.query.get('limit') ?? 100) || 100, 500);
        const entries = store.ledger.entries
          .filter((entry) => entry.tenantId === tenantId)
          .slice(-limit)
          .reverse();
        return {
          body: {
            tenantId,
            entries,
            balances: ledgerBalances(store.ledger, tenantId),
            integrity: verifyLedger(store.ledger),
            generatedAt: isoNow(),
          },
        };
      },
    },

    /* ----------------------------- Anti-fraude ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/fraud/blocks',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'payment:view');
        const items = [...store.fraudBlocks.values()]
          .filter((block) => block.tenantId === tenantId)
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .map(serializeBlock);
        return {
          body: {
            tenantId,
            items,
            limits: FRAUD_LIMITS,
            generatedAt: isoNow(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payments/fraud/blocks/:id/lift',
      handler: (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'payment:manage');
        const block = store.fraudBlocks.get(ctx.params.id ?? '');
        if (!block || block.tenantId !== tenantId) throw HttpError.notFound('Blocage introuvable.');
        if (block.liftedAt) return { body: { block: serializeBlock(block), alreadyLifted: true } };
        block.liftedAt = isoNow();
        block.liftedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'fraud.block.lifted',
          targetType: 'user',
          targetId: block.userId,
          meta: { blockId: block.id, rule: block.rule },
        });
        return { body: { block: serializeBlock(block), alreadyLifted: false } };
      },
    },

    /* ----------------------------- Exports ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/exports/transactions.csv',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:export');
        const items = filteredTransactions(store, tenantId, ctx.query);
        const csv = transactionsCsv(items);
        return {
          raw: {
            data: Buffer.from(csv, 'utf8'),
            contentType: 'text/csv; charset=utf-8',
            fileName: `transactions-${tenantId}-${todayIso()}.csv`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/exports/transactions.xls',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:export');
        const items = filteredTransactions(store, tenantId, ctx.query);
        const xml = transactionsXls(items, `Transactions ${tenantId}`);
        return {
          raw: {
            data: Buffer.from(xml, 'utf8'),
            contentType: 'application/vnd.ms-excel',
            fileName: `transactions-${tenantId}-${todayIso()}.xls`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/exports/transactions.pdf',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'report:export');
        const items = filteredTransactions(store, tenantId, ctx.query);
        let tenantName = tenantId;
        try {
          const summary = await options.deps.tenant.get<{ brandName?: string }>(`/internal/tenants/${tenantId}/summary`);
          tenantName = summary.brandName ?? tenantId;
        } catch {
          /* nom technique conservé */
        }
        const wallet = getWallet(store, tenantId);
        const pdf = await transactionsPdf(items, {
          tenantName,
          generatedAt: isoNow(),
          walletAvailableXof: wallet.availableXof,
          currency: 'XOF',
        });
        return {
          raw: {
            data: Buffer.from(pdf),
            contentType: 'application/pdf',
            fileName: `transactions-${tenantId}-${todayIso()}.pdf`,
          },
        };
      },
    },

    /* ----------------------------- Audit ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payments/audit',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'audit:view');
        const entries = store.audit.filter((entry) => entry.tenantId === tenantId);
        const scoped = verifyAuditChain(entries);
        return {
          body: {
            tenantId,
            entries: entries.slice(-200).reverse(),
            integrity: scoped,
            generatedAt: isoNow(),
          },
        };
      },
    },

    /* ----------------------------- Webhooks fournisseurs ----------------------------- */
    {
      method: 'POST',
      path: '/api/v1/webhooks/providers/:providerId',
      auth: false,
      handler: async (ctx) => {
        const providerId = ctx.params.providerId ?? '';
        const provider = getProvider(providerId);
        if (!provider) throw HttpError.notFound('Fournisseur inconnu.');
        const body = asObject(ctx.body);
        const eventId = requireString(body, 'eventId', { min: 3, max: 80 });
        const type = requireEnum(body, 'type', WEBHOOK_TYPES);
        const reference = requireString(body, 'reference', { min: 3, max: 120 });
        const amountXof = optionalInt(body, 'amountXof', { min: 0, max: 100_000_000 });
        const timestamp = String(ctx.headers['x-restohub-timestamp'] ?? '');
        const signature = String(ctx.headers['x-restohub-signature'] ?? '');
        const timestampMs = Number(timestamp);
        if (!timestamp || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
          throw new HttpError(401, 'invalid_signature', 'Horodatage de webhook absent ou expiré.');
        }
        const canonical = webhookCanonical(timestamp, eventId, type, reference, amountXof);
        const secret = options.webhookSecrets[provider.id] ?? 'whsec_sandbox';
        if (!verifySignature(secret, canonical, signature)) {
          throw new HttpError(401, 'invalid_signature', 'Signature de webhook invalide.');
        }
        const webhookKey = `${provider.id}:${eventId}`;
        if (store.webhooks.has(webhookKey)) {
          return { body: { ok: true, replayed: true } };
        }
        const transaction = [...store.transactions.values()].find(
          (candidate) => candidate.providerReference === reference,
        );
        store.webhooks.set(webhookKey, {
          eventId,
          provider: provider.id,
          type,
          reference,
          transactionId: transaction?.id ?? null,
          receivedAt: isoNow(),
          payload: body,
        });
        if (!transaction) {
          return { status: 202, body: { ok: true, accepted: false, reason: 'unknown_reference' } };
        }
        if (type === 'payment.confirmed') {
          const result = await finalizeConfirmation(options, transaction, `provider:${provider.id}`, 'webhook');
          return { body: { ok: true, transaction: serializeTransaction(transaction), ...result } };
        }
        if (type === 'payment.failed' || type === 'payment.expired') {
          await failTransaction(
            options,
            transaction,
            type === 'payment.expired' ? 'Délai fournisseur dépassé.' : 'Paiement refusé par le fournisseur.',
            `provider:${provider.id}`,
            type === 'payment.expired' ? 'expiree' : 'echouee',
          );
          return { body: { ok: true, transaction: serializeTransaction(transaction) } };
        }
        return { body: { ok: true, acknowledged: true } };
      },
    },

    /* ----------------------------- Supervision plateforme ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/platform/payments/summary',
      handler: (ctx) => {
        platformAny(ctx, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const transactions = [...store.transactions.values()];
        const confirmed = transactions.filter((transaction) => transaction.status === 'confirmee');
        const wallets = [...store.wallets.values()];
        const settlements = [...store.settlements.values()];
        const disputes = [...store.disputes.values()];
        return {
          body: {
            tenantsWithWallet: wallets.length,
            transactions: transactions.length,
            confirmedCount: confirmed.length,
            volumeXof: confirmed.reduce((sum, transaction) => sum + transaction.amountXof, 0),
            commissionXof: transactions.reduce((sum, transaction) => sum + transaction.fees.commissionXof, 0),
            providerFeesXof: transactions.reduce((sum, transaction) => sum + transaction.fees.providerFeeXof, 0),
            walletLiabilityXof: wallets.reduce((sum, wallet) => sum + wallet.availableXof, 0),
            settledXof: settlements.filter((settlement) => settlement.status === 'payee').reduce((sum, settlement) => sum + settlement.amountXof, 0),
            pendingSettlements: settlements.filter((settlement) => settlement.status === 'en_attente').length,
            openDisputes: disputes.filter((dispute) => dispute.status === 'ouverte' || dispute.status === 'en_examen').length,
            activeBlocks: [...store.fraudBlocks.values()].filter(
              (block) => !block.liftedAt && new Date(block.expiresAt).getTime() > Date.now(),
            ).length,
            ledgerIntegrity: verifyLedger(store.ledger),
            generatedAt: isoNow(),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/payments/transactions',
      handler: (ctx) => {
        platformAny(ctx, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const tenantId = ctx.query.get('tenantId') ?? '';
        const status = ctx.query.get('status') ?? '';
        const limit = Math.min(Number(ctx.query.get('limit') ?? 100) || 100, 300);
        const items = [...store.transactions.values()]
          .filter((transaction) => (tenantId ? transaction.tenantId === tenantId : true))
          .filter((transaction) => (status ? transaction.status === status : true))
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .slice(0, limit)
          .map(serializeTransaction);
        return { body: { items, count: items.length, generatedAt: isoNow() } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/payments/settlements',
      handler: (ctx) => {
        platformAny(ctx, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const status = ctx.query.get('status') ?? '';
        const items = [...store.settlements.values()]
          .filter((settlement) => (status ? settlement.status === status : true))
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .slice(0, 200)
          .map(serializeSettlement);
        return { body: { items, generatedAt: isoNow() } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/platform/payments/settlements/:id/approve',
      handler: async (ctx) => {
        const claims = requirePlatformPermission(ctx.auth, 'platform:operate');
        const settlement = store.settlements.get(ctx.params.id ?? '');
        if (!settlement) throw HttpError.notFound('Reversement introuvable.');
        if (settlement.status !== 'en_attente') throw HttpError.conflict('settlement_closed', 'Ce reversement est déjà traité.');
        const wallet = getWallet(store, settlement.tenantId);
        if (settlement.amountXof > wallet.availableXof) {
          throw HttpError.unprocessable('insufficient_wallet', 'Solde insuffisant pour approuver ce reversement.', {
            availableXof: wallet.availableXof,
          });
        }
        const body = ctx.body ? asObject(ctx.body) : {};
        settlement.note = optionalString(body, 'note', { max: 200 }) ?? settlement.note;
        bookSettlement(store, settlement, claims.sub);
        await options.publish('SettlementPaid', settlement.tenantId, {
          tenantId: settlement.tenantId,
          settlementId: settlement.id,
          amountXof: settlement.amountXof,
          mode: settlement.mode,
          at: settlement.approvedAt,
        });
        return { body: { settlement: serializeSettlement(settlement) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/platform/payments/settlements/:id/reject',
      handler: (ctx) => {
        const claims = requirePlatformPermission(ctx.auth, 'platform:operate');
        const settlement = store.settlements.get(ctx.params.id ?? '');
        if (!settlement) throw HttpError.notFound('Reversement introuvable.');
        if (settlement.status !== 'en_attente') throw HttpError.conflict('settlement_closed', 'Ce reversement est déjà traité.');
        const body = asObject(ctx.body);
        const reason = requireString(body, 'reason', { min: 3, max: 200 });
        settlement.status = 'rejetee';
        settlement.note = reason;
        settlement.approvedBy = claims.sub;
        settlement.approvedAt = isoNow();
        store.recordAudit({
          tenantId: settlement.tenantId,
          actorId: claims.sub,
          action: 'settlement.rejected',
          targetType: 'settlement',
          targetId: settlement.id,
          meta: { amountXof: settlement.amountXof, reason },
        });
        return { body: { settlement: serializeSettlement(settlement) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/payments/disputes',
      handler: (ctx) => {
        platformAny(ctx, ['platform:disputes:manage', 'platform:operate', 'platform:logs:view']);
        const status = ctx.query.get('status') ?? '';
        const items = [...store.disputes.values()]
          .filter((dispute) => (status ? dispute.status === status : true))
          .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
          .slice(0, 200)
          .map(serializeDispute);
        return { body: { items, generatedAt: isoNow() } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/platform/payments/disputes',
      handler: async (ctx) => {
        const claims = requirePlatformPermission(ctx.auth, 'platform:disputes:manage');
        const body = asObject(ctx.body);
        const tenantId = requireString(body, 'tenantId', { max: 60 });
        const transactionId = requireString(body, 'transactionId', { max: 60 });
        const transaction = requireTransaction(store, tenantId, transactionId);
        const dispute: Dispute = {
          id: `dsp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          tenantId,
          transactionId,
          reason: requireString(body, 'reason', { min: 3, max: 120 }),
          description: requireString(body, 'description', { min: 3, max: 1000 }),
          status: 'ouverte',
          openedBy: claims.sub,
          createdAt: isoNow(),
          resolution: null,
          resolvedBy: null,
          resolvedAt: null,
          refundId: null,
        };
        store.disputes.set(dispute.id, dispute);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'dispute.opened',
          targetType: 'transaction',
          targetId: transaction.id,
          meta: { disputeId: dispute.id, reason: dispute.reason },
        });
        await options.publish('DisputeOpened', tenantId, {
          tenantId,
          disputeId: dispute.id,
          transactionId,
          reason: dispute.reason,
          at: dispute.createdAt,
        });
        return { status: 201, body: { dispute: serializeDispute(dispute) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/platform/payments/disputes/:id/resolve',
      handler: async (ctx) => {
        const claims = requirePlatformPermission(ctx.auth, 'platform:disputes:manage');
        const dispute = store.disputes.get(ctx.params.id ?? '');
        if (!dispute) throw HttpError.notFound('Litige introuvable.');
        if (dispute.status === 'resolue' || dispute.status === 'rejetee') {
          throw HttpError.conflict('dispute_closed', 'Ce litige est déjà clos.');
        }
        const body = asObject(ctx.body);
        const outcome = requireEnum(body, 'outcome', ['acceptee', 'rejetee'] as const);
        const note = optionalString(body, 'note', { max: 500 });
        const refundAmount = optionalInt(body, 'refundAmountXof', { min: 1, max: 10_000_000 });
        if (outcome === 'acceptee' && refundAmount) {
          const transaction = requireTransaction(store, dispute.tenantId, dispute.transactionId);
          const refund = await applyRefund(options, transaction, refundAmount, `Litige ${dispute.id} : ${note ?? 'accepté'}`, claims.sub);
          dispute.refundId = refund.id;
        }
        dispute.status = outcome === 'acceptee' ? 'resolue' : 'rejetee';
        dispute.resolution = note ?? (outcome === 'acceptee' ? 'Litige accepté.' : 'Litige rejeté.');
        dispute.resolvedBy = claims.sub;
        dispute.resolvedAt = isoNow();
        store.recordAudit({
          tenantId: dispute.tenantId,
          actorId: claims.sub,
          action: 'dispute.resolved',
          targetType: 'transaction',
          targetId: dispute.transactionId,
          meta: { disputeId: dispute.id, outcome, note, refundId: dispute.refundId },
        });
        await options.publish('DisputeResolved', dispute.tenantId, {
          tenantId: dispute.tenantId,
          disputeId: dispute.id,
          transactionId: dispute.transactionId,
          outcome,
          refundId: dispute.refundId,
          at: dispute.resolvedAt,
        });
        return { body: { dispute: serializeDispute(dispute) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/platform/payments/ledger',
      handler: (ctx) => {
        platformAny(ctx, ['platform:logs:view', 'platform:operate', 'platform:disputes:manage']);
        return {
          body: {
            entries: store.ledger.entries.slice(-200).reverse(),
            balances: ledgerBalances(store.ledger),
            integrity: verifyLedger(store.ledger),
            generatedAt: isoNow(),
          },
        };
      },
    },

    /* ----------------------------- Interne ----------------------------- */
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/payments/disbursements',
      service: true,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const body = asObject(ctx.body);
        const reference = requireString(body, 'reference', { max: 80 });
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0 || items.length > 200) {
          throw HttpError.unprocessable('validation_error', 'Le décaissement doit contenir 1 à 200 lignes.', { field: 'items' });
        }
        const lines = items.map((item, index) => {
          const line = asObject(item);
          const amountXof = line.amountXof;
          if (typeof amountXof !== 'number' || !Number.isInteger(amountXof) || amountXof <= 0) {
            throw HttpError.unprocessable('validation_error', 'Montant de ligne invalide.', { field: `items[${index}].amountXof` });
          }
          const employeeId = optionalString(line, 'employeeId', { max: 60 }) ?? `line-${index + 1}`;
          const destination = optionalString(line, 'destination', { max: 120 }) ?? 'mobile_money';
          return { employeeId, label: optionalString(line, 'label', { max: 120 }) ?? employeeId, amountXof, destination };
        });
        const totalXof = lines.reduce((sum, line) => sum + line.amountXof, 0);
        const wallet = getWallet(store, tenantId);
        if (totalXof > wallet.availableXof) {
          throw HttpError.unprocessable('wallet_insufficient', 'Solde du portefeuille insuffisant pour ce décaissement.', {
            availableXof: wallet.availableXof,
            requestedXof: totalXof,
          });
        }
        const memo = optionalString(body, 'memo', { max: 140 });
        const updated = bookDisbursement(store, { tenantId, reference, totalXof, memo });
        const actorId = typeof body.approvedBy === 'string' && body.approvedBy ? body.approvedBy : 'payroll-service';
        store.recordAudit({
          tenantId,
          actorId,
          action: 'payment.disbursement.paid',
          targetType: 'disbursement',
          targetId: reference,
          meta: { totalXof, lines: lines.length },
        });
        await options.publish('DisbursementPaid', tenantId, {
          tenantId,
          reference,
          totalXof,
          lines: lines.length,
          at: isoNow(),
        });
        return {
          body: {
            batch: {
              reference,
              status: 'reussi',
              totalXof,
              lines: lines.map((line) => ({
                employeeId: line.employeeId,
                label: line.label,
                amountXof: line.amountXof,
                destination: line.destination,
                status: 'paye',
              })),
              paidAt: isoNow(),
            },
            wallet: serializeWallet(updated),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/payments/summary',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const wallet = getWallet(store, tenantId);
        const transactions = [...store.transactions.values()].filter((transaction) => transaction.tenantId === tenantId);
        const confirmed = transactions.filter((transaction) => transaction.status === 'confirmee');
        return {
          body: {
            tenantId,
            wallet: serializeWallet(wallet),
            transactions: transactions.length,
            confirmed: confirmed.length,
            volumeXof: confirmed.reduce((sum, transaction) => sum + transaction.amountXof, 0),
            commissionXof: transactions.reduce((sum, transaction) => sum + transaction.fees.commissionXof, 0),
            providerFeesXof: transactions.reduce((sum, transaction) => sum + transaction.fees.providerFeeXof, 0),
            pendingSettlements: [...store.settlements.values()].filter(
              (settlement) => settlement.tenantId === tenantId && settlement.status === 'en_attente',
            ).length,
            lastReconciliation: store.reconciliations
              .filter((run) => run.tenantId === tenantId)
              .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0] ?? null,
            generatedAt: isoNow(),
          },
        };
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Consommation d'événements (caisse)                                  */
/* ------------------------------------------------------------------ */

export function handlePaymentEvent(store: PaymentStore, tenantId: string, event: { type: string; payload: Record<string, unknown> }): void {
  if (event.type !== 'OrderPaid') return;
  const orderId = typeof event.payload.orderId === 'string' ? event.payload.orderId : '';
  if (!orderId) return;
  const amountXof = typeof event.payload.totalXof === 'number'
    ? event.payload.totalXof
    : typeof event.payload.amountXof === 'number'
      ? event.payload.amountXof
      : 0;
  if (amountXof <= 0) return;
  const at = typeof event.payload.at === 'string' ? event.payload.at : isoNow();
  const number = typeof event.payload.number === 'string' ? event.payload.number : orderId;
  const alreadyProvider = [...store.transactions.values()].some(
    (transaction) => transaction.tenantId === tenantId && transaction.orderId === orderId && transaction.source === 'agregateur',
  );
  if (alreadyProvider) return;
  const method = event.payload.method === 'mobile_money' || event.payload.method === 'carte' ? event.payload.method : 'especes';
  if (method !== 'especes') return;
  const exists = [...store.transactions.values()].some(
    (transaction) => transaction.tenantId === tenantId && transaction.source === 'caisse' && transaction.orderNumber === number,
  );
  if (exists) return;
  const transaction: PaymentTransaction = {
    id: `txn_cash_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    tenantId,
    orderId,
    orderNumber: number,
    amountXof,
    method: 'especes',
    provider: 'caisse',
    providerReference: `CASH-${number}`,
    status: 'confirmee',
    source: 'caisse',
    splitId: null,
    customerPhone: null,
    customerName: null,
    note: 'Encaissement caisse (miroir comptable)',
    fees: { providerFeeXof: 0, commissionXof: 0, commissionPercent: 0, netXof: 0 },
    refunds: [],
    refundedXof: 0,
    tipXof: 0,
    tipAllocations: [],
    routing: { chosen: 'caisse', reason: 'encaissement au comptoir', switched: false, candidates: [] },
    instructions: '',
    requires3ds: false,
    threeDsUrl: null,
    actorId: 'order-service',
    simulated: false,
    invoiceNumber: typeof event.payload.invoiceNumber === 'string' ? event.payload.invoiceNumber : null,
    failureReason: null,
    createdAt: at,
    updatedAt: at,
    confirmedAt: at,
  };
  store.transactions.set(transaction.id, transaction);
  bookCashIncome(store, tenantId, `CASH-${number}`, amountXof, at);
}
