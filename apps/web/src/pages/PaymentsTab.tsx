import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  Modal,
  SegmentedControl,
  Select,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatTime,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  orderApi,
  paymentApi,
  type FraudBlockView,
  type LedgerView,
  type Order,
  type PaymentOverview,
  type PaymentProviderView,
  type PaymentStatus,
  type PaymentTransaction,
  type ReconciliationRun,
  type SettlementMode,
  type SettlementView,
  type WalletView,
} from '../lib/api';

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  en_attente: 'warning',
  confirmee: 'success',
  echouee: 'danger',
  expiree: 'neutral',
  annulee: 'neutral',
  remboursee_partielle: 'info',
  remboursee: 'info',
};

const SETTLEMENT_TONE: Record<string, BadgeTone> = {
  en_attente: 'warning',
  payee: 'success',
  rejetee: 'danger',
};

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PaymentsTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canManage = permissions.includes('payment:manage');
  const canRefund = permissions.includes('payment:refund');
  const canExport = permissions.includes('report:export');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [providers, setProviders] = useState<PaymentProviderView[]>([]);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [settlements, setSettlements] = useState<SettlementView[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [blocks, setBlocks] = useState<FraudBlockView[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [reconciliation, setReconciliation] = useState<ReconciliationRun | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [filters, setFilters] = useState({ q: '', status: '', method: '' });

  const [orders, setOrders] = useState<Order[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payPending, setPayPending] = useState(false);
  const [payForm, setPayForm] = useState({
    orderId: '',
    amount: '',
    method: 'mobile_money' as 'mobile_money' | 'carte',
    provider: '',
    customerName: '',
    customerPhone: '',
    tip: '',
    staff: '',
    note: '',
  });

  const [refundTarget, setRefundTarget] = useState<PaymentTransaction | null>(null);
  const [refundPending, setRefundPending] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });

  const [settlePending, setSettlePending] = useState(false);
  const [settleForm, setSettleForm] = useState<{
    amount: string;
    mode: SettlementMode;
    destination: string;
    note: string;
  }>({
    amount: '',
    mode: 'instant',
    destination: '',
    note: '',
  });

  const [reconDate, setReconDate] = useState(todayIso());
  const [reconPending, setReconPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (activeFilters = filters) => {
      try {
        setError(null);
        const [
          overviewResult,
          providerResult,
          walletResult,
          txResult,
          blockResult,
          reconResult,
          ledgerResult,
        ] = await Promise.all([
          paymentApi.overview(tenantId),
          paymentApi.providers(tenantId),
          paymentApi.wallet(tenantId),
          paymentApi.transactions(tenantId, { ...activeFilters, limit: 100 }),
          paymentApi.fraudBlocks(tenantId),
          paymentApi.reconciliations(tenantId),
          paymentApi.ledger(tenantId, 50),
        ]);
        setOverview(overviewResult);
        setProviders(providerResult.items);
        setWallet(walletResult.wallet);
        setSettlements(walletResult.settlements);
        setTransactions(txResult.items);
        setBlocks(blockResult.items);
        setLimits(blockResult.limits);
        setReconciliation(reconResult.items[0] ?? null);
        setLedger(ledgerResult);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [tenantId, filters],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const applyFilters = () => {
    void load(filters);
  };

  const openPaymentModal = async () => {
    setPayOpen(true);
    setPayForm({
      orderId: '',
      amount: '',
      method: 'mobile_money',
      provider: '',
      customerName: '',
      customerPhone: '',
      tip: '',
      staff: '',
      note: '',
    });
    try {
      const result = await orderApi.list(tenantId, { limit: 50 });
      setOrders(
        result.items.filter(
          (order) => order.paymentStatus !== 'payee' && order.status !== 'annulee',
        ),
      );
    } catch {
      setOrders([]);
    }
  };

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === payForm.orderId) ?? null,
    [orders, payForm.orderId],
  );

  const submitPayment = async () => {
    setPayPending(true);
    try {
      const tipXof = payForm.tip ? Number(payForm.tip) : undefined;
      const staffIds = payForm.staff
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const input = {
        method: payForm.method,
        provider: payForm.provider || undefined,
        customerName: payForm.customerName || undefined,
        customerPhone: payForm.customerPhone || undefined,
        note: payForm.note || undefined,
        tipXof: tipXof && tipXof > 0 ? tipXof : undefined,
        tipStaffIds: staffIds.length > 0 ? staffIds : undefined,
        ...(payForm.orderId ? { orderId: payForm.orderId } : { amountXof: Number(payForm.amount) }),
      };
      const result = await paymentApi.initiate(tenantId, input);
      toast.push({
        tone: 'success',
        title: t('payments.newCreated', { reference: result.transaction.providerReference }),
        description: result.transaction.instructions,
      });
      setPayOpen(false);
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setPayPending(false);
    }
  };

  const runSandbox = async (
    transaction: PaymentTransaction,
    outcome: 'confirme' | 'echoue' | 'expire',
  ) => {
    setBusyId(transaction.id);
    try {
      const result = await paymentApi.sandboxOutcome(tenantId, transaction.id, outcome);
      toast.push({
        tone: outcome === 'confirme' ? 'success' : 'warning',
        title: `${t('payments.txColStatus')} : ${t(`payments.status.${result.transaction.status}`)}`,
        description: result.warning ?? undefined,
      });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const confirm3ds = async (transaction: PaymentTransaction) => {
    setBusyId(transaction.id);
    try {
      await paymentApi.confirm3ds(tenantId, transaction.id);
      toast.push({ tone: 'success', title: t(`payments.status.confirmee`) });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (transaction: PaymentTransaction) => {
    setBusyId(transaction.id);
    try {
      await paymentApi.cancel(tenantId, transaction.id);
      toast.push({ tone: 'warning', title: t('payments.status.annulee') });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const openRefund = (transaction: PaymentTransaction) => {
    setRefundTarget(transaction);
    setRefundForm({ amount: String(transaction.refundableXof), reason: '' });
  };

  const submitRefund = async () => {
    if (!refundTarget) return;
    setRefundPending(true);
    try {
      await paymentApi.refund(tenantId, refundTarget.id, {
        amountXof: Number(refundForm.amount),
        reason: refundForm.reason,
      });
      toast.push({ tone: 'success', title: t('payments.refundDone') });
      setRefundTarget(null);
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setRefundPending(false);
    }
  };

  const submitSettlement = async () => {
    setSettlePending(true);
    try {
      const result = await paymentApi.requestSettlement(tenantId, {
        amountXof: Number(settleForm.amount),
        mode: settleForm.mode,
        destination: settleForm.destination,
        note: settleForm.note || undefined,
      });
      toast.push({
        tone: 'success',
        title:
          result.settlement.mode === 'instant'
            ? t('payments.settlementInstantDone')
            : t('payments.settlementRequested'),
      });
      setSettleForm({ amount: '', mode: settleForm.mode, destination: '', note: '' });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setSettlePending(false);
    }
  };

  const toggleProvider = async (provider: PaymentProviderView) => {
    setBusyId(provider.id);
    try {
      await paymentApi.setProviderHealth(
        tenantId,
        provider.id,
        provider.health === 'up' ? 'down' : 'up',
      );
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const liftBlock = async (block: FraudBlockView) => {
    setBusyId(block.id);
    try {
      await paymentApi.liftBlock(tenantId, block.id);
      toast.push({ tone: 'success', title: t('payments.fraudLiftDone') });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const runReconciliation = async (injectAnomalies: boolean) => {
    setReconPending(true);
    try {
      const result = await paymentApi.runReconciliation(tenantId, {
        date: reconDate,
        injectAnomalies,
      });
      setReconciliation(result.run);
      toast.push({
        tone: result.run.balanced ? 'success' : 'warning',
        title: result.run.balanced ? t('payments.reconBalanced') : t('payments.reconUnbalanced'),
      });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setReconPending(false);
    }
  };

  const download = async (format: 'csv' | 'xls' | 'pdf') => {
    try {
      const blob = await paymentApi.exportBlob(tenantId, format);
      saveBlob(blob, `transactions-${tenantId}-${todayIso()}.${format}`);
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    }
  };

  const columns: Array<Column<PaymentTransaction>> = [
    {
      key: 'reference',
      header: t('payments.txColReference'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.providerReference}</strong>
          <span>
            {row.invoiceNumber
              ? `${t('payments.txColOrder')} ${row.invoiceNumber}`
              : (row.orderNumber ?? row.id)}
          </span>
        </div>
      ),
    },
    {
      key: 'method',
      header: t('payments.txColMethod'),
      render: (row) => (
        <div className="console-cell">
          <span>{t(`payments.methods.${row.method}`)}</span>
          <strong>{row.providerLabel}</strong>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('payments.txColAmount'),
      align: 'right',
      render: (row) => (
        <div className="console-cell" style={{ textAlign: 'right' }}>
          <strong>{formatXof(row.amountXof, locale)}</strong>
          {row.tipXof > 0 && (
            <span>{t('payments.txTipBadge', { amount: formatXof(row.tipXof, locale) })}</span>
          )}
        </div>
      ),
    },
    {
      key: 'fees',
      header: t('payments.txColFees'),
      align: 'right',
      render: (row) => (
        <div className="console-cell" style={{ textAlign: 'right' }}>
          <span>{formatXof(row.fees.providerFeeXof, locale)}</span>
          <span>{formatXof(row.fees.commissionXof, locale)}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('payments.txColStatus'),
      render: (row) => (
        <div className="console-cell">
          <Badge tone={STATUS_TONE[row.status]} dot>
            {t(`payments.status.${row.status}`)}
          </Badge>
          {row.refundedXof > 0 && (
            <span>
              {t('payments.txRefundedBadge', { amount: formatXof(row.refundedXof, locale) })}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'date',
      header: t('payments.txColDate'),
      render: (row) => (
        <div className="console-cell">
          <span>{formatDate(row.createdAt, locale)}</span>
          <span>{formatTime(row.createdAt, locale)}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('payments.txColActions'),
      render: (row) => (
        <div className="console-filters">
          {canManage && row.status === 'en_attente' && row.simulated && (
            <>
              <Button
                size="sm"
                variant="primary"
                loading={busyId === row.id}
                onClick={() => void runSandbox(row, 'confirme')}
              >
                {t('payments.txConfirmSandbox')}
              </Button>
              <Button
                size="sm"
                variant="danger-soft"
                onClick={() => void runSandbox(row, 'echoue')}
              >
                {t('payments.txFailSandbox')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runSandbox(row, 'expire')}>
                {t('payments.txExpireSandbox')}
              </Button>
            </>
          )}
          {canManage && row.status === 'en_attente' && row.requires3ds && !row.simulated && (
            <Button size="sm" variant="outline" onClick={() => void confirm3ds(row)}>
              {t('payments.txConfirm3ds')}
            </Button>
          )}
          {canManage && row.status === 'en_attente' && (
            <Button size="sm" variant="ghost" onClick={() => void cancel(row)}>
              {t('payments.txCancel')}
            </Button>
          )}
          {canRefund &&
            (row.status === 'confirmee' || row.status === 'remboursee_partielle') &&
            row.refundableXof > 0 && (
              <Button size="sm" variant="outline" onClick={() => openRefund(row)}>
                {t('payments.txRefund')}
              </Button>
            )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={7} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="console-stack">
      {error && (
        <Card className="console-alert">
          <CardBody>
            <p className="auth-error" role="alert">
              {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('payments.refresh')}
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="console-stats">
        <StatCard
          label={t('payments.statTodayVolume')}
          value={formatXof(overview?.stats.todayVolumeXof ?? 0, locale)}
          icon="banknote"
          meta={t('payments.statTodayCount', { count: overview?.stats.todayCount ?? 0 })}
        />
        <StatCard
          label={t('payments.statPending')}
          value={overview?.stats.pendingCount ?? 0}
          icon="clock"
          meta={t('payments.statPendingMeta', { count: overview?.stats.pendingSettlements ?? 0 })}
        />
        <StatCard
          label={t('payments.statCommissions')}
          value={formatXof(overview?.stats.commission30dXof ?? 0, locale)}
          icon="chart"
          meta={t('payments.statCommissionsMeta', {
            plan: overview?.plan ?? 'pro',
            percent: overview?.commissionPercent ?? 0,
          })}
        />
        <StatCard
          label={t('payments.statAvailable')}
          value={formatXof(wallet?.availableXof ?? 0, locale)}
          icon="wallet"
          meta={t('payments.statAvailableMeta', {
            settled: formatXof(wallet?.settledXof ?? 0, locale),
          })}
        />
      </div>

      <div className="console-2col">
        <Card>
          <CardHeader
            title={t('payments.walletTitle')}
            subtitle={
              wallet
                ? t('payments.walletUpdated', { date: formatDate(wallet.updatedAt, locale) })
                : undefined
            }
            action={
              <Badge tone={ledger?.integrity.ok ? 'success' : 'danger'} dot>
                {ledger?.integrity.ok ? t('payments.ledgerOk') : t('payments.ledgerBroken')}
              </Badge>
            }
          />
          <CardBody>
            <div className="console-stack">
              <div
                className="console-stats"
                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
              >
                <div className="console-cell">
                  <span>{t('payments.walletAvailable')}</span>
                  <strong>{formatXof(wallet?.availableXof ?? 0, locale)}</strong>
                </div>
                <div className="console-cell">
                  <span>{t('payments.walletLifetime')}</span>
                  <strong>{formatXof(wallet?.lifetimeNetXof ?? 0, locale)}</strong>
                </div>
                <div className="console-cell">
                  <span>{t('payments.walletSettled')}</span>
                  <strong>{formatXof(wallet?.settledXof ?? 0, locale)}</strong>
                </div>
              </div>

              <Card>
                <CardHeader title={t('payments.settlementTitle')} />
                <CardBody>
                  <div className="console-stack">
                    <Input
                      label={t('payments.settlementAmount')}
                      type="number"
                      min={100}
                      value={settleForm.amount}
                      onChange={(event) =>
                        setSettleForm({ ...settleForm, amount: event.target.value })
                      }
                    />
                    <SegmentedControl<SettlementMode>
                      ariaLabel={t('payments.settlementMode')}
                      value={settleForm.mode}
                      onChange={(mode) => setSettleForm({ ...settleForm, mode })}
                      options={[
                        { value: 'instant', label: t('payments.settlementInstant') },
                        { value: 'batch', label: t('payments.settlementBatch') },
                      ]}
                    />
                    <Input
                      label={t('payments.settlementDestination')}
                      placeholder={t('payments.settlementDestinationPlaceholder')}
                      value={settleForm.destination}
                      onChange={(event) =>
                        setSettleForm({ ...settleForm, destination: event.target.value })
                      }
                    />
                    <Input
                      label={t('payments.settlementNote')}
                      value={settleForm.note}
                      onChange={(event) =>
                        setSettleForm({ ...settleForm, note: event.target.value })
                      }
                    />
                    <Button
                      disabled={
                        !canManage || !settleForm.amount || settleForm.destination.trim().length < 3
                      }
                      loading={settlePending}
                      onClick={() => void submitSettlement()}
                    >
                      {t('payments.settlementRequest')}
                    </Button>
                  </div>
                </CardBody>
              </Card>

              <div>
                <p className="console-muted">{t('payments.settlementHistory')}</p>
                {settlements.length === 0 ? (
                  <p className="console-muted">{t('payments.settlementEmpty')}</p>
                ) : (
                  <div className="console-stack">
                    {settlements.map((settlement) => (
                      <div
                        key={settlement.id}
                        className="console-toolbar"
                        style={{ marginBottom: 0 }}
                      >
                        <div className="console-cell">
                          <strong>{formatXof(settlement.amountXof, locale)}</strong>
                          <span>{settlement.destination}</span>
                        </div>
                        <div className="console-filters">
                          <Badge tone="neutral">
                            {t(
                              `payments.settlementMode${settlement.mode === 'instant' ? 'Instant' : 'Batch'}`,
                            )}
                          </Badge>
                          <Badge tone={SETTLEMENT_TONE[settlement.status]} dot>
                            {t(`payments.settlementStatus.${settlement.status}`)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="console-stack">
          <Card>
            <CardHeader
              title={t('payments.providersTitle')}
              subtitle={t('payments.providersHint')}
            />
            <CardBody>
              <div className="console-stack">
                {providers.map((provider) => (
                  <div key={provider.id} className="console-toolbar" style={{ marginBottom: 0 }}>
                    <div className="console-cell">
                      <strong>{provider.label}</strong>
                      <span>
                        {t('payments.providerFee', {
                          percent: provider.percent,
                          fixed: provider.fixedXof,
                        })}
                        {provider.supports3ds ? ` · ${t('payments.provider3ds')}` : ''}
                      </span>
                    </div>
                    <div className="console-filters">
                      <Badge tone={provider.configured ? 'success' : 'neutral'}>
                        {provider.configured
                          ? t('payments.providerConfigured')
                          : t('payments.providerNotConfigured')}
                      </Badge>
                      <Badge tone={provider.health === 'up' ? 'success' : 'danger'} dot>
                        {provider.health === 'up'
                          ? t('payments.providerUp')
                          : t('payments.providerDown')}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canManage}
                        loading={busyId === provider.id}
                        onClick={() => void toggleProvider(provider)}
                      >
                        {t('payments.providerToggle')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('payments.fraudTitle')}
              subtitle={t('payments.fraudLimits', {
                max: formatXof(limits.maxAmountXof ?? 500000, locale),
                velocity: limits.velocityMax ?? 5,
                minutes: Math.round((limits.blockMs ?? 900000) / 60000),
              })}
            />
            <CardBody>
              {blocks.length === 0 ? (
                <p className="console-muted">{t('payments.fraudEmpty')}</p>
              ) : (
                <div className="console-stack">
                  {blocks.map((block) => (
                    <div key={block.id} className="console-toolbar" style={{ marginBottom: 0 }}>
                      <div className="console-cell">
                        <strong>{block.userId}</strong>
                        <span>
                          {t('payments.fraudRule')} : {block.rule} ·{' '}
                          {t('payments.fraudExpiry', { date: formatDate(block.expiresAt, locale) })}
                        </span>
                      </div>
                      <div className="console-filters">
                        <Badge tone={block.active ? 'danger' : 'neutral'} dot>
                          {block.active ? t('payments.fraudActive') : t('payments.fraudLifted')}
                        </Badge>
                        {block.active && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage}
                            onClick={() => void liftBlock(block)}
                          >
                            {t('payments.fraudLift')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t('payments.txTitle')}
          action={
            <div className="console-filters">
              {canExport && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void download('csv')}>
                    {t('payments.exportCsv')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void download('xls')}>
                    {t('payments.exportExcel')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void download('pdf')}>
                    {t('payments.exportPdf')}
                  </Button>
                </>
              )}
              {canManage && (
                <Button size="sm" iconLeft="plus" onClick={() => void openPaymentModal()}>
                  {t('payments.txNew')}
                </Button>
              )}
            </div>
          }
        />
        <CardBody>
          <div className="console-toolbar">
            <div className="console-filters">
              <Input
                aria-label={t('payments.txSearch')}
                placeholder={t('payments.txSearch')}
                value={filters.q}
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                style={{ minWidth: 260 }}
              />
              <Select
                aria-label={t('payments.txFilterStatus')}
                value={filters.status}
                onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                options={[
                  { value: '', label: t('payments.txAll') },
                  ...(
                    [
                      'en_attente',
                      'confirmee',
                      'echouee',
                      'expiree',
                      'annulee',
                      'remboursee_partielle',
                      'remboursee',
                    ] as PaymentStatus[]
                  ).map((status) => ({ value: status, label: t(`payments.status.${status}`) })),
                ]}
              />
              <Select
                aria-label={t('payments.txFilterMethod')}
                value={filters.method}
                onChange={(event) => setFilters({ ...filters, method: event.target.value })}
                options={[
                  { value: '', label: t('payments.txAll') },
                  { value: 'mobile_money', label: t('payments.methods.mobile_money') },
                  { value: 'carte', label: t('payments.methods.carte') },
                  { value: 'especes', label: t('payments.methods.especes') },
                ]}
              />
            </div>
            <Button size="sm" variant="ghost" iconLeft="refresh" onClick={applyFilters}>
              {t('payments.refresh')}
            </Button>
          </div>
          {transactions.length === 0 ? (
            <EmptyState
              icon="banknote"
              title={t('payments.txTitle')}
              description={t('payments.txEmpty')}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={transactions}
              getRowId={(row) => row.id}
              caption={t('payments.txTitle')}
            />
          )}
        </CardBody>
      </Card>

      <div className="console-2col">
        <Card>
          <CardHeader title={t('payments.reconTitle')} subtitle={t('payments.reconHint')} />
          <CardBody>
            <div className="console-stack">
              <div className="console-filters">
                <Input
                  label={t('payments.reconDate')}
                  type="date"
                  value={reconDate}
                  onChange={(event) => setReconDate(event.target.value)}
                />
                <Button
                  loading={reconPending}
                  disabled={!canManage}
                  onClick={() => void runReconciliation(false)}
                >
                  {t('payments.reconRun')}
                </Button>
                <Button
                  variant="outline"
                  loading={reconPending}
                  disabled={!canManage}
                  onClick={() => void runReconciliation(true)}
                >
                  {t('payments.reconRunAnomalies')}
                </Button>
              </div>
              {reconciliation ? (
                <div className="console-stack">
                  <div className="console-filters">
                    <Badge tone={reconciliation.balanced ? 'success' : 'danger'} dot>
                      {reconciliation.balanced
                        ? t('payments.reconBalanced')
                        : t('payments.reconUnbalanced')}
                    </Badge>
                    <span className="console-muted">
                      {t('payments.reconLastRun')} · {formatDate(reconciliation.createdAt, locale)}
                    </span>
                  </div>
                  <p className="console-muted">
                    {t('payments.reconMatched', { count: reconciliation.matched })}
                  </p>
                  {reconciliation.missingInStatement.length > 0 && (
                    <div className="console-cell">
                      <strong>{t('payments.reconMissing')}</strong>
                      <span>{reconciliation.missingInStatement.join(', ')}</span>
                    </div>
                  )}
                  {reconciliation.amountMismatches.length > 0 && (
                    <div className="console-cell">
                      <strong>{t('payments.reconMismatch')}</strong>
                      {reconciliation.amountMismatches.map((mismatch) => (
                        <span key={mismatch.reference}>
                          {mismatch.reference} : {formatXof(mismatch.platformXof, locale)} ≠{' '}
                          {formatXof(mismatch.statementXof, locale)}
                        </span>
                      ))}
                    </div>
                  )}
                  {reconciliation.orphanRows.length > 0 && (
                    <div className="console-cell">
                      <strong>{t('payments.reconOrphan')}</strong>
                      {reconciliation.orphanRows.map((row) => (
                        <span key={row.reference}>
                          {row.reference} · {formatXof(row.amountXof, locale)}
                        </span>
                      ))}
                    </div>
                  )}
                  {reconciliation.balanced && (
                    <p className="console-muted">{t('payments.reconNone')}</p>
                  )}
                </div>
              ) : (
                <p className="console-muted">{t('payments.reconEmpty')}</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('payments.ledgerTitle')}
            action={
              <Badge tone={ledger?.integrity.ok ? 'success' : 'danger'} dot>
                {ledger?.integrity.ok ? t('payments.ledgerOk') : t('payments.ledgerBroken')}
              </Badge>
            }
          />
          <CardBody>
            <p className="console-muted">
              {t('payments.ledgerEntries', { count: ledger?.integrity.entries ?? 0 })}
            </p>
            <div className="console-stack">
              {(ledger?.entries ?? []).slice(0, 6).map((entry) => (
                <div key={entry.id} className="console-cell">
                  <strong>{entry.memo}</strong>
                  <span>
                    {formatDate(entry.at, locale)} ·{' '}
                    {entry.lines.map((line) => line.account).join(' / ')}
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={t('payments.newTitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)}>
              {t('meta.close')}
            </Button>
            <Button loading={payPending} onClick={() => void submitPayment()}>
              {t('payments.newSubmit')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <Select
            label={t('payments.newOrder')}
            value={payForm.orderId}
            onChange={(event) => {
              const orderId = event.target.value;
              const order = orders.find((candidate) => candidate.id === orderId);
              const paid =
                order?.payments?.reduce((sum, payment) => sum + payment.amountXof, 0) ?? 0;
              setPayForm({
                ...payForm,
                orderId,
                amount: order ? String(Math.max(0, order.totalXof - paid)) : payForm.amount,
              });
            }}
            options={[
              { value: '', label: t('payments.newNoOrder') },
              ...orders.map((order) => ({
                value: order.id,
                label: `${order.number} · ${formatXof(order.totalXof, locale)}`,
              })),
            ]}
          />
          <Input
            label={t('payments.newAmount')}
            hint={t('payments.newAmountHint')}
            type="number"
            min={100}
            disabled={Boolean(selectedOrder)}
            value={payForm.amount}
            onChange={(event) => setPayForm({ ...payForm, amount: event.target.value })}
          />
          <Select
            label={t('payments.newMethod')}
            value={payForm.method}
            onChange={(event) =>
              setPayForm({ ...payForm, method: event.target.value as 'mobile_money' | 'carte' })
            }
            options={[
              { value: 'mobile_money', label: t('payments.methods.mobile_money') },
              { value: 'carte', label: t('payments.methods.carte') },
            ]}
          />
          <Select
            label={t('payments.newProvider')}
            value={payForm.provider}
            onChange={(event) => setPayForm({ ...payForm, provider: event.target.value })}
            options={[
              { value: '', label: t('payments.newProviderAuto') },
              ...providers
                .filter((provider) => provider.methods.includes(payForm.method))
                .map((provider) => ({ value: provider.id, label: provider.label })),
            ]}
          />
          <Input
            label={t('payments.newCustomerName')}
            value={payForm.customerName}
            onChange={(event) => setPayForm({ ...payForm, customerName: event.target.value })}
          />
          <Input
            label={t('payments.newCustomerPhone')}
            value={payForm.customerPhone}
            onChange={(event) => setPayForm({ ...payForm, customerPhone: event.target.value })}
          />
          <Input
            label={t('payments.newTip')}
            type="number"
            min={0}
            value={payForm.tip}
            onChange={(event) => setPayForm({ ...payForm, tip: event.target.value })}
          />
          <Input
            label={t('payments.newTipStaff')}
            value={payForm.staff}
            onChange={(event) => setPayForm({ ...payForm, staff: event.target.value })}
          />
          <Textarea
            label={t('payments.newNote')}
            value={payForm.note}
            onChange={(event) => setPayForm({ ...payForm, note: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(refundTarget)}
        onClose={() => setRefundTarget(null)}
        title={t('payments.refundTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundTarget(null)}>
              {t('meta.close')}
            </Button>
            <Button
              variant="danger"
              loading={refundPending}
              disabled={!refundForm.reason.trim()}
              onClick={() => void submitRefund()}
            >
              {t('payments.refundSubmit')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <p className="console-muted">
            {refundTarget?.providerReference} · {formatXof(refundTarget?.amountXof ?? 0, locale)}
          </p>
          <Input
            label={t('payments.refundAmount')}
            type="number"
            min={1}
            max={refundTarget?.refundableXof ?? 0}
            value={refundForm.amount}
            onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })}
          />
          <Textarea
            label={t('payments.refundReason')}
            placeholder={t('payments.refundReasonPlaceholder')}
            value={refundForm.reason}
            onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
