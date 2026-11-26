import { useCallback, useEffect, useState } from 'react';
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
  Select,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  platformPaymentApi,
  type DisputeView,
  type LedgerView,
  type PaymentTransaction,
  type PlatformPaymentSummary,
  type SettlementView,
} from '../lib/api';

const SETTLEMENT_TONE: Record<string, BadgeTone> = {
  en_attente: 'warning',
  payee: 'success',
  rejetee: 'danger',
};

const DISPUTE_TONE: Record<string, BadgeTone> = {
  ouverte: 'warning',
  en_examen: 'info',
  resolue: 'success',
  rejetee: 'neutral',
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  en_attente: 'warning',
  confirmee: 'success',
  echouee: 'danger',
  expiree: 'neutral',
  annulee: 'neutral',
  remboursee_partielle: 'info',
  remboursee: 'info',
};

interface Props {
  locale: Locale;
}

export function PaymentsPlatformTab({ locale }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PlatformPaymentSummary | null>(null);
  const [settlements, setSettlements] = useState<SettlementView[]>([]);
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [ledger, setLedger] = useState<LedgerView | null>(null);

  const [approveTarget, setApproveTarget] = useState<SettlementView | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SettlementView | null>(null);
  const [settleNote, setSettleNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [settlePending, setSettlePending] = useState(false);

  const [openDisputeOpen, setOpenDisputeOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<DisputeView | null>(null);
  const [disputePending, setDisputePending] = useState(false);
  const [disputeForm, setDisputeForm] = useState({
    tenantId: 'tnt_sahelgrill',
    transactionId: '',
    reason: '',
    description: '',
  });
  const [resolveForm, setResolveForm] = useState<{
    outcome: 'acceptee' | 'rejetee';
    refundAmountXof: string;
    note: string;
  }>({ outcome: 'acceptee', refundAmountXof: '', note: '' });

  const load = useCallback(async () => {
    try {
      setError(null);
      const [summaryResult, settlementResult, disputeResult, txResult, ledgerResult] =
        await Promise.all([
          platformPaymentApi.summary(),
          platformPaymentApi.settlements(),
          platformPaymentApi.disputes(),
          platformPaymentApi.transactions({ limit: 20 }),
          platformPaymentApi.ledger(),
        ]);
      setSummary(summaryResult);
      setSettlements(settlementResult.items);
      setDisputes(disputeResult.items);
      setTransactions(txResult.items);
      setLedger(ledgerResult);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async () => {
    if (!approveTarget) return;
    setSettlePending(true);
    try {
      await platformPaymentApi.approveSettlement(approveTarget.id, settleNote || undefined);
      toast.push({ tone: 'success', title: t('paymentsAdmin.approveDone') });
      setApproveTarget(null);
      setSettleNote('');
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setSettlePending(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setSettlePending(true);
    try {
      await platformPaymentApi.rejectSettlement(rejectTarget.id, rejectReason);
      toast.push({ tone: 'warning', title: t('paymentsAdmin.rejectDone') });
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setSettlePending(false);
    }
  };

  const openDispute = async () => {
    setDisputePending(true);
    try {
      await platformPaymentApi.openDispute(disputeForm);
      toast.push({ tone: 'success', title: t('paymentsAdmin.disputeOpened') });
      setOpenDisputeOpen(false);
      setDisputeForm({
        tenantId: disputeForm.tenantId,
        transactionId: '',
        reason: '',
        description: '',
      });
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setDisputePending(false);
    }
  };

  const resolveDispute = async () => {
    if (!resolveTarget) return;
    setDisputePending(true);
    try {
      await platformPaymentApi.resolveDispute(resolveTarget.id, {
        outcome: resolveForm.outcome,
        refundAmountXof: resolveForm.refundAmountXof
          ? Number(resolveForm.refundAmountXof)
          : undefined,
        note: resolveForm.note || undefined,
      });
      toast.push({ tone: 'success', title: t('paymentsAdmin.disputeDone') });
      setResolveTarget(null);
      await load();
    } catch (cause) {
      toast.push({ tone: 'error', title: errorMessage(cause) });
    } finally {
      setDisputePending(false);
    }
  };

  const settlementColumns: Array<Column<SettlementView>> = [
    {
      key: 'tenant',
      header: t('paymentsAdmin.settlementsColTenant'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.tenantId}</strong>
          <span>{row.destination}</span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('paymentsAdmin.settlementsColAmount'),
      align: 'right',
      render: (row) => <strong>{formatXof(row.amountXof, locale)}</strong>,
    },
    {
      key: 'mode',
      header: t('paymentsAdmin.settlementsColMode'),
      render: (row) => (
        <Badge tone="neutral">
          {t(`payments.settlementMode${row.mode === 'instant' ? 'Instant' : 'Batch'}`)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('paymentsAdmin.settlementsColStatus'),
      render: (row) => (
        <Badge tone={SETTLEMENT_TONE[row.status]} dot>
          {t(`paymentsAdmin.settlementStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: t('paymentsAdmin.settlementsColDate'),
      render: (row) => <span>{formatDate(row.createdAt, locale)}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'en_attente' ? (
          <div className="console-filters">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setApproveTarget(row);
                setSettleNote('');
              }}
            >
              {t('paymentsAdmin.approve')}
            </Button>
            <Button
              size="sm"
              variant="danger-soft"
              onClick={() => {
                setRejectTarget(row);
                setRejectReason('');
              }}
            >
              {t('paymentsAdmin.reject')}
            </Button>
          </div>
        ) : null,
    },
  ];

  const disputeColumns: Array<Column<DisputeView>> = [
    {
      key: 'reason',
      header: t('paymentsAdmin.disputeColReason'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.reason}</strong>
          <span>{row.transactionId}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('paymentsAdmin.disputeColStatus'),
      render: (row) => (
        <Badge tone={DISPUTE_TONE[row.status]} dot>
          {t(`paymentsAdmin.disputeStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: t('paymentsAdmin.disputeColDate'),
      render: (row) => <span>{formatDate(row.createdAt, locale)}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'ouverte' || row.status === 'en_examen' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResolveTarget(row);
              setResolveForm({ outcome: 'acceptee', refundAmountXof: '', note: '' });
            }}
          >
            {t('paymentsAdmin.disputeResolve')}
          </Button>
        ) : null,
    },
  ];

  const transactionColumns: Array<Column<PaymentTransaction>> = [
    {
      key: 'reference',
      header: t('paymentsAdmin.settlementsColTenant'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.providerReference}</strong>
          <span>{row.tenantId}</span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('paymentsAdmin.settlementsColAmount'),
      align: 'right',
      render: (row) => <strong>{formatXof(row.amountXof, locale)}</strong>,
    },
    {
      key: 'status',
      header: t('paymentsAdmin.settlementsColStatus'),
      render: (row) => (
        <Badge tone={PAYMENT_TONE[row.status]} dot>
          {t(`payments.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: t('paymentsAdmin.disputeColDate'),
      render: (row) => <span>{formatDate(row.createdAt, locale)}</span>,
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
              {t('paymentsAdmin.refresh')}
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="console-stats">
        <StatCard
          label={t('paymentsAdmin.statVolume')}
          value={formatXof(summary?.volumeXof ?? 0, locale)}
          icon="chart"
          meta={t('paymentsAdmin.statVolumeMeta', { count: summary?.confirmedCount ?? 0 })}
        />
        <StatCard
          label={t('paymentsAdmin.statCommissions')}
          value={formatXof(summary?.commissionXof ?? 0, locale)}
          icon="banknote"
          meta={t('paymentsAdmin.statProviderFees', {
            amount: formatXof(summary?.providerFeesXof ?? 0, locale),
          })}
        />
        <StatCard
          label={t('paymentsAdmin.statWalletLiability')}
          value={formatXof(summary?.walletLiabilityXof ?? 0, locale)}
          icon="wallet"
          meta={t('paymentsAdmin.statWalletMeta', { count: summary?.tenantsWithWallet ?? 0 })}
        />
        <StatCard
          label={t('paymentsAdmin.statOpenDisputes')}
          value={summary?.openDisputes ?? 0}
          icon="shield"
          meta={t('paymentsAdmin.statBlocks', { count: summary?.activeBlocks ?? 0 })}
        />
      </div>

      <Card>
        <CardHeader
          title={t('paymentsAdmin.settlementsTitle')}
          subtitle={t('paymentsAdmin.statSettled', {
            amount: formatXof(summary?.settledXof ?? 0, locale),
          })}
        />
        <CardBody>
          {settlements.length === 0 ? (
            <EmptyState
              icon="wallet"
              title={t('paymentsAdmin.settlementsTitle')}
              description={t('paymentsAdmin.settlementsEmpty')}
            />
          ) : (
            <DataTable
              columns={settlementColumns}
              rows={settlements}
              getRowId={(row) => row.id}
              caption={t('paymentsAdmin.settlementsTitle')}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('paymentsAdmin.disputesTitle')}
          action={
            <Button size="sm" iconLeft="plus" onClick={() => setOpenDisputeOpen(true)}>
              {t('paymentsAdmin.disputeOpen')}
            </Button>
          }
        />
        <CardBody>
          {disputes.length === 0 ? (
            <EmptyState
              icon="alert"
              title={t('paymentsAdmin.disputesTitle')}
              description={t('paymentsAdmin.disputesEmpty')}
            />
          ) : (
            <DataTable
              columns={disputeColumns}
              rows={disputes}
              getRowId={(row) => row.id}
              caption={t('paymentsAdmin.disputesTitle')}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('paymentsAdmin.txTitle')}
          action={
            <Badge tone={ledger?.integrity.ok ? 'success' : 'danger'} dot>
              {ledger?.integrity.ok
                ? t('paymentsAdmin.ledgerOk', { count: ledger.integrity.entries })
                : t('paymentsAdmin.ledgerBroken')}
            </Badge>
          }
        />
        <CardBody>
          {transactions.length === 0 ? (
            <EmptyState
              icon="receipt"
              title={t('paymentsAdmin.txTitle')}
              description={t('paymentsAdmin.txEmpty')}
            />
          ) : (
            <DataTable
              columns={transactionColumns}
              rows={transactions}
              getRowId={(row) => row.id}
              caption={t('paymentsAdmin.txTitle')}
            />
          )}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(approveTarget)}
        onClose={() => setApproveTarget(null)}
        title={t('paymentsAdmin.approve')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveTarget(null)}>
              {t('meta.close')}
            </Button>
            <Button loading={settlePending} onClick={() => void approve()}>
              {t('paymentsAdmin.approve')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <p className="console-muted">
            {approveTarget?.tenantId} · {formatXof(approveTarget?.amountXof ?? 0, locale)}
          </p>
          <Input
            label={t('paymentsAdmin.approveNote')}
            value={settleNote}
            onChange={(event) => setSettleNote(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('paymentsAdmin.reject')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              {t('meta.close')}
            </Button>
            <Button
              variant="danger"
              loading={settlePending}
              disabled={rejectReason.trim().length < 3}
              onClick={() => void reject()}
            >
              {t('paymentsAdmin.reject')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <p className="console-muted">
            {rejectTarget?.tenantId} · {formatXof(rejectTarget?.amountXof ?? 0, locale)}
          </p>
          <Textarea
            label={t('paymentsAdmin.rejectReason')}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={openDisputeOpen}
        onClose={() => setOpenDisputeOpen(false)}
        title={t('paymentsAdmin.disputeOpen')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenDisputeOpen(false)}>
              {t('meta.close')}
            </Button>
            <Button
              loading={disputePending}
              disabled={
                !disputeForm.transactionId ||
                disputeForm.reason.trim().length < 3 ||
                disputeForm.description.trim().length < 3
              }
              onClick={() => void openDispute()}
            >
              {t('paymentsAdmin.disputeSubmit')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <Input
            label={t('paymentsAdmin.disputeTenant')}
            value={disputeForm.tenantId}
            onChange={(event) => setDisputeForm({ ...disputeForm, tenantId: event.target.value })}
          />
          <Input
            label={t('paymentsAdmin.disputeTransaction')}
            value={disputeForm.transactionId}
            onChange={(event) =>
              setDisputeForm({ ...disputeForm, transactionId: event.target.value })
            }
          />
          <Input
            label={t('paymentsAdmin.disputeReason')}
            value={disputeForm.reason}
            onChange={(event) => setDisputeForm({ ...disputeForm, reason: event.target.value })}
          />
          <Textarea
            label={t('paymentsAdmin.disputeDescription')}
            value={disputeForm.description}
            onChange={(event) =>
              setDisputeForm({ ...disputeForm, description: event.target.value })
            }
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(resolveTarget)}
        onClose={() => setResolveTarget(null)}
        title={t('paymentsAdmin.disputeResolve')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>
              {t('meta.close')}
            </Button>
            <Button loading={disputePending} onClick={() => void resolveDispute()}>
              {t('paymentsAdmin.disputeResolve')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <p className="console-muted">
            {resolveTarget?.reason} · {resolveTarget?.transactionId}
          </p>
          <Select
            label={t('paymentsAdmin.disputeOutcome')}
            value={resolveForm.outcome}
            onChange={(event) =>
              setResolveForm({
                ...resolveForm,
                outcome: event.target.value as 'acceptee' | 'rejetee',
              })
            }
            options={[
              { value: 'acceptee', label: t('paymentsAdmin.disputeAccept') },
              { value: 'rejetee', label: t('paymentsAdmin.disputeReject') },
            ]}
          />
          {resolveForm.outcome === 'acceptee' && (
            <Input
              label={t('paymentsAdmin.disputeRefund')}
              type="number"
              min={1}
              value={resolveForm.refundAmountXof}
              onChange={(event) =>
                setResolveForm({ ...resolveForm, refundAmountXof: event.target.value })
              }
            />
          )}
          <Textarea
            label={t('paymentsAdmin.disputeNote')}
            value={resolveForm.note}
            onChange={(event) => setResolveForm({ ...resolveForm, note: event.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
