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
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  ApiError,
  errorMessage,
  payrollApi,
  type PayComponent,
  type PayRule,
  type PayRuleBase,
  type PayRuleIssue,
  type PayRuleKind,
  type PayRuleTier,
  type PayRuleType,
  type PayrollAdjustmentType,
  type PayrollRunDetail,
  type PayrollRunStatus,
  type PayrollRunSummary,
  type PayrollSettings,
  type PayrollSummary,
  type Payslip,
  type StaffAuditEntry,
} from '../lib/api';

type Section = 'runs' | 'settings' | 'audit';

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
  actorId: string;
}

const RUN_TONE: Record<PayrollRunStatus, BadgeTone> = {
  brouillon: 'neutral',
  preparee: 'info',
  validee: 'accent',
  en_cours: 'warning',
  reussi: 'success',
  echoue: 'danger',
  a_rejouer: 'warning',
};

const RULE_TYPES: PayRuleType[] = [
  'prime',
  'indemnite',
  'cotisation',
  'retenue',
  'impot',
  'avance',
];
const RULE_BASES: PayRuleBase[] = [
  'salaire_base',
  'salaire_journalier',
  'salaire_brut',
  'brut_imposable',
  'net_imposable',
  'heures_sup',
  'ventes',
  'pourboires',
  'jours_absence',
];
const RULE_KINDS: PayRuleKind[] = ['percent', 'amount', 'heures', 'jours', 'tranches'];
const ADJUSTMENT_TYPES: PayrollAdjustmentType[] = ['prime', 'retenue', 'avance'];

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
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

function tranchesToText(tranches?: PayRuleTier[]): string {
  if (!tranches?.length) return '';
  return tranches
    .map((tier) => `${tier.upTo === null ? '-' : tier.upTo}:${tier.ratePercent}`)
    .join(' ; ');
}

function parseTranches(text: string): PayRuleTier[] {
  const entries = text
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('empty');
  return entries.map((entry) => {
    const [bound, rate] = entry.split(':').map((part) => part.trim());
    const upTo = bound === '-' || bound.toLowerCase() === 'null' ? null : Number(bound);
    const ratePercent = Number(rate);
    if ((upTo !== null && (!Number.isFinite(upTo) || upTo < 0)) || !Number.isFinite(ratePercent)) {
      throw new Error('invalid');
    }
    return { upTo, ratePercent };
  });
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function issueList(error: unknown): PayRuleIssue[] {
  if (error instanceof ApiError && error.details && typeof error.details === 'object') {
    const issues = (error.details as { issues?: PayRuleIssue[] }).issues;
    if (Array.isArray(issues)) return issues;
  }
  return [];
}

export function PayrollTab({ tenantId, locale, permissions, actorId }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canView = permissions.includes('payroll:view');
  const canPrepare = permissions.includes('payroll:prepare');
  const canApprove = permissions.includes('payroll:approve');
  const canPay = permissions.includes('payroll:pay');
  const canExport = permissions.includes('report:export');

  const [section, setSection] = useState<Section>('runs');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [runs, setRuns] = useState<PayrollRunSummary[]>([]);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [audit, setAudit] = useState<{ entries: StaffAuditEntry[]; integrity: boolean } | null>(
    null,
  );
  const [selected, setSelected] = useState<PayrollRunDetail | null>(null);
  const [pending, setPending] = useState(false);

  const [prepareModal, setPrepareModal] = useState(false);
  const [runForm, setRunForm] = useState({ period: currentPeriod(), notes: '' });

  const [adjustForm, setAdjustForm] = useState<{
    employeeId: string;
    type: PayrollAdjustmentType;
    label: string;
    amountXof: string;
    note: string;
  }>({ employeeId: '', type: 'prime', label: '', amountXof: '', note: '' });
  const [adjustDraft, setAdjustDraft] = useState<
    Array<{
      employeeId: string;
      type: PayrollAdjustmentType;
      label: string;
      amountXof: number;
      note: string;
    }>
  >([]);
  const [traceEmployeeId, setTraceEmployeeId] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    monthlyHours: string;
    workingDaysPerMonth: string;
    rules: PayRule[];
  } | null>(null);
  const [tranchesText, setTranchesText] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<PayRuleIssue[]>([]);

  const loadSettings = useCallback((next: PayrollSettings) => {
    setSettings(next);
    setDraft({
      monthlyHours: String(next.monthlyHours),
      workingDaysPerMonth: String(next.workingDaysPerMonth),
      rules: JSON.parse(JSON.stringify(next.rules)) as PayRule[],
    });
    const texts: Record<string, string> = {};
    for (const rule of next.rules) texts[rule.id] = tranchesToText(rule.tranches);
    setTranchesText(texts);
    setIssues(next.validation ?? []);
  }, []);

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const [sum, runsResult, settingsResult, auditResult] = await Promise.all([
        payrollApi.summary(tenantId),
        payrollApi.runs(tenantId),
        payrollApi.settings(tenantId),
        payrollApi.audit(tenantId),
      ]);
      setSummary(sum);
      setRuns(runsResult.items);
      loadSettings(settingsResult.settings);
      setAudit({ entries: auditResult.entries, integrity: auditResult.integrity });
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId, canView, loadSettings]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const selectRun = async (id: string) => {
    try {
      const result = await payrollApi.run(tenantId, id);
      setSelected(result.run);
      setAdjustDraft(
        result.run.adjustments.map((adjustment) => ({
          employeeId: adjustment.employeeId,
          type: adjustment.type,
          label: adjustment.label,
          amountXof: adjustment.amountXof,
          note: adjustment.note ?? '',
        })),
      );
      setTraceEmployeeId(result.run.payslips[0]?.employeeId ?? null);
      setAdjustForm((current) => ({
        ...current,
        employeeId: result.run.payslips[0]?.employeeId ?? '',
      }));
    } catch (cause) {
      toast.push({ title: t('payroll.error'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const run = async (task: () => Promise<void>, success: string) => {
    setPending(true);
    try {
      await task();
      toast.push({ title: success, tone: 'success' });
      await reload();
    } catch (cause) {
      toast.push({ title: t('payroll.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const prepareRun = () =>
    run(
      async () => {
        const result = await payrollApi.createRun(tenantId, {
          period: runForm.period,
          notes: runForm.notes || undefined,
        });
        setPrepareModal(false);
        setRunForm({ period: currentPeriod(), notes: '' });
        setSelected(result.run);
        setAdjustDraft([]);
        setTraceEmployeeId(result.run.payslips[0]?.employeeId ?? null);
        setAdjustForm((current) => ({
          ...current,
          employeeId: result.run.payslips[0]?.employeeId ?? '',
        }));
      },
      t('payroll.runCreated', { period: runForm.period }),
    );

  const recalculate = () =>
    run(async () => {
      if (!selected) return;
      const result = await payrollApi.recalculateRun(tenantId, selected.id);
      setSelected(result.run);
      setAdjustDraft([]);
    }, t('payroll.recalculated'));

  const saveAdjustments = () =>
    run(async () => {
      if (!selected) return;
      const result = await payrollApi.updateRun(tenantId, selected.id, {
        adjustments: adjustDraft.map((adjustment) => ({
          employeeId: adjustment.employeeId,
          label: adjustment.label,
          type: adjustment.type,
          amountXof: adjustment.amountXof,
          note: adjustment.note || undefined,
        })),
      });
      setSelected(result.run);
      setAdjustDraft(
        result.run.adjustments.map((adjustment) => ({
          employeeId: adjustment.employeeId,
          type: adjustment.type,
          label: adjustment.label,
          amountXof: adjustment.amountXof,
          note: adjustment.note ?? '',
        })),
      );
    }, t('payroll.adjustmentsSaved'));

  const validateRun = async () => {
    if (!selected) return;
    setPending(true);
    try {
      const result = await payrollApi.validateRun(tenantId, selected.id);
      setSelected(result.run);
      toast.push({ title: t('payroll.validated'), tone: 'success' });
      await reload();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : '';
      toast.push({
        title: code === 'segregation_of_duties' ? t('payroll.segregation') : t('payroll.error'),
        description: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setPending(false);
    }
  };

  const payRun = () =>
    run(async () => {
      if (!selected) return;
      try {
        const result = await payrollApi.payRun(tenantId, selected.id);
        setSelected(result.run);
      } catch (cause) {
        // Le cycle a changé d’état (échec/à rejouer) : recharger son état réel.
        await selectRun(selected.id);
        throw cause;
      }
    }, t('payroll.paid'));

  const sendBulletins = () =>
    run(async () => {
      if (!selected) return;
      const result = await payrollApi.sendBulletins(tenantId, selected.id);
      toast.push({ title: t('payroll.bulletinsSent', { count: result.sent }), tone: 'success' });
      const refreshed = await payrollApi.run(tenantId, selected.id);
      setSelected(refreshed.run);
    }, t('payroll.sendBulletins'));

  const downloadPayslip = async (payslip: Payslip) => {
    if (!selected) return;
    try {
      const blob = await payrollApi.payslipPdf(tenantId, selected.id, payslip.employeeId);
      saveBlob(blob, `bulletin-${selected.period}-${payslip.employeeId}.pdf`);
    } catch (cause) {
      toast.push({ title: t('payroll.error'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const downloadExport = async (format: 'csv' | 'xls' | 'pdf' | 'rules.csv') => {
    if (!selected) return;
    try {
      const blob = await payrollApi.exportBlob(tenantId, selected.id, format);
      saveBlob(blob, `paie-${selected.period}.${format}`);
      toast.push({ title: t('payroll.exportDone'), tone: 'success' });
    } catch (cause) {
      toast.push({ title: t('payroll.error'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const updateRule = (index: number, patch: Partial<PayRule>) => {
    setDraft((current) => {
      if (!current) return current;
      const rules = current.rules.map((rule, position) =>
        position === index ? { ...rule, ...patch } : rule,
      );
      return { ...current, rules };
    });
  };

  const addRule = () => {
    setDraft((current) => {
      if (!current) return current;
      const id = `rule_custom_${Date.now()}`;
      const rule: PayRule = {
        id,
        label: 'Nouvelle règle',
        code: 'NOUVELLE',
        type: 'prime',
        enabled: false,
        taxable: false,
        deductible: false,
        base: 'salaire_base',
        kind: 'percent',
        ratePercent: 0,
        description: '',
      };
      setTranchesText((texts) => ({ ...texts, [id]: '' }));
      return { ...current, rules: [...current.rules, rule] };
    });
  };

  const rulesWithTranches = useCallback((): PayRule[] => {
    if (!draft) return [];
    return draft.rules.map((rule) => {
      if (rule.kind !== 'tranches') {
        const { tranches: _drop, ...rest } = rule;
        return rest;
      }
      const text = tranchesText[rule.id] ?? tranchesToText(rule.tranches);
      return { ...rule, tranches: parseTranches(text) };
    });
  }, [draft, tranchesText]);

  const validateRules = async () => {
    setPending(true);
    try {
      const rules = rulesWithTranches();
      const result = await payrollApi.validateSettings(tenantId, rules);
      setIssues(result.issues);
      toast.push({
        title: result.valid ? t('payroll.rulesValid') : t('payroll.invalidRules'),
        tone: result.valid ? 'success' : 'warning',
      });
    } catch (cause) {
      toast.push({
        title: t('payroll.tranchesInvalid'),
        description: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setPending(false);
    }
  };

  const saveSettings = async () => {
    if (!draft) return;
    setPending(true);
    try {
      const rules = rulesWithTranches();
      const result = await payrollApi.saveSettings(tenantId, {
        monthlyHours: Number(draft.monthlyHours) || 173,
        workingDaysPerMonth: Number(draft.workingDaysPerMonth) || 26,
        rules,
      });
      loadSettings(result.settings);
      toast.push({ title: t('payroll.settingsSaved'), tone: 'success' });
    } catch (cause) {
      const details = issueList(cause);
      if (details.length) setIssues(details);
      toast.push({
        title: t('payroll.invalidRules'),
        description: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setPending(false);
    }
  };

  const resetSettings = () =>
    run(async () => {
      if (typeof window !== 'undefined' && !window.confirm(t('payroll.confirmReset'))) return;
      const result = await payrollApi.resetSettings(tenantId);
      loadSettings(result.settings);
    }, t('payroll.settingsReset'));

  const payslipColumns: Column<Payslip>[] = useMemo(
    () => [
      {
        key: 'employee',
        header: t('payroll.colEmployee'),
        render: (row) => (
          <div className="console-cell">
            <strong>{row.name}</strong>
            <span>{row.jobTitle}</span>
          </div>
        ),
      },
      {
        key: 'base',
        header: t('payroll.colBase'),
        align: 'right',
        render: (row) => formatXof(row.baseSalaryXof, locale),
      },
      {
        key: 'hours',
        header: t('payroll.colHours'),
        align: 'right',
        render: (row) => `${row.hoursWorked.toFixed(1)} h`,
      },
      {
        key: 'tips',
        header: t('payroll.colTips'),
        align: 'right',
        render: (row) => formatXof(row.tipsXof, locale),
      },
      {
        key: 'net',
        header: t('payroll.colNet'),
        align: 'right',
        render: (row) => <strong>{formatXof(row.netXof, locale)}</strong>,
      },
      {
        key: 'sent',
        header: t('payroll.colSent'),
        render: (row) => (
          <Badge tone={row.sentAt ? 'success' : 'neutral'} dot>
            {row.sentAt ? t('payroll.sentBadge') : t('payroll.notSentBadge')}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: t('payroll.colAction'),
        render: (row) => (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" onClick={() => setTraceEmployeeId(row.employeeId)}>
              {traceEmployeeId === row.employeeId ? t('payroll.hideTrace') : t('payroll.showTrace')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void downloadPayslip(row)}>
              {t('payroll.downloadPdf')}
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t, traceEmployeeId, selected?.id],
  );

  const componentColumns: Column<PayComponent>[] = [
    {
      key: 'label',
      header: t('payroll.component'),
      render: (row) => `${row.label} · ${t(`payroll.type.${row.type}`)}`,
    },
    {
      key: 'base',
      header: t('payroll.baseValue'),
      align: 'right',
      render: (row) =>
        row.base === 'heures_sup'
          ? `${row.baseValue} h`
          : row.base === 'jours_absence'
            ? `${row.baseValue} j`
            : formatXof(row.baseValue, locale),
    },
    { key: 'operation', header: t('payroll.operation'), render: (row) => row.operation },
    {
      key: 'amount',
      header: t('payroll.amount'),
      align: 'right',
      render: (row) => (
        <span>
          {formatXof(row.amountXof, locale)}{' '}
          {row.capApplied && <Badge tone="warning">{t('payroll.capApplied')}</Badge>}
        </span>
      ),
    },
  ];

  const runColumns: Column<PayrollRunSummary>[] = [
    {
      key: 'period',
      header: t('payroll.colPeriod'),
      render: (row) => <strong>{row.periodLabel}</strong>,
    },
    {
      key: 'status',
      header: t('payroll.colStatus'),
      render: (row) => (
        <Badge tone={RUN_TONE[row.status]} dot>
          {t(`payroll.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'headcount',
      header: t('payroll.colHeadcount'),
      align: 'right',
      render: (row) => row.totals.headcount,
    },
    {
      key: 'net',
      header: t('payroll.colNet'),
      align: 'right',
      render: (row) => formatXof(row.totals.netXof, locale),
    },
    { key: 'prepared', header: t('payroll.colPrepared'), render: (row) => row.preparedBy ?? '—' },
    {
      key: 'validated',
      header: t('payroll.colValidated'),
      render: (row) => row.validatedBy ?? '—',
    },
    {
      key: 'paid',
      header: t('payroll.colPaid'),
      render: (row) => (row.paidAt ? formatDate(row.paidAt, locale) : '—'),
    },
    {
      key: 'action',
      header: t('payroll.colAction'),
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => void selectRun(row.id)}>
          {t('payroll.open')}
        </Button>
      ),
    },
  ];

  const auditColumns: Column<StaffAuditEntry>[] = [
    {
      key: 'at',
      header: t('payroll.colAt'),
      render: (row) =>
        formatDate(row.createdAt, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    { key: 'actor', header: t('payroll.colActor'), render: (row) => row.actorId },
    {
      key: 'action',
      header: t('payroll.colAction'),
      render: (row) => <Badge tone="neutral">{row.action}</Badge>,
    },
    {
      key: 'target',
      header: t('payroll.colTarget'),
      render: (row) => `${row.targetType} · ${row.targetId}`,
    },
  ];

  if (!canView) {
    return (
      <EmptyState icon="lock" title={t('payroll.forbidden')} description={t('payroll.readOnly')} />
    );
  }

  if (loading && !summary) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={8} />
          <p className="console-muted">{t('payroll.loading')}</p>
        </CardBody>
      </Card>
    );
  }

  const editable = selected
    ? !selected.locked && !['validee', 'en_cours', 'reussi'].includes(selected.status)
    : false;
  const trace =
    selected?.payslips.find((payslip) => payslip.employeeId === traceEmployeeId) ?? null;
  const latestPaid = summary?.latestPaid ?? null;
  const currentRun = summary?.currentRun ?? null;

  return (
    <div className="console-stack">
      <div className="console-toolbar">
        <SegmentedControl<Section>
          ariaLabel={t('payroll.title')}
          value={section}
          onChange={setSection}
          options={[
            { value: 'runs', label: t('payroll.sectionRuns') },
            { value: 'settings', label: t('payroll.sectionSettings') },
            { value: 'audit', label: t('payroll.sectionAudit') },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="info">{t('payroll.twoLevelHint')}</Badge>
          <Button variant="outline" size="sm" iconLeft="refresh" onClick={() => void reload()}>
            {t('payroll.refresh')}
          </Button>
          {canPrepare && (
            <Button
              size="sm"
              iconLeft="plus"
              onClick={() => {
                setRunForm({ period: currentPeriod(), notes: '' });
                setPrepareModal(true);
              }}
            >
              {t('payroll.prepare')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {section === 'runs' && (
        <>
          <div className="console-stats">
            <StatCard
              label={t('payroll.statHeadcount')}
              value={latestPaid?.totals.headcount ?? currentRun?.totals.headcount ?? 0}
              icon="users"
              meta={latestPaid?.periodLabel ?? t('payroll.statNone')}
            />
            <StatCard
              label={t('payroll.statNet')}
              value={
                currentRun
                  ? formatXof(currentRun.totals.netXof, locale)
                  : latestPaid
                    ? formatXof(latestPaid.totals.netXof, locale)
                    : '—'
              }
              icon="wallet"
              meta={currentRun?.periodLabel ?? latestPaid?.periodLabel ?? t('payroll.statNone')}
            />
            <StatCard label={t('payroll.statRuns')} value={summary?.runCount ?? 0} icon="layers" />
            <StatCard
              label={t('payroll.statLastPaid')}
              value={latestPaid ? formatXof(latestPaid.totals.netXof, locale) : '—'}
              icon="check-circle"
              meta={
                latestPaid?.paidAt
                  ? t('payroll.statLastPaidMeta', {
                      period: latestPaid.periodLabel,
                      date: formatDate(latestPaid.paidAt, locale),
                    })
                  : t('payroll.statNone')
              }
            />
          </div>

          <Card>
            <CardHeader
              title={t('payroll.runsTitle')}
              action={<Badge tone="neutral">{runs.length}</Badge>}
            />
            <CardBody>
              {runs.length === 0 ? (
                <EmptyState
                  icon="banknote"
                  title={t('payroll.runsEmpty')}
                  description={t('payroll.prepareHint')}
                  action={
                    canPrepare ? (
                      <Button onClick={() => setPrepareModal(true)}>{t('payroll.prepare')}</Button>
                    ) : undefined
                  }
                />
              ) : (
                <DataTable
                  columns={runColumns}
                  rows={runs}
                  getRowId={(row) => row.id}
                  caption={t('payroll.runsTitle')}
                />
              )}
            </CardBody>
          </Card>

          {selected && (
            <Card>
              <CardHeader
                title={t('payroll.detailTitle', { period: selected.periodLabel })}
                subtitle={selected.notes || t('payroll.twoLevelHint')}
                action={
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge tone={RUN_TONE[selected.status]} dot>
                      {t(`payroll.status.${selected.status}`)}
                    </Badge>
                    {selected.locked && <Badge tone="neutral">{t('payroll.locked')}</Badge>}
                    {selected.retentionBlocked && (
                      <Badge tone="danger">{t('payroll.retentionBlocked')}</Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                      {t('staff.close')}
                    </Button>
                  </div>
                }
              />
              <CardBody>
                {selected.staleReason && (
                  <p className="auth-error" role="status" style={{ marginTop: 0 }}>
                    {t('payroll.stale')}
                  </p>
                )}

                <div className="console-stats">
                  <StatCard
                    label={t('payroll.gross')}
                    value={formatXof(selected.totals.brutXof, locale)}
                    icon="receipt"
                  />
                  <StatCard
                    label={t('payroll.cotisations')}
                    value={formatXof(selected.totals.cotisationsXof, locale)}
                    icon="shield"
                  />
                  <StatCard
                    label={`${t('payroll.impots')} · ${t('payroll.retenues')} · ${t('payroll.avances')}`}
                    value={formatXof(
                      selected.totals.impotsXof +
                        selected.totals.retenuesXof +
                        selected.totals.avancesXof,
                      locale,
                    )}
                    icon="minus"
                  />
                  <StatCard
                    label={t('payroll.net')}
                    value={formatXof(selected.totals.netXof, locale)}
                    icon="wallet"
                    meta={`${selected.totals.headcount} · ${t('payroll.workflow')}`}
                  />
                </div>

                <div className="console-kv" style={{ marginTop: 'var(--space-4)' }}>
                  <div>
                    <dt>{t('payroll.stepCreated')}</dt>
                    <dd>
                      {formatDate(selected.createdAt, locale)}{' '}
                      {t('payroll.by', { actor: selected.createdBy })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('payroll.stepPrepared')}</dt>
                    <dd>
                      {selected.preparedBy
                        ? `${selected.preparedBy} · ${selected.preparedAt ? formatDate(selected.preparedAt, locale) : ''}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('payroll.stepValidated')}</dt>
                    <dd>
                      {selected.validatedBy
                        ? `${selected.validatedBy} · ${selected.validatedAt ? formatDate(selected.validatedAt, locale) : ''}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('payroll.stepPaid')}</dt>
                    <dd>{selected.paidAt ? formatDate(selected.paidAt, locale) : '—'}</dd>
                  </div>
                </div>

                <div className="console-toolbar" style={{ marginTop: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {canPrepare && editable && (
                      <Button size="sm" variant="outline" onClick={() => void recalculate()}>
                        {t('payroll.recalculate')}
                      </Button>
                    )}
                    {canPrepare && selected.status !== 'brouillon' && (
                      <Button size="sm" variant="ghost" onClick={() => void sendBulletins()}>
                        {t('payroll.sendBulletins')}
                      </Button>
                    )}
                    {canApprove && selected.status === 'preparee' && (
                      <Button
                        size="sm"
                        loading={pending}
                        disabled={selected.preparedBy === actorId}
                        onClick={() => void validateRun()}
                      >
                        {t('payroll.validateRun')}
                      </Button>
                    )}
                    {canPay && ['validee', 'echoue', 'a_rejouer'].includes(selected.status) && (
                      <Button size="sm" loading={pending} onClick={() => void payRun()}>
                        {selected.status === 'validee'
                          ? t('payroll.payRun')
                          : t('payroll.payRetry')}
                      </Button>
                    )}
                  </div>
                  {canExport && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button size="sm" variant="ghost" onClick={() => void downloadExport('csv')}>
                        {t('payroll.exportCsv')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void downloadExport('xls')}>
                        {t('payroll.exportXls')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void downloadExport('pdf')}>
                        {t('payroll.exportPdf')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void downloadExport('rules.csv')}
                      >
                        {t('payroll.exportRules')}
                      </Button>
                    </div>
                  )}
                </div>
                {canApprove &&
                  selected.status === 'preparee' &&
                  selected.preparedBy === actorId && (
                    <p className="console-muted">{t('payroll.segregation')}</p>
                  )}
                {canPay && ['validee', 'echoue', 'a_rejouer'].includes(selected.status) && (
                  <p className="console-muted">{t('payroll.payHint')}</p>
                )}

                <div className="console-2col" style={{ marginTop: 'var(--space-4)' }}>
                  <Card>
                    <CardHeader
                      title={t('payroll.payslipsTitle')}
                      subtitle={t('payroll.componentsTitle')}
                    />
                    <CardBody>
                      <DataTable
                        columns={payslipColumns}
                        rows={selected.payslips}
                        getRowId={(row) => row.employeeId}
                        caption={t('payroll.payslipsTitle')}
                      />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader
                      title={t('payroll.adjustmentsTitle')}
                      subtitle={t('payroll.adjustmentsHint')}
                    />
                    <CardBody>
                      {adjustDraft.length === 0 ? (
                        <p className="console-muted">{t('payroll.noAdjustments')}</p>
                      ) : (
                        <ul className="console-queue">
                          {adjustDraft.map((adjustment, index) => {
                            const employee = selected.payslips.find(
                              (payslip) => payslip.employeeId === adjustment.employeeId,
                            );
                            return (
                              <li key={`${adjustment.employeeId}-${index}`}>
                                <div>
                                  <strong>
                                    {employee?.name ?? adjustment.employeeId} · {adjustment.label}
                                  </strong>
                                  <span>
                                    {t(`payroll.type.${adjustment.type}`)} ·{' '}
                                    {formatXof(adjustment.amountXof, locale)}
                                  </span>
                                </div>
                                {canPrepare && editable && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setAdjustDraft(
                                        adjustDraft.filter((_, position) => position !== index),
                                      )
                                    }
                                  >
                                    {t('staff.refuse')}
                                  </Button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {canPrepare && editable && (
                        <div className="console-stack" style={{ marginTop: 'var(--space-4)' }}>
                          <Select
                            label={t('payroll.adjEmployee')}
                            value={adjustForm.employeeId}
                            onChange={(event) =>
                              setAdjustForm({ ...adjustForm, employeeId: event.target.value })
                            }
                            options={selected.payslips.map((payslip) => ({
                              value: payslip.employeeId,
                              label: payslip.name,
                            }))}
                          />
                          <Select
                            label={t('payroll.adjType')}
                            value={adjustForm.type}
                            onChange={(event) =>
                              setAdjustForm({
                                ...adjustForm,
                                type: event.target.value as PayrollAdjustmentType,
                              })
                            }
                            options={ADJUSTMENT_TYPES.map((type) => ({
                              value: type,
                              label: t(`payroll.type.${type}`),
                            }))}
                          />
                          <Input
                            label={t('payroll.adjLabel')}
                            value={adjustForm.label}
                            onChange={(event) =>
                              setAdjustForm({ ...adjustForm, label: event.target.value })
                            }
                          />
                          <Input
                            label={t('payroll.adjAmount')}
                            type="number"
                            min={1}
                            value={adjustForm.amountXof}
                            onChange={(event) =>
                              setAdjustForm({ ...adjustForm, amountXof: event.target.value })
                            }
                          />
                          <Input
                            label={t('payroll.adjNote')}
                            value={adjustForm.note}
                            onChange={(event) =>
                              setAdjustForm({ ...adjustForm, note: event.target.value })
                            }
                          />
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Button
                              size="sm"
                              variant="outline"
                              iconLeft="plus"
                              disabled={
                                !adjustForm.employeeId ||
                                adjustForm.label.trim().length < 2 ||
                                Number(adjustForm.amountXof) < 1
                              }
                              onClick={() => {
                                setAdjustDraft([
                                  ...adjustDraft,
                                  {
                                    employeeId: adjustForm.employeeId,
                                    type: adjustForm.type,
                                    label: adjustForm.label,
                                    amountXof: Number(adjustForm.amountXof),
                                    note: adjustForm.note,
                                  },
                                ]);
                                setAdjustForm({
                                  ...adjustForm,
                                  label: '',
                                  amountXof: '',
                                  note: '',
                                });
                              }}
                            >
                              {t('payroll.addAdjustment')}
                            </Button>
                            <Button
                              size="sm"
                              loading={pending}
                              onClick={() => void saveAdjustments()}
                            >
                              {t('payroll.adjSave')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                </div>

                {trace && (
                  <Card style={{ marginTop: 'var(--space-4)' }}>
                    <CardHeader
                      title={`${t('payroll.componentsTitle')} · ${trace.name}`}
                      subtitle={trace.components.map((component) => component.label).join(' · ')}
                      action={<Badge tone="info">{formatXof(trace.netXof, locale)}</Badge>}
                    />
                    <CardBody>
                      <dl className="console-kv">
                        <div>
                          <dt>{t('payroll.gross')}</dt>
                          <dd>{formatXof(trace.brutXof, locale)}</dd>
                        </div>
                        <div>
                          <dt>{t('payroll.brutImposable')}</dt>
                          <dd>{formatXof(trace.brutImposableXof, locale)}</dd>
                        </div>
                        <div>
                          <dt>{t('payroll.cotisations')}</dt>
                          <dd>{formatXof(trace.cotisationsXof, locale)}</dd>
                        </div>
                        <div>
                          <dt>{t('payroll.retenues')}</dt>
                          <dd>{formatXof(trace.retenuesXof, locale)}</dd>
                        </div>
                        <div>
                          <dt>{t('payroll.impots')}</dt>
                          <dd>{formatXof(trace.impotsXof, locale)}</dd>
                        </div>
                        <div>
                          <dt>{t('payroll.avances')}</dt>
                          <dd>{formatXof(trace.avancesXof, locale)}</dd>
                        </div>
                      </dl>
                      <DataTable
                        columns={componentColumns}
                        rows={trace.components}
                        getRowId={(row) => row.ruleId}
                        caption={t('payroll.componentsTitle')}
                      />
                    </CardBody>
                  </Card>
                )}

                <Card style={{ marginTop: 'var(--space-4)' }}>
                  <CardHeader
                    title={t('payroll.attemptsTitle')}
                    action={
                      selected.payment ? (
                        <Badge tone={RUN_TONE[selected.status]}>
                          {t(`payroll.paymentStatus.${selected.payment.status}`)}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">{t('payroll.noAttempts')}</Badge>
                      )
                    }
                  />
                  <CardBody>
                    {selected.payment && (
                      <p className="console-muted">
                        {t('payroll.reference')} : <strong>{selected.payment.reference}</strong> ·{' '}
                        {selected.payment.message}
                      </p>
                    )}
                    {selected.attempts.length > 0 && (
                      <ul className="console-queue">
                        {selected.attempts.map((attempt, index) => (
                          <li key={`${attempt.reference}-${index}`}>
                            <div>
                              <strong>
                                {t(`payroll.paymentStatus.${attempt.status}`)} ·{' '}
                                {formatDate(attempt.at, locale)}
                              </strong>
                              <span>{attempt.message}</span>
                            </div>
                            {attempt.walletAvailableXof !== undefined && (
                              <span className="console-muted">
                                {t('payroll.available', {
                                  amount: formatXof(attempt.walletAvailableXof, locale),
                                })}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {section === 'settings' && draft && (
        <>
          <Card>
            <CardHeader
              title={t('payroll.settingsTitle')}
              subtitle={t('payroll.settingsHint')}
              action={
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" onClick={() => void validateRules()}>
                    {t('payroll.validateRules')}
                  </Button>
                  {canPrepare && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => void resetSettings()}>
                        {t('payroll.resetSettings')}
                      </Button>
                      <Button size="sm" loading={pending} onClick={() => void saveSettings()}>
                        {t('payroll.saveSettings')}
                      </Button>
                    </>
                  )}
                </div>
              }
            />
            <CardBody>
              <div className="console-2col">
                <Input
                  label={t('payroll.monthlyHours')}
                  type="number"
                  min={1}
                  max={744}
                  step="0.01"
                  value={draft.monthlyHours}
                  disabled={!canPrepare}
                  onChange={(event) => setDraft({ ...draft, monthlyHours: event.target.value })}
                />
                <Input
                  label={t('payroll.workingDays')}
                  type="number"
                  min={1}
                  max={31}
                  value={draft.workingDaysPerMonth}
                  disabled={!canPrepare}
                  onChange={(event) =>
                    setDraft({ ...draft, workingDaysPerMonth: event.target.value })
                  }
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('payroll.rulesTitle')}
              subtitle={`${draft.rules.length} ${t('payroll.numRules')}`}
              action={
                canPrepare ? (
                  <Button size="sm" variant="outline" iconLeft="plus" onClick={addRule}>
                    {t('payroll.addRule')}
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              <div className="console-stack">
                {draft.rules.map((rule, index) => (
                  <div
                    key={rule.id}
                    className="console-toolbar"
                    style={{
                      marginBottom: 0,
                      alignItems: 'flex-start',
                      borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                      paddingTop: index === 0 ? 0 : 'var(--space-4)',
                    }}
                  >
                    <div className="console-stack" style={{ flex: '1 1 480px', minWidth: 260 }}>
                      <div
                        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={!canPrepare}
                            onChange={(event) =>
                              updateRule(index, { enabled: event.target.checked })
                            }
                          />
                          <span>{t('payroll.ruleEnabled')}</span>
                        </label>
                        <Badge tone={rule.enabled ? 'success' : 'neutral'}>{rule.code}</Badge>
                        <Badge tone="info">{t(`payroll.type.${rule.type}`)}</Badge>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={rule.taxable}
                            disabled={!canPrepare}
                            onChange={(event) =>
                              updateRule(index, { taxable: event.target.checked })
                            }
                          />
                          <span>{t('payroll.ruleTaxable')}</span>
                        </label>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={rule.deductible}
                            disabled={!canPrepare}
                            onChange={(event) =>
                              updateRule(index, { deductible: event.target.checked })
                            }
                          />
                          <span>{t('payroll.ruleDeductible')}</span>
                        </label>
                      </div>
                      <div
                        className="console-2col"
                        style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
                      >
                        <Input
                          label={t('payroll.ruleLabel')}
                          value={rule.label}
                          disabled={!canPrepare}
                          onChange={(event) => updateRule(index, { label: event.target.value })}
                        />
                        <Input
                          label={t('payroll.ruleCode')}
                          value={rule.code}
                          disabled={!canPrepare}
                          onChange={(event) =>
                            updateRule(index, { code: event.target.value.toUpperCase() })
                          }
                        />
                        <Select
                          label={t('payroll.ruleType')}
                          value={rule.type}
                          disabled={!canPrepare}
                          onChange={(event) =>
                            updateRule(index, { type: event.target.value as PayRuleType })
                          }
                          options={RULE_TYPES.map((type) => ({
                            value: type,
                            label: t(`payroll.type.${type}`),
                          }))}
                        />
                        <Select
                          label={t('payroll.ruleBase')}
                          value={rule.base}
                          disabled={!canPrepare}
                          onChange={(event) =>
                            updateRule(index, { base: event.target.value as PayRuleBase })
                          }
                          options={RULE_BASES.map((base) => ({
                            value: base,
                            label: t(`payroll.base.${base}`),
                          }))}
                        />
                        <Select
                          label={t('payroll.ruleKind')}
                          value={rule.kind}
                          disabled={!canPrepare}
                          onChange={(event) =>
                            updateRule(index, { kind: event.target.value as PayRuleKind })
                          }
                          options={RULE_KINDS.map((kind) => ({
                            value: kind,
                            label: t(`payroll.kind.${kind}`),
                          }))}
                        />
                        {rule.kind === 'percent' && (
                          <Input
                            label={t('payroll.ruleRatePercent')}
                            type="number"
                            step="0.01"
                            disabled={!canPrepare}
                            value={String(rule.ratePercent ?? 0)}
                            onChange={(event) =>
                              updateRule(index, {
                                ratePercent: optionalNumber(event.target.value) ?? 0,
                              })
                            }
                          />
                        )}
                        {rule.kind === 'amount' && (
                          <Input
                            label={t('payroll.ruleRateXof')}
                            type="number"
                            disabled={!canPrepare}
                            value={String(rule.rateXof ?? 0)}
                            onChange={(event) =>
                              updateRule(index, {
                                rateXof: optionalNumber(event.target.value) ?? 0,
                              })
                            }
                          />
                        )}
                        {rule.kind === 'heures' && (
                          <>
                            <Input
                              label={t('payroll.ruleRateXof')}
                              type="number"
                              disabled={!canPrepare}
                              value={String(rule.rateXof ?? 0)}
                              onChange={(event) =>
                                updateRule(index, {
                                  rateXof: optionalNumber(event.target.value) ?? 0,
                                })
                              }
                            />
                            <Input
                              label={t('payroll.ruleMultiplier')}
                              type="number"
                              step="0.05"
                              disabled={!canPrepare}
                              value={String(rule.multiplier ?? 1)}
                              onChange={(event) =>
                                updateRule(index, {
                                  multiplier: optionalNumber(event.target.value) ?? 1,
                                })
                              }
                            />
                          </>
                        )}
                        {rule.kind === 'jours' && (
                          <Input
                            label={t('payroll.ruleRatePercent')}
                            type="number"
                            step="0.01"
                            disabled={!canPrepare}
                            value={String(rule.ratePercent ?? 0)}
                            onChange={(event) =>
                              updateRule(index, {
                                ratePercent: optionalNumber(event.target.value) ?? 0,
                              })
                            }
                          />
                        )}
                        {rule.kind === 'tranches' && (
                          <Input
                            label={t('payroll.ruleTranches')}
                            hint={t('payroll.tranchesFormat')}
                            disabled={!canPrepare}
                            value={tranchesText[rule.id] ?? ''}
                            onChange={(event) =>
                              setTranchesText({ ...tranchesText, [rule.id]: event.target.value })
                            }
                          />
                        )}
                        <Input
                          label={t('payroll.ruleCap')}
                          type="number"
                          disabled={!canPrepare}
                          value={rule.capXof === undefined ? '' : String(rule.capXof)}
                          onChange={(event) =>
                            updateRule(index, { capXof: optionalNumber(event.target.value) })
                          }
                        />
                      </div>
                      <Textarea
                        label={t('payroll.ruleDescription')}
                        rows={2}
                        disabled={!canPrepare}
                        value={rule.description}
                        onChange={(event) => updateRule(index, { description: event.target.value })}
                      />
                      <Input
                        label={t('payroll.ruleLegal')}
                        disabled={!canPrepare}
                        value={rule.legalReference ?? ''}
                        onChange={(event) =>
                          updateRule(index, { legalReference: event.target.value })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('payroll.issuesTitle')}
              action={
                <Badge
                  tone={
                    issues.some((issue) => issue.level === 'error')
                      ? 'danger'
                      : issues.length
                        ? 'warning'
                        : 'success'
                  }
                  dot
                >
                  {issues.filter((issue) => issue.level === 'error').length} {t('payroll.errors')} ·{' '}
                  {issues.filter((issue) => issue.level === 'warning').length}{' '}
                  {t('payroll.warnings')}
                </Badge>
              }
            />
            <CardBody>
              {issues.length === 0 ? (
                <p className="console-muted">{t('payroll.noIssues')}</p>
              ) : (
                <ul className="console-queue">
                  {issues.map((issue, index) => (
                    <li key={`${issue.ruleId ?? 'global'}-${index}`}>
                      <div>
                        <strong>
                          {issue.level === 'error' ? t('payroll.errors') : t('payroll.warnings')} ·{' '}
                          {issue.ruleId ?? '—'}
                        </strong>
                        <span>{issue.message}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {settings?.updatedAt && (
                <p className="console-muted" style={{ marginTop: 'var(--space-3)' }}>
                  {t('payroll.settingsUpdated')} : {formatDate(settings.updatedAt, locale)}{' '}
                  {settings.updatedBy ? t('payroll.by', { actor: settings.updatedBy }) : ''}
                </p>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {section === 'audit' && (
        <Card>
          <CardHeader
            title={t('payroll.auditTitle')}
            subtitle={t('payroll.auditHint')}
            action={
              <Badge tone={audit?.integrity ? 'success' : 'danger'} dot>
                {audit?.integrity
                  ? t('payroll.auditIntegrityOk')
                  : t('payroll.auditIntegrityBroken')}
              </Badge>
            }
          />
          <CardBody>
            {!audit || audit.entries.length === 0 ? (
              <EmptyState
                icon="shield"
                title={t('payroll.auditEmpty')}
                description={t('payroll.auditHint')}
              />
            ) : (
              <DataTable
                columns={auditColumns}
                rows={audit.entries}
                getRowId={(row) => row.id}
                caption={t('payroll.auditTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={prepareModal}
        onClose={() => setPrepareModal(false)}
        title={t('payroll.prepareTitle')}
        description={t('payroll.prepareHint')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPrepareModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void prepareRun()}>
              {t('payroll.createRun')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('payroll.period')}
            type="month"
            max={currentPeriod()}
            value={runForm.period}
            onChange={(event) => setRunForm({ ...runForm, period: event.target.value })}
          />
          <Textarea
            label={t('payroll.notes')}
            value={runForm.notes}
            onChange={(event) => setRunForm({ ...runForm, notes: event.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
