import {
  buildAuditEntry,
  newId,
  nowIso,
  verifyAuditChain,
  type AuditEntry,
  type EventEnvelope,
} from '@resto-hub/service-kit';

export type PlatformPlan = 'starter' | 'pro' | 'enterprise';
export type DirectoryStatus = 'active' | 'suspended';

export const PLAN_PRICES_XOF: Record<PlatformPlan, number> = {
  starter: 15000,
  pro: 35000,
  enterprise: 75000,
};

export interface DirectoryEntry {
  tenantId: string;
  brandName: string;
  slug: string;
  plan: PlatformPlan;
  status: DirectoryStatus;
  city: string | null;
  trial: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LedgerKind = 'payment' | 'refund' | 'failed' | 'settlement' | 'subscription';

export interface TransactionEntry {
  id: string;
  tenantId: string;
  kind: LedgerKind;
  reference: string;
  amountXof: number;
  method: string | null;
  provider: string | null;
  at: string;
}

export interface CommissionEntry {
  id: string;
  tenantId: string;
  transactionId: string;
  reference: string;
  amountXof: number;
  commissionXof: number;
  netXof: number;
  method: string;
  provider: string;
  at: string;
}

export interface DisputeProjection {
  id: string;
  tenantId: string;
  transactionId: string;
  reason: string;
  status: 'open' | 'resolved';
  openedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface ServiceSample {
  at: string;
  ok: boolean;
  latencyMs: number;
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: 'up' | 'down' | 'unknown';
  latencyMs: number;
  lastCheckAt: string | null;
  consecutiveFailures: number;
  checks: number;
  failures: number;
  samples: ServiceSample[];
}

export interface PlatformAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  service: string;
  code: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface TechnicalLog {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  meta: Record<string, unknown> | null;
  at: string;
}

export interface CountrySetting {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  active: boolean;
  defaultTaxCode: string;
}

export interface TaxSetting {
  code: string;
  name: string;
  ratePct: number;
  scope: 'sales' | 'payroll' | 'service';
  active: boolean;
}

export interface ProviderSetting {
  code: string;
  name: string;
  enabled: boolean;
  currencies: string[];
  channels: string[];
  priority: number;
}

export interface PlatformSettings {
  languages: Array<'fr' | 'en'>;
  defaultLanguage: 'fr' | 'en';
  currency: 'XOF';
  timezone: string;
  supportEmail: string;
  supportPhone: string;
  countries: CountrySetting[];
  taxes: TaxSetting[];
  providers: ProviderSetting[];
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformMetrics {
  eventsReceived: number;
  eventsByType: Record<string, number>;
  pendingApplications: number;
  approvedApplications: number;
  rejectedApplications: number;
  recentEvents: Array<{ type: string; at: string }>;
}

export interface PlatformAdminStore {
  directory: Map<string, DirectoryEntry>;
  transactions: TransactionEntry[];
  commissions: CommissionEntry[];
  disputes: Map<string, DisputeProjection>;
  services: Map<string, ServiceHealth>;
  alerts: Map<string, PlatformAlert>;
  logs: TechnicalLog[];
  settings: PlatformSettings;
  audit: AuditEntry[];
  metrics: PlatformMetrics;
  handledEvents: Set<string>;
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
  log(
    level: TechnicalLog['level'],
    service: string,
    message: string,
    meta?: Record<string, unknown> | null,
  ): TechnicalLog;
  raiseAlert(input: {
    severity: PlatformAlert['severity'];
    service: string;
    code: string;
    message: string;
  }): PlatformAlert;
  registerService(name: string, url: string): void;
}

const LOG_LIMIT = 800;
const SAMPLE_LIMIT = 40;

export function createPlatformAdminStore(): PlatformAdminStore {
  const store: PlatformAdminStore = {
    directory: new Map(),
    transactions: [],
    commissions: [],
    disputes: new Map(),
    services: new Map(),
    alerts: new Map(),
    logs: [],
    settings: defaultSettings(),
    audit: [],
    metrics: {
      eventsReceived: 0,
      eventsByType: {},
      pendingApplications: 0,
      approvedApplications: 0,
      rejectedApplications: 0,
      recentEvents: [],
    },
    handledEvents: new Set(),
    recordAudit(input) {
      const previous = store.audit[store.audit.length - 1];
      const entry = buildAuditEntry({ ...input, previousHash: previous?.hash });
      store.audit.push(entry);
      return entry;
    },
    log(level, service, message, meta) {
      const entry: TechnicalLog = {
        id: newId('log'),
        level,
        service,
        message,
        meta: meta ?? null,
        at: nowIso(),
      };
      store.logs.push(entry);
      if (store.logs.length > LOG_LIMIT) store.logs.splice(0, store.logs.length - LOG_LIMIT);
      return entry;
    },
    raiseAlert(input) {
      const existing = [...store.alerts.values()].find(
        (alert) =>
          alert.status !== 'resolved' &&
          alert.code === input.code &&
          alert.service === input.service,
      );
      if (existing) return existing;
      const alert: PlatformAlert = {
        id: newId('alr'),
        severity: input.severity,
        service: input.service,
        code: input.code,
        message: input.message,
        status: 'open',
        createdAt: nowIso(),
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null,
      };
      store.alerts.set(alert.id, alert);
      return alert;
    },
    registerService(name, url) {
      if (store.services.has(name)) return;
      store.services.set(name, {
        name,
        url,
        status: 'unknown',
        latencyMs: 0,
        lastCheckAt: null,
        consecutiveFailures: 0,
        checks: 0,
        failures: 0,
        samples: [],
      });
    },
  };
  return store;
}

export function defaultSettings(): PlatformSettings {
  return {
    languages: ['fr', 'en'],
    defaultLanguage: 'fr',
    currency: 'XOF',
    timezone: 'Africa/Lome',
    supportEmail: 'support@resto-hub.tg',
    supportPhone: '+228 90 00 00 00',
    countries: [
      {
        code: 'TG',
        name: 'Togo',
        currency: 'XOF',
        dialCode: '+228',
        active: true,
        defaultTaxCode: 'TG_TVA_18',
      },
      {
        code: 'BJ',
        name: 'Bénin',
        currency: 'XOF',
        dialCode: '+229',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'CI',
        name: "Côte d'Ivoire",
        currency: 'XOF',
        dialCode: '+225',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'BF',
        name: 'Burkina Faso',
        currency: 'XOF',
        dialCode: '+226',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'SN',
        name: 'Sénégal',
        currency: 'XOF',
        dialCode: '+221',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'ML',
        name: 'Mali',
        currency: 'XOF',
        dialCode: '+223',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'NE',
        name: 'Niger',
        currency: 'XOF',
        dialCode: '+227',
        active: true,
        defaultTaxCode: 'UEMOA_TVA_18',
      },
      {
        code: 'GH',
        name: 'Ghana',
        currency: 'GHS',
        dialCode: '+233',
        active: false,
        defaultTaxCode: 'GH_VAT_15',
      },
      {
        code: 'NG',
        name: 'Nigeria',
        currency: 'NGN',
        dialCode: '+234',
        active: false,
        defaultTaxCode: 'NG_VAT_7_5',
      },
    ],
    taxes: [
      { code: 'TG_TVA_18', name: 'TVA Togo', ratePct: 18, scope: 'sales', active: true },
      { code: 'UEMOA_TVA_18', name: 'TVA UEMOA', ratePct: 18, scope: 'sales', active: true },
      { code: 'EXONERE', name: 'Exonéré', ratePct: 0, scope: 'sales', active: true },
      { code: 'GH_VAT_15', name: 'Ghana VAT', ratePct: 15, scope: 'sales', active: false },
      { code: 'NG_VAT_7_5', name: 'Nigeria VAT', ratePct: 7.5, scope: 'sales', active: false },
    ],
    providers: [
      {
        code: 'tmoney',
        name: 'TMoney',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money'],
        priority: 1,
      },
      {
        code: 'moov',
        name: 'Moov Money',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money'],
        priority: 2,
      },
      {
        code: 'cinetpay',
        name: 'CinetPay',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money', 'card'],
        priority: 3,
      },
      {
        code: 'paydunya',
        name: 'PayDunya',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money', 'card'],
        priority: 4,
      },
      {
        code: 'fedapay',
        name: 'FedaPay',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money'],
        priority: 5,
      },
      {
        code: 'paygate',
        name: 'PayGate',
        enabled: true,
        currencies: ['XOF'],
        channels: ['mobile_money'],
        priority: 6,
      },
      {
        code: 'stripe',
        name: 'Stripe',
        enabled: false,
        currencies: ['XOF', 'EUR', 'USD'],
        channels: ['card'],
        priority: 7,
      },
    ],
    updatedAt: nowIso(),
    updatedBy: 'system',
  };
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function seedPlatformDemo(
  store: PlatformAdminStore,
  services: Array<{ name: string; url: string }> = [],
): void {
  for (const service of services) store.registerService(service.name, service.url);

  const tenants: Array<DirectoryEntry & { city: string }> = [
    {
      tenantId: 'tnt_sahelgrill',
      brandName: 'Sahel Grill',
      slug: 'sahel-grill',
      plan: 'pro',
      status: 'active',
      city: 'Lomé',
      trial: false,
      createdAt: daysAgo(210),
      updatedAt: daysAgo(3),
    },
    {
      tenantId: 'tnt_baobab',
      brandName: 'Baobab Lounge',
      slug: 'baobab-lounge',
      plan: 'starter',
      status: 'active',
      city: 'Lomé',
      trial: true,
      createdAt: daysAgo(12),
      updatedAt: daysAgo(1),
    },
    {
      tenantId: 'tnt_akwaba',
      brandName: 'Akwaba Maquis',
      slug: 'akwaba-maquis',
      plan: 'enterprise',
      status: 'suspended',
      city: 'Kara',
      trial: false,
      createdAt: daysAgo(340),
      updatedAt: daysAgo(9),
    },
  ];
  for (const tenant of tenants) store.directory.set(tenant.tenantId, tenant);

  const providers = ['tmoney', 'moov', 'cinetpay'];
  const methods = ['mobile_money', 'mobile_money', 'mobile_money', 'especes', 'carte'];
  const paymentSeed = [
    { tenantId: 'tnt_sahelgrill', amount: 18400, days: 0, hour: 20 },
    { tenantId: 'tnt_sahelgrill', amount: 26750, days: 1, hour: 21 },
    { tenantId: 'tnt_sahelgrill', amount: 9800, days: 2, hour: 13 },
    { tenantId: 'tnt_sahelgrill', amount: 45200, days: 4, hour: 19 },
    { tenantId: 'tnt_sahelgrill', amount: 12750, days: 6, hour: 20 },
    { tenantId: 'tnt_sahelgrill', amount: 31500, days: 9, hour: 22 },
    { tenantId: 'tnt_baobab', amount: 7400, days: 0, hour: 18 },
    { tenantId: 'tnt_baobab', amount: 12900, days: 2, hour: 23 },
    { tenantId: 'tnt_baobab', amount: 5600, days: 5, hour: 17 },
    { tenantId: 'tnt_akwaba', amount: 62000, days: 12, hour: 21 },
    { tenantId: 'tnt_akwaba', amount: 38800, days: 15, hour: 20 },
  ];
  let index = 0;
  for (const payment of paymentSeed) {
    index += 1;
    const at = new Date(Date.now() - payment.days * 24 * 60 * 60 * 1000);
    at.setHours(payment.hour, (index * 7) % 60, 0, 0);
    const commissionXof = Math.round(payment.amount * 0.02);
    const provider = providers[index % providers.length];
    const method = methods[index % methods.length];
    const reference = `TX-2026-${String(1000 + index)}`;
    store.commissions.push({
      id: newId('cmn'),
      tenantId: payment.tenantId,
      transactionId: `pay_seed_${index}`,
      reference,
      amountXof: payment.amount,
      commissionXof,
      netXof: payment.amount - commissionXof,
      method,
      provider,
      at: at.toISOString(),
    });
    store.transactions.push({
      id: `pay_seed_${index}`,
      tenantId: payment.tenantId,
      kind: 'payment',
      reference,
      amountXof: payment.amount,
      method,
      provider,
      at: at.toISOString(),
    });
  }

  for (const failed of [
    { tenantId: 'tnt_baobab', amount: 8400, hours: 5, provider: 'tmoney' },
    { tenantId: 'tnt_sahelgrill', amount: 15600, hours: 30, provider: 'moov' },
  ]) {
    store.transactions.push({
      id: newId('pay'),
      tenantId: failed.tenantId,
      kind: 'failed',
      reference: `TX-ECHEC-${failed.provider.toUpperCase()}`,
      amountXof: failed.amount,
      method: 'mobile_money',
      provider: failed.provider,
      at: hoursAgo(failed.hours),
    });
  }

  store.transactions.push({
    id: newId('ref'),
    tenantId: 'tnt_sahelgrill',
    kind: 'refund',
    reference: 'RB-2026-0042',
    amountXof: 4500,
    method: 'mobile_money',
    provider: 'tmoney',
    at: daysAgo(3),
  });

  const openDispute: DisputeProjection = {
    id: 'dsp_seed_1',
    tenantId: 'tnt_baobab',
    transactionId: 'pay_seed_8',
    reason: 'Client contestant un débit mobile money',
    status: 'open',
    openedAt: hoursAgo(8),
    resolvedAt: null,
    resolution: null,
  };
  const resolvedDispute: DisputeProjection = {
    id: 'dsp_seed_2',
    tenantId: 'tnt_sahelgrill',
    transactionId: 'pay_seed_4',
    reason: 'Ecarts de montant signalés par le gérant',
    status: 'resolved',
    openedAt: daysAgo(11),
    resolvedAt: daysAgo(10),
    resolution: 'Rapprochement manuel confirmé',
  };
  store.disputes.set(openDispute.id, openDispute);
  store.disputes.set(resolvedDispute.id, resolvedDispute);

  const alert: PlatformAlert = {
    id: 'alr_seed_1',
    severity: 'warning',
    service: 'reporting-service',
    code: 'slow_response',
    message: 'Latence au-delà de 800 ms détectée sur les exports PDF (incident du 22/11, résolu).',
    status: 'resolved',
    createdAt: daysAgo(2),
    acknowledgedBy: 'usr_platform_admin',
    acknowledgedAt: daysAgo(2),
    resolvedBy: 'usr_platform_admin',
    resolvedAt: daysAgo(2),
  };
  store.alerts.set(alert.id, alert);

  store.log('info', 'platform-admin-service', 'Passerelle de supervision initialisée (mode démo).');
  store.log('warn', 'reporting-service', 'Export PDF lent (820 ms) sur une période de 90 jours.', {
    durationMs: 820,
  });
  store.log('info', 'payment-service', 'Webhook TMoney reçu et vérifié par signature.');

  store.recordAudit({
    tenantId: null,
    actorId: 'system',
    action: 'platform.bootstrap',
    targetType: 'platform',
    targetId: 'settings',
    meta: { demoSeed: true, services: services.length },
  });
}

export function upsertDirectory(
  store: PlatformAdminStore,
  input: {
    tenantId: string;
    slug?: string;
    plan?: string;
    status?: DirectoryStatus;
    trial?: boolean;
  },
): DirectoryEntry {
  const existing = store.directory.get(input.tenantId);
  const plan = (input.plan as PlatformPlan | undefined) ?? existing?.plan ?? 'starter';
  const slug =
    input.slug ?? existing?.slug ?? input.tenantId.replace(/^tnt_/, '').replace(/_/g, '-');
  const entry: DirectoryEntry = {
    tenantId: input.tenantId,
    brandName: existing?.brandName ?? titleize(slug),
    slug,
    plan: PLAN_PRICES_XOF[plan] === undefined ? 'starter' : plan,
    status: input.status ?? existing?.status ?? 'active',
    city: existing?.city ?? null,
    trial: input.trial ?? existing?.trial ?? false,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  store.directory.set(entry.tenantId, entry);
  return entry;
}

function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function applyPlatformEvent(store: PlatformAdminStore, envelope: EventEnvelope): void {
  if (store.handledEvents.has(envelope.id)) return;
  store.handledEvents.add(envelope.id);
  if (store.handledEvents.size > 5000) {
    const first = store.handledEvents.values().next().value;
    if (first) store.handledEvents.delete(first);
  }

  store.metrics.eventsReceived += 1;
  store.metrics.eventsByType[envelope.type] = (store.metrics.eventsByType[envelope.type] ?? 0) + 1;
  store.metrics.recentEvents.push({ type: envelope.type, at: envelope.occurredAt });
  if (store.metrics.recentEvents.length > 500) store.metrics.recentEvents.shift();

  const tenantId = asString(envelope.payload.tenantId, envelope.tenantId ?? '');
  switch (envelope.type) {
    case 'TenantApplicationSubmitted': {
      store.metrics.pendingApplications += 1;
      store.log('info', 'tenant-service', 'Nouvelle demande d’établissement à examiner.', {
        applicationId: envelope.payload.applicationId,
      });
      return;
    }
    case 'TenantApproved': {
      upsertDirectory(store, {
        tenantId,
        slug: asString(envelope.payload.slug),
        plan: asString(envelope.payload.plan, 'starter'),
        status: 'active',
        trial: Boolean(envelope.payload.trial),
      });
      store.metrics.approvedApplications += 1;
      store.metrics.pendingApplications = Math.max(0, store.metrics.pendingApplications - 1);
      store.log('info', 'tenant-service', `Établissement activé : ${tenantId}.`, {
        plan: envelope.payload.plan,
      });
      return;
    }
    case 'TenantApplicationRejected': {
      store.metrics.rejectedApplications += 1;
      store.metrics.pendingApplications = Math.max(0, store.metrics.pendingApplications - 1);
      store.log('warn', 'tenant-service', 'Demande d’établissement refusée.', {
        applicationId: envelope.payload.applicationId,
        reason: envelope.payload.reason,
      });
      return;
    }
    case 'TenantSuspended': {
      upsertDirectory(store, { tenantId, status: 'suspended' });
      store.log('warn', 'tenant-service', `Établissement suspendu : ${tenantId}.`, {
        reason: envelope.payload.reason,
      });
      return;
    }
    case 'TenantReactivated': {
      upsertDirectory(store, { tenantId, status: 'active' });
      store.log('info', 'tenant-service', `Établissement réactivé : ${tenantId}.`);
      return;
    }
    case 'PaymentConfirmed': {
      upsertDirectory(store, { tenantId });
      const amountXof = asNumber(envelope.payload.amountXof);
      const commissionXof = asNumber(envelope.payload.commissionXof);
      const transactionId = asString(envelope.payload.transactionId, newId('pay'));
      const reference = asString(envelope.payload.invoiceNumber, transactionId);
      const at = asString(envelope.payload.at, envelope.occurredAt);
      store.commissions.push({
        id: newId('cmn'),
        tenantId,
        transactionId,
        reference,
        amountXof,
        commissionXof,
        netXof: asNumber(envelope.payload.netXof) || amountXof - commissionXof,
        method: asString(envelope.payload.method, 'mobile_money'),
        provider: asString(envelope.payload.provider, 'inconnu'),
        at,
      });
      store.transactions.push({
        id: transactionId,
        tenantId,
        kind: 'payment',
        reference,
        amountXof,
        method: asString(envelope.payload.method, null as unknown as string) || null,
        provider: asString(envelope.payload.provider, null as unknown as string) || null,
        at,
      });
      store.log('info', 'payment-service', `Paiement confirmé ${amountXof} XOF (${tenantId}).`, {
        transactionId,
      });
      return;
    }
    case 'PaymentFailed': {
      store.transactions.push({
        id: asString(envelope.payload.transactionId, newId('pay')),
        tenantId,
        kind: 'failed',
        reference: asString(envelope.payload.orderId, '—'),
        amountXof: asNumber(envelope.payload.amountXof),
        method: 'mobile_money',
        provider: asString(envelope.payload.provider, null as unknown as string) || null,
        at: asString(envelope.payload.at, envelope.occurredAt),
      });
      store.log(
        'warn',
        'payment-service',
        `Paiement échoué (${tenantId}) : ${asString(envelope.payload.reason, 'raison inconnue')}.`,
      );
      if ((store.metrics.eventsByType.PaymentFailed ?? 0) % 3 === 0) {
        store.raiseAlert({
          severity: 'warning',
          service: 'payment-service',
          code: 'payment_failure_rate',
          message: 'Plusieurs échecs de paiement consécutifs détectés sur la plateforme.',
        });
      }
      return;
    }
    case 'RefundIssued': {
      store.transactions.push({
        id: asString(envelope.payload.refundId, newId('ref')),
        tenantId,
        kind: 'refund',
        reference: asString(envelope.payload.transactionId, '—'),
        amountXof: asNumber(envelope.payload.amountXof),
        method: null,
        provider: null,
        at: asString(envelope.payload.at, envelope.occurredAt),
      });
      store.log(
        'info',
        'payment-service',
        `Remboursement de ${asNumber(envelope.payload.amountXof)} XOF (${tenantId}).`,
      );
      return;
    }
    case 'DisputeOpened': {
      const disputeId = asString(envelope.payload.disputeId, newId('dsp'));
      store.disputes.set(disputeId, {
        id: disputeId,
        tenantId,
        transactionId: asString(envelope.payload.transactionId, '—'),
        reason: asString(envelope.payload.reason, 'Litige signalé'),
        status: 'open',
        openedAt: asString(envelope.payload.at, envelope.occurredAt),
        resolvedAt: null,
        resolution: null,
      });
      store.log('warn', 'payment-service', `Litige ouvert (${tenantId}).`, { disputeId });
      return;
    }
    case 'DisputeResolved': {
      const disputeId = asString(envelope.payload.disputeId, '');
      const existing = store.disputes.get(disputeId);
      if (existing) {
        existing.status = 'resolved';
        existing.resolvedAt = asString(envelope.payload.at, envelope.occurredAt);
        existing.resolution = asString(envelope.payload.resolution, 'Résolu');
      }
      store.log('info', 'payment-service', `Litige résolu : ${disputeId}.`);
      return;
    }
    case 'SettlementPaid': {
      store.transactions.push({
        id: asString(envelope.payload.settlementId, newId('stl')),
        tenantId,
        kind: 'settlement',
        reference: asString(envelope.payload.settlementId, '—'),
        amountXof: asNumber(envelope.payload.amountXof),
        method: asString(envelope.payload.mode, null as unknown as string) || null,
        provider: null,
        at: asString(envelope.payload.at, envelope.occurredAt),
      });
      store.log('info', 'payment-service', `Reversement payé (${tenantId}).`);
      return;
    }
    case 'SubscriptionInvoicePaid': {
      store.transactions.push({
        id: asString(envelope.payload.invoiceId, newId('inv')),
        tenantId,
        kind: 'subscription',
        reference: asString(envelope.payload.invoiceId, '—'),
        amountXof: asNumber(envelope.payload.amountXof),
        method: null,
        provider: asString(envelope.payload.provider, null as unknown as string) || null,
        at: envelope.occurredAt,
      });
      store.log('info', 'tenant-service', `Abonnement réglé (${tenantId}).`, {
        plan: envelope.payload.plan,
      });
      return;
    }
    default:
      return;
  }
}

export interface CommissionGroupRow {
  key: string;
  label: string;
  transactions: number;
  volumeXof: number;
  commissionXof: number;
  netXof: number;
}

export function commissionGroups(
  store: PlatformAdminStore,
  fromIso: string,
  toIso: string,
  groupBy: 'tenant' | 'provider' | 'method' | 'day',
): CommissionGroupRow[] {
  const rows = new Map<string, CommissionGroupRow>();
  for (const entry of store.commissions) {
    if (entry.at < fromIso || entry.at > toIso) continue;
    const key =
      groupBy === 'tenant'
        ? entry.tenantId
        : groupBy === 'provider'
          ? entry.provider
          : groupBy === 'method'
            ? entry.method
            : entry.at.slice(0, 10);
    const label =
      groupBy === 'tenant'
        ? (store.directory.get(entry.tenantId)?.brandName ?? entry.tenantId)
        : key;
    const row = rows.get(key) ?? {
      key,
      label,
      transactions: 0,
      volumeXof: 0,
      commissionXof: 0,
      netXof: 0,
    };
    row.transactions += 1;
    row.volumeXof += entry.amountXof;
    row.commissionXof += entry.commissionXof;
    row.netXof += entry.netXof;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.volumeXof - a.volumeXof);
}

export function dashboardSnapshot(store: PlatformAdminStore) {
  const from30 = daysAgo(30);
  const commissions30 = store.commissions.filter((entry) => entry.at >= from30);
  const volume30 = commissions30.reduce((sum, entry) => sum + entry.amountXof, 0);
  const commission30 = commissions30.reduce((sum, entry) => sum + entry.commissionXof, 0);
  const net30 = commissions30.reduce((sum, entry) => sum + entry.netXof, 0);
  const refunds30 = store.transactions
    .filter((entry) => entry.kind === 'refund' && entry.at >= from30)
    .reduce((sum, entry) => sum + entry.amountXof, 0);
  const failed24 = store.transactions.filter(
    (entry) => entry.kind === 'failed' && entry.at >= hoursAgo(24),
  ).length;
  const tenants = [...store.directory.values()];
  const active = tenants.filter((tenant) => tenant.status === 'active');
  const byPlan = { starter: 0, pro: 0, enterprise: 0 };
  for (const tenant of tenants) byPlan[tenant.plan] += 1;
  const mrrXof = active.reduce((sum, tenant) => sum + PLAN_PRICES_XOF[tenant.plan], 0);
  const services = [...store.services.values()];
  return {
    establishments: {
      total: tenants.length,
      active: active.length,
      suspended: tenants.length - active.length,
      byPlan,
      trials: tenants.filter((tenant) => tenant.trial).length,
    },
    finance: {
      volume30dXof: volume30,
      commissions30dXof: commission30,
      net30dXof: net30,
      refunds30dXof: refunds30,
      failedPayments24h: failed24,
      openDisputes: [...store.disputes.values()].filter((dispute) => dispute.status === 'open')
        .length,
      mrrXof,
      averageCommissionRatePct:
        volume30 > 0 ? Math.round((commission30 / volume30) * 10000) / 100 : 0,
    },
    operations: {
      services: services.length,
      servicesUp: services.filter((service) => service.status === 'up').length,
      servicesDown: services.filter((service) => service.status === 'down').length,
      openAlerts: [...store.alerts.values()].filter((alert) => alert.status !== 'resolved').length,
      events24h: store.metrics.recentEvents.filter((event) => event.at >= hoursAgo(24)).length,
      pendingApplications: store.metrics.pendingApplications,
    },
    generatedAt: nowIso(),
  };
}

export function serviceUptime(service: ServiceHealth): number {
  if (service.samples.length === 0) return service.checks === 0 ? 0 : 100;
  const ok = service.samples.filter((sample) => sample.ok).length;
  return Math.round((ok / service.samples.length) * 1000) / 10;
}

export function auditStatus(store: PlatformAdminStore): { valid: boolean; length: number } {
  return { valid: verifyAuditChain(store.audit), length: store.audit.length };
}

export function healthSampleLimit(): number {
  return SAMPLE_LIMIT;
}
