import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';
import { appendEntry, createLedger, type Ledger } from './ledger.js';
import { getProvider, type PaymentMethod, type ProviderId, type RoutingDecision } from './providers.js';

export const TRANSACTION_STATUSES = [
  'en_attente',
  'confirmee',
  'echouee',
  'expiree',
  'annulee',
  'remboursee_partielle',
  'remboursee',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type TransactionSource = 'agregateur' | 'caisse';
export type TransactionMethod = PaymentMethod | 'especes';
export type TransactionProvider = ProviderId | 'caisse';
export const SETTLEMENT_MODES = ['instant', 'batch'] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];
export const SETTLEMENT_STATUSES = ['en_attente', 'payee', 'rejetee'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const DISPUTE_STATUSES = ['ouverte', 'en_examen', 'resolue', 'rejetee'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Commission plateforme par plan d'abonnement (%). */
export const PLAN_COMMISSION: Record<string, number> = {
  starter: 2.5,
  pro: 1.8,
  enterprise: 1.2,
};

export interface FeeBreakdown {
  providerFeeXof: number;
  commissionXof: number;
  commissionPercent: number;
  netXof: number;
}

export interface RoutingSnapshot {
  chosen: string;
  reason: string;
  switched: boolean;
  candidates: Array<{ provider: string; label: string; feeXof: number; available: boolean }>;
}

export interface RefundRecord {
  id: string;
  amountXof: number;
  reason: string;
  by: string;
  at: string;
  providerReference: string;
}

export interface TipAllocation {
  staffId: string;
  amountXof: number;
}

export interface PaymentTransaction {
  id: string;
  tenantId: string;
  orderId: string | null;
  orderNumber: string | null;
  amountXof: number;
  method: TransactionMethod;
  provider: TransactionProvider;
  providerReference: string;
  status: TransactionStatus;
  source: TransactionSource;
  splitId: string | null;
  customerPhone: string | null;
  customerName: string | null;
  note: string | null;
  fees: FeeBreakdown;
  refunds: RefundRecord[];
  refundedXof: number;
  tipXof: number;
  tipAllocations: TipAllocation[];
  routing: RoutingSnapshot;
  instructions: string;
  requires3ds: boolean;
  threeDsUrl: string | null;
  actorId: string;
  simulated: boolean;
  invoiceNumber: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface Wallet {
  tenantId: string;
  availableXof: number;
  lifetimeNetXof: number;
  settledXof: number;
  updatedAt: string;
}

export interface Settlement {
  id: string;
  tenantId: string;
  amountXof: number;
  mode: SettlementMode;
  status: SettlementStatus;
  destination: string;
  requestedBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
}

export interface ReconciliationRun {
  id: string;
  tenantId: string;
  date: string;
  createdAt: string;
  statementRows: number;
  matched: number;
  missingInStatement: string[];
  amountMismatches: Array<{ reference: string; platformXof: number; statementXof: number }>;
  orphanRows: Array<{ provider: string; reference: string; amountXof: number }>;
  balanced: boolean;
  actorId: string;
}

export interface FraudBlock {
  id: string;
  tenantId: string;
  userId: string;
  scope: 'utilisateur' | 'etablissement';
  rule: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
}

export interface Dispute {
  id: string;
  tenantId: string;
  transactionId: string;
  reason: string;
  description: string;
  status: DisputeStatus;
  openedBy: string;
  createdAt: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  refundId: string | null;
}

export interface WebhookEvent {
  eventId: string;
  provider: string;
  type: string;
  reference: string;
  transactionId: string | null;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface SplitGroup {
  id: string;
  tenantId: string;
  orderId: string;
  totalXof: number;
  tipXof: number;
  parts: Array<{ transactionId: string; label: string; amountXof: number }>;
  createdAt: string;
}

export interface PaymentStore {
  transactions: Map<string, PaymentTransaction>;
  splits: Map<string, SplitGroup>;
  wallets: Map<string, Wallet>;
  settlements: Map<string, Settlement>;
  webhooks: Map<string, WebhookEvent>;
  reconciliations: ReconciliationRun[];
  fraudBlocks: Map<string, FraudBlock>;
  disputes: Map<string, Dispute>;
  audit: AuditEntry[];
  ledger: Ledger;
  providerHealth: Record<string, 'up' | 'down'>;
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export function createPaymentStore(): PaymentStore {
  const store: PaymentStore = {
    transactions: new Map(),
    splits: new Map(),
    wallets: new Map(),
    settlements: new Map(),
    webhooks: new Map(),
    reconciliations: [],
    fraudBlocks: new Map(),
    disputes: new Map(),
    audit: [],
    ledger: createLedger(),
    providerHealth: {},
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
  };
  return store;
}

export function getWallet(store: PaymentStore, tenantId: string): Wallet {
  const existing = store.wallets.get(tenantId);
  if (existing) return existing;
  const wallet: Wallet = {
    tenantId,
    availableXof: 0,
    lifetimeNetXof: 0,
    settledXof: 0,
    updatedAt: nowIso(),
  };
  store.wallets.set(tenantId, wallet);
  return wallet;
}

export function feeBreakdown(amountXof: number, providerFeeXof: number, plan: string): FeeBreakdown {
  const commissionPercent = PLAN_COMMISSION[plan] ?? PLAN_COMMISSION.pro;
  const commissionXof = Math.round((amountXof * commissionPercent) / 100);
  return {
    providerFeeXof,
    commissionXof,
    commissionPercent,
    netXof: Math.max(0, amountXof - providerFeeXof - commissionXof),
  };
}

export function routingSnapshot(decision: RoutingDecision): RoutingSnapshot {
  return {
    chosen: decision.chosen?.id ?? '',
    reason: decision.reason,
    switched: decision.switched,
    candidates: decision.candidates.map((candidate) => ({
      provider: candidate.provider,
      label: candidate.label,
      feeXof: candidate.feeXof,
      available: candidate.available,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Écritures comptables                                                */
/* ------------------------------------------------------------------ */

export function bookConfirmation(store: PaymentStore, transaction: PaymentTransaction): void {
  const { amountXof, fees } = transaction;
  appendEntry(store.ledger, {
    tenantId: transaction.tenantId,
    at: transaction.confirmedAt ?? nowIso(),
    memo: `Encaissement ${transaction.providerReference}`,
    reference: transaction.id,
    lines: [
      { account: 'provider_receivable', label: `Créance ${transaction.provider}`, debitXof: amountXof, creditXof: 0 },
      { account: 'provider_fee_payable', label: 'Frais fournisseur à régler', debitXof: 0, creditXof: fees.providerFeeXof },
      { account: 'tenant_wallet', label: 'Net établissement', debitXof: 0, creditXof: fees.netXof },
      { account: 'platform_commission', label: `Commission ${fees.commissionPercent} %`, debitXof: 0, creditXof: fees.commissionXof },
    ],
  });
  const wallet = getWallet(store, transaction.tenantId);
  wallet.availableXof += fees.netXof;
  wallet.lifetimeNetXof += fees.netXof;
  wallet.updatedAt = nowIso();
}

export function bookRefund(
  store: PaymentStore,
  transaction: PaymentTransaction,
  refund: RefundRecord,
): void {
  const share = refund.amountXof / transaction.amountXof;
  const reverseNet = Math.round(transaction.fees.netXof * share);
  const reverseCommission = Math.round(transaction.fees.commissionXof * share);
  const feeShare = refund.amountXof - reverseNet - reverseCommission;
  appendEntry(store.ledger, {
    tenantId: transaction.tenantId,
    at: refund.at,
    memo: `Remboursement ${refund.id}`,
    reference: transaction.id,
    lines: [
      { account: 'tenant_wallet', label: 'Net repris', debitXof: reverseNet, creditXof: 0 },
      { account: 'platform_commission', label: 'Commission reprise', debitXof: reverseCommission, creditXof: 0 },
      { account: 'refund_clearing', label: 'Frais fournisseur non récupérés', debitXof: feeShare, creditXof: 0 },
      { account: 'provider_refund_payable', label: 'Remboursement à reverser', debitXof: 0, creditXof: refund.amountXof },
    ],
  });
  const wallet = getWallet(store, transaction.tenantId);
  wallet.availableXof -= reverseNet;
  wallet.lifetimeNetXof -= reverseNet;
  wallet.updatedAt = nowIso();
}

export function bookSettlement(store: PaymentStore, settlement: Settlement, actorId: string): void {
  const at = nowIso();
  appendEntry(store.ledger, {
    tenantId: settlement.tenantId,
    at,
    memo: `Reversement ${settlement.id}`,
    reference: settlement.id,
    lines: [
      { account: 'tenant_wallet', label: 'Net reversé', debitXof: settlement.amountXof, creditXof: 0 },
      { account: 'cash', label: 'Paiement établissement', debitXof: 0, creditXof: settlement.amountXof },
    ],
  });
  const wallet = getWallet(store, settlement.tenantId);
  wallet.availableXof -= settlement.amountXof;
  wallet.settledXof += settlement.amountXof;
  wallet.updatedAt = at;
  settlement.status = 'payee';
  settlement.approvedBy = actorId;
  settlement.approvedAt = at;
  store.recordAudit({
    tenantId: settlement.tenantId,
    actorId,
    action: 'settlement.paid',
    targetType: 'settlement',
    targetId: settlement.id,
    meta: { amountXof: settlement.amountXof, mode: settlement.mode, destination: settlement.destination },
  });
}

export function bookDisbursement(
  store: PaymentStore,
  input: { tenantId: string; reference: string; totalXof: number; memo?: string },
): Wallet {
  const at = nowIso();
  const wallet = getWallet(store, input.tenantId);
  appendEntry(store.ledger, {
    tenantId: input.tenantId,
    at,
    memo: input.memo ?? `Décaissement ${input.reference}`,
    reference: input.reference,
    lines: [
      { account: 'tenant_wallet', label: 'Décaissement portefeuille', debitXof: input.totalXof, creditXof: 0 },
      { account: 'salary_payable', label: 'Salaires/payouts à régler', debitXof: 0, creditXof: input.totalXof },
    ],
  });
  wallet.availableXof -= input.totalXof;
  wallet.updatedAt = at;
  return wallet;
}

export function bookCashIncome(
  store: PaymentStore,
  tenantId: string,
  reference: string,
  amountXof: number,
  at: string,
): void {
  appendEntry(store.ledger, {
    tenantId,
    at,
    memo: `Encaissement caisse ${reference}`,
    reference,
    lines: [
      { account: 'cash', label: 'Caisse espèces', debitXof: amountXof, creditXof: 0 },
      { account: 'sales', label: 'Ventes encaissées', debitXof: 0, creditXof: amountXof },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Réconciliation                                                      */
/* ------------------------------------------------------------------ */

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

interface StatementRow {
  provider: string;
  reference: string;
  amountXof: number;
  netXof: number;
}

/** Génère le relevé fournisseur (sandbox), puis le compare à nos écritures. */
export function runReconciliation(
  store: PaymentStore,
  tenantId: string,
  date: string,
  injectAnomalies: boolean,
  actorId: string,
): ReconciliationRun {
  const confirmed = [...store.transactions.values()].filter(
    (transaction) =>
      transaction.tenantId === tenantId &&
      transaction.source === 'agregateur' &&
      transaction.confirmedAt !== null &&
      dayOf(transaction.confirmedAt) === date,
  );
  const statement: StatementRow[] = confirmed.map((transaction) => ({
    provider: transaction.provider,
    reference: transaction.providerReference,
    amountXof: transaction.amountXof,
    netXof: transaction.fees.netXof,
  }));

  if (injectAnomalies && statement.length > 0) {
    statement.shift();
    if (statement.length > 0) statement[0] = { ...statement[0], amountXof: statement[0].amountXof + 500 };
    statement.push({ provider: 'tmoney', reference: `ORPHAN_${date.replace(/-/g, '')}`, amountXof: 7500, netXof: 7387 });
  }

  const byReference = new Map(confirmed.map((transaction) => [transaction.providerReference, transaction]));
  const missingInStatement = confirmed
    .filter((transaction) => !statement.some((row) => row.reference === transaction.providerReference))
    .map((transaction) => transaction.providerReference);
  const amountMismatches: ReconciliationRun['amountMismatches'] = [];
  const orphanRows: ReconciliationRun['orphanRows'] = [];
  let matched = 0;
  for (const row of statement) {
    const transaction = byReference.get(row.reference);
    if (!transaction) {
      orphanRows.push({ provider: row.provider, reference: row.reference, amountXof: row.amountXof });
      continue;
    }
    if (row.amountXof !== transaction.amountXof) {
      amountMismatches.push({
        reference: row.reference,
        platformXof: transaction.amountXof,
        statementXof: row.amountXof,
      });
    } else {
      matched += 1;
    }
  }
  const run: ReconciliationRun = {
    id: newId('rec'),
    tenantId,
    date,
    createdAt: nowIso(),
    statementRows: statement.length,
    matched,
    missingInStatement,
    amountMismatches,
    orphanRows,
    balanced: missingInStatement.length === 0 && amountMismatches.length === 0 && orphanRows.length === 0,
    actorId,
  };
  store.reconciliations.push(run);
  store.recordAudit({
    tenantId,
    actorId,
    action: 'reconciliation.run',
    targetType: 'reconciliation',
    targetId: run.id,
    meta: { date, balanced: run.balanced, missing: missingInStatement.length, mismatches: amountMismatches.length, orphan: orphanRows.length },
  });
  return run;
}

/* ------------------------------------------------------------------ */
/* Anti-fraude                                                         */
/* ------------------------------------------------------------------ */

export const FRAUD_LIMITS = {
  maxAmountXof: 500_000,
  velocityWindowMs: 10 * 60 * 1000,
  velocityMax: 5,
  failureWindowMs: 15 * 60 * 1000,
  failureMax: 3,
  blockMs: 15 * 60 * 1000,
};

export function activeBlock(store: PaymentStore, tenantId: string, userId: string): FraudBlock | null {
  const now = Date.now();
  for (const block of store.fraudBlocks.values()) {
    if (block.tenantId !== tenantId || block.userId !== userId) continue;
    if (block.liftedAt) continue;
    if (new Date(block.expiresAt).getTime() <= now) continue;
    return block;
  }
  return null;
}

export function raiseBlock(
  store: PaymentStore,
  input: { tenantId: string; userId: string; rule: string; reason: string; durationMs?: number },
): FraudBlock {
  const now = new Date();
  const block: FraudBlock = {
    id: newId('blk'),
    tenantId: input.tenantId,
    userId: input.userId,
    scope: 'utilisateur',
    rule: input.rule,
    reason: input.reason,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.durationMs ?? FRAUD_LIMITS.blockMs)).toISOString(),
    liftedAt: null,
    liftedBy: null,
  };
  store.fraudBlocks.set(block.id, block);
  store.recordAudit({
    tenantId: input.tenantId,
    actorId: 'payment-service',
    action: 'fraud.blocked',
    targetType: 'user',
    targetId: input.userId,
    meta: { rule: input.rule, reason: input.reason, expiresAt: block.expiresAt },
  });
  return block;
}

export function isProviderDown(store: PaymentStore, provider: string): boolean {
  return store.providerHealth[provider] === 'down';
}

/* ------------------------------------------------------------------ */
/* Sérialisation                                                       */
/* ------------------------------------------------------------------ */

export function serializeTransaction(transaction: PaymentTransaction) {
  return {
    id: transaction.id,
    tenantId: transaction.tenantId,
    orderId: transaction.orderId,
    orderNumber: transaction.orderNumber,
    amountXof: transaction.amountXof,
    method: transaction.method,
    provider: transaction.provider,
    providerLabel: getProvider(transaction.provider)?.label ?? transaction.provider,
    providerReference: transaction.providerReference,
    status: transaction.status,
    source: transaction.source,
    splitId: transaction.splitId,
    customerPhone: transaction.customerPhone,
    customerName: transaction.customerName,
    note: transaction.note,
    fees: transaction.fees,
    refunds: transaction.refunds,
    refundedXof: transaction.refundedXof,
    refundableXof: Math.max(0, transaction.amountXof - transaction.refundedXof),
    tipXof: transaction.tipXof,
    tipAllocations: transaction.tipAllocations,
    routing: transaction.routing,
    instructions: transaction.instructions,
    requires3ds: transaction.requires3ds,
    threeDsUrl: transaction.threeDsUrl,
    simulated: transaction.simulated,
    invoiceNumber: transaction.invoiceNumber,
    failureReason: transaction.failureReason,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    confirmedAt: transaction.confirmedAt,
  };
}

export function serializeWallet(wallet: Wallet) {
  return {
    tenantId: wallet.tenantId,
    currency: 'XOF',
    availableXof: wallet.availableXof,
    lifetimeNetXof: wallet.lifetimeNetXof,
    settledXof: wallet.settledXof,
    updatedAt: wallet.updatedAt,
  };
}

export function serializeSettlement(settlement: Settlement) {
  return {
    id: settlement.id,
    tenantId: settlement.tenantId,
    amountXof: settlement.amountXof,
    mode: settlement.mode,
    status: settlement.status,
    destination: settlement.destination,
    requestedBy: settlement.requestedBy,
    createdAt: settlement.createdAt,
    approvedBy: settlement.approvedBy,
    approvedAt: settlement.approvedAt,
    note: settlement.note,
  };
}

export function serializeDispute(dispute: Dispute) {
  return {
    id: dispute.id,
    tenantId: dispute.tenantId,
    transactionId: dispute.transactionId,
    reason: dispute.reason,
    description: dispute.description,
    status: dispute.status,
    openedBy: dispute.openedBy,
    createdAt: dispute.createdAt,
    resolution: dispute.resolution,
    resolvedBy: dispute.resolvedBy,
    resolvedAt: dispute.resolvedAt,
    refundId: dispute.refundId,
  };
}

export function serializeBlock(block: FraudBlock) {
  return {
    id: block.id,
    tenantId: block.tenantId,
    userId: block.userId,
    scope: block.scope,
    rule: block.rule,
    reason: block.reason,
    createdAt: block.createdAt,
    expiresAt: block.expiresAt,
    active: !block.liftedAt && new Date(block.expiresAt).getTime() > Date.now(),
    liftedAt: block.liftedAt,
    liftedBy: block.liftedBy,
  };
}

export function serializeSplit(store: PaymentStore, split: SplitGroup) {
  const parts = split.parts.map((part) => {
    const transaction = store.transactions.get(part.transactionId);
    return {
      label: part.label,
      amountXof: part.amountXof,
      transactionId: part.transactionId,
      status: transaction?.status ?? 'en_attente',
      provider: transaction?.provider ?? null,
    };
  });
  const confirmedParts = parts.filter((part) => part.status === 'confirmee' || part.status === 'remboursee_partielle' || part.status === 'remboursee').length;
  const failedParts = parts.filter((part) => part.status === 'echouee' || part.status === 'expiree' || part.status === 'annulee').length;
  const status = confirmedParts === parts.length ? 'confirmee' : failedParts > 0 ? 'echec_partiel' : 'en_attente';
  return {
    id: split.id,
    tenantId: split.tenantId,
    orderId: split.orderId,
    totalXof: split.totalXof,
    tipXof: split.tipXof,
    status,
    confirmedXof: parts.filter((part) => part.status === 'confirmee').reduce((sum, part) => sum + part.amountXof, 0),
    parts,
    createdAt: split.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Données de démonstration                                            */
/* ------------------------------------------------------------------ */

export function seedPaymentDemo(store: PaymentStore, tenantId = 'tnt_sahelgrill'): void {
  if (store.transactions.size > 0) return;
  const now = Date.now();

  const seed = (
    amountXof: number,
    providerId: ProviderId,
    method: PaymentMethod,
    daysAgo: number,
    orderNumber: string,
    plan: string,
  ) => {
    const provider = getProvider(providerId);
    if (!provider) return;
    const quote = provider.quote(amountXof);
    const fees = feeBreakdown(amountXof, quote.feeXof, plan);
    const at = new Date(now - daysAgo * 24 * 3600 * 1000).toISOString();
    const initiated = provider.initiate({ intentId: newId('seed'), amountXof, method });
    const transaction: PaymentTransaction = {
      id: newId('txn'),
      tenantId,
      orderId: null,
      orderNumber,
      amountXof,
      method,
      provider: providerId,
      providerReference: initiated.reference,
      status: 'confirmee',
      source: 'agregateur',
      splitId: null,
      customerPhone: null,
      customerName: null,
      note: 'Démonstration',
      fees,
      refunds: [],
      refundedXof: 0,
      tipXof: 0,
      tipAllocations: [],
      routing: {
        chosen: providerId,
        reason: 'données de démonstration',
        switched: false,
        candidates: [{ provider: providerId, label: provider.label, feeXof: quote.feeXof, available: true }],
      },
      instructions: initiated.instructions,
      requires3ds: false,
      threeDsUrl: null,
      actorId: 'demo-seed',
      simulated: true,
      invoiceNumber: null,
      failureReason: null,
      createdAt: at,
      updatedAt: at,
      confirmedAt: at,
    };
    store.transactions.set(transaction.id, transaction);
    bookConfirmation(store, transaction);
  };

  seed(12_500, 'tmoney', 'mobile_money', 2, 'CMD-2026-000004', 'pro');
  seed(8_000, 'cinetpay', 'mobile_money', 1, 'CMD-2026-000006', 'pro');
  seed(4_000, 'moov_money', 'mobile_money', 0, 'CMD-2026-000007', 'pro');

  const paid: Settlement = {
    id: newId('set'),
    tenantId,
    amountXof: 10_000,
    mode: 'instant',
    status: 'en_attente',
    destination: 'TMoney 90 00 00 00',
    requestedBy: 'demo-seed',
    createdAt: new Date(now - 24 * 3600 * 1000).toISOString(),
    approvedBy: null,
    approvedAt: null,
    note: null,
  };
  store.settlements.set(paid.id, paid);
  bookSettlement(store, paid, 'demo-seed');

  const batch: Settlement = {
    id: newId('set'),
    tenantId,
    amountXof: 5_000,
    mode: 'batch',
    status: 'en_attente',
    destination: 'Compte bancaire principal',
    requestedBy: 'demo-seed',
    createdAt: new Date(now - 3 * 3600 * 1000).toISOString(),
    approvedBy: null,
    approvedAt: null,
    note: 'Lot hebdomadaire',
  };
  store.settlements.set(batch.id, batch);
}
