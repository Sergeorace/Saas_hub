import {
  HttpError,
  asObject,
  optionalString,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type Route,
  type ServiceClient,
} from '@resto-hub/service-kit';
import {
  RULE_BASES,
  RULE_KINDS,
  RULE_TYPES,
  validateRules,
  type PayRule,
  type RuleBase,
  type RuleKind,
  type RuleTier,
  type RuleType,
} from './rules.js';
import {
  buildPayslip,
  computeSums,
  createRun,
  defaultSettings,
  getSettings,
  periodLabel,
  periodOf,
  recomputeRun,
  type PayrollAdjustment,
  type PayrollRun,
  type PayrollSettings,
  type PayrollStore,
  type Payslip,
  type PdfArchive,
  type StaffPayrollEmployee,
} from './store.js';
import { payslipPdf, payrollJournalPdf } from './pdf.js';
import { payrollCsv, payrollXls, rulesCsv } from './exports.js';

export interface PayrollAppOptions {
  store: PayrollStore;
  staff: ServiceClient;
  payment: ServiceClient;
  tenant?: ServiceClient;
  publish: (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}

interface StaffInputResponse {
  tenantId: string;
  period: string;
  employees: StaffPayrollEmployee[];
}

interface DisbursementResponse {
  batch: {
    reference: string;
    status: string;
    totalXof: number;
    lines: Array<{
      employeeId: string;
      label: string;
      amountXof: number;
      destination: string;
      status: string;
    }>;
    paidAt: string;
  };
  wallet: { availableXof: number };
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadRun(store: PayrollStore, tenantId: string, id: string): PayrollRun {
  const run = store.runs.get(id);
  if (!run || run.tenantId !== tenantId) throw HttpError.notFound('Cycle de paie introuvable.');
  return run;
}

function serializeSettings(settings: PayrollSettings) {
  return {
    tenantId: settings.tenantId,
    currency: settings.currency,
    monthlyHours: settings.monthlyHours,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    rules: settings.rules,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    validation: validateRules(settings.rules),
  };
}

function serializeRunSummary(run: PayrollRun) {
  return {
    id: run.id,
    tenantId: run.tenantId,
    period: run.period,
    periodLabel: periodLabel(run.period),
    status: run.status,
    notes: run.notes,
    totals: run.totals,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    createdBy: run.createdBy,
    preparedBy: run.preparedBy,
    preparedAt: run.preparedAt,
    validatedBy: run.validatedBy,
    validatedAt: run.validatedAt,
    paidAt: run.paidAt,
    locked: run.locked,
    lockReason: run.lockReason,
    retentionBlocked: run.retentionBlocked,
    staleReason: run.staleReason,
    payment: run.payment,
    attempts: run.attempts,
    pdfReady: run.payslips.every((line) => line.pdf !== null),
    sentCount: run.payslips.filter((line) => line.sentAt).length,
  };
}

function serializeRunDetail(run: PayrollRun) {
  return {
    ...serializeRunSummary(run),
    adjustments: run.adjustments,
    payslips: run.payslips.map((line) => ({
      ...line,
      pdf: line.pdf ? { fileName: line.pdf.fileName, generatedAt: line.pdf.generatedAt } : null,
    })),
    snapshot: {
      fetchedAt: run.snapshot.fetchedAt,
      monthlyHours: run.snapshot.settings.monthlyHours,
      workingDaysPerMonth: run.snapshot.settings.workingDaysPerMonth,
      rules: run.snapshot.settings.rules,
    },
  };
}

function numberField(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number; int?: boolean } = {},
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw HttpError.unprocessable('validation_error', `Nombre attendu pour ${field}.`, { field });
  }
  if (options.int && !Number.isInteger(value)) {
    throw HttpError.unprocessable('validation_error', `Entier attendu pour ${field}.`, { field });
  }
  if (options.min !== undefined && value < options.min) {
    throw HttpError.unprocessable('validation_error', `${field} doit être ≥ ${options.min}.`, {
      field,
    });
  }
  if (options.max !== undefined && value > options.max) {
    throw HttpError.unprocessable('validation_error', `${field} doit être ≤ ${options.max}.`, {
      field,
    });
  }
  return value;
}

function optionalNumber(source: Record<string, unknown>, field: string): number | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw HttpError.unprocessable('validation_error', `Nombre attendu pour ${field}.`, { field });
  }
  return value;
}

function parseTranches(raw: unknown, ruleIndex: number): RuleTier[] {
  if (!Array.isArray(raw)) {
    throw HttpError.unprocessable(
      'rules_invalid',
      `Tranches attendues pour la règle #${ruleIndex + 1}.`,
    );
  }
  return raw.map((entry) => {
    const tier = asObject(entry);
    const upTo = tier.upTo === null ? null : numberField(tier, 'upTo', { min: 0 });
    return { upTo, ratePercent: numberField(tier, 'ratePercent', { min: 0, max: 100 }) };
  });
}

function parseRules(raw: unknown): PayRule[] {
  if (!Array.isArray(raw)) {
    throw HttpError.unprocessable('rules_invalid', 'La liste des règles est requise.', {
      field: 'rules',
    });
  }
  if (raw.length > 80) {
    throw HttpError.unprocessable('rules_invalid', '80 règles maximum.', { field: 'rules' });
  }
  return raw.map((entry, index) => {
    const rule = asObject(entry);
    const ruleId = optionalString(rule, 'id', { max: 60 }) ?? '';
    const kindRaw = requireString(rule, 'kind', { max: 20 });
    if (!(RULE_KINDS as readonly string[]).includes(kindRaw)) {
      throw HttpError.unprocessable(
        'rules_invalid',
        `Mode de calcul inconnu pour la règle #${index + 1}.`,
        {
          field: `rules[${index}].kind`,
        },
      );
    }
    const kind = kindRaw as RuleKind;
    const parsed: PayRule = {
      id: ruleId,
      label: requireString(rule, 'label', { min: 2, max: 80 }),
      code: requireString(rule, 'code', { min: 2, max: 40 }),
      type: requireString(rule, 'type', { max: 20 }) as RuleType,
      enabled: rule.enabled === true,
      taxable: rule.taxable === true,
      deductible: rule.deductible === true,
      base: requireString(rule, 'base', { max: 30 }) as RuleBase,
      kind,
      description: optionalString(rule, 'description', { max: 400 }) ?? '',
    };
    if (!(RULE_TYPES as readonly string[]).includes(parsed.type)) {
      throw HttpError.unprocessable('rules_invalid', `Type inconnu pour la règle #${index + 1}.`, {
        field: `rules[${index}].type`,
      });
    }
    if (!(RULE_BASES as readonly string[]).includes(parsed.base)) {
      throw HttpError.unprocessable('rules_invalid', `Base inconnue pour la règle #${index + 1}.`, {
        field: `rules[${index}].base`,
      });
    }
    const ratePercent = optionalNumber(rule, 'ratePercent');
    if (ratePercent !== undefined) parsed.ratePercent = ratePercent;
    const rateXof = optionalNumber(rule, 'rateXof');
    if (rateXof !== undefined) parsed.rateXof = rateXof;
    const multiplier = optionalNumber(rule, 'multiplier');
    if (multiplier !== undefined) parsed.multiplier = multiplier;
    const capXof = optionalNumber(rule, 'capXof');
    if (capXof !== undefined) parsed.capXof = capXof;
    if (rule.tranches !== undefined) parsed.tranches = parseTranches(rule.tranches, index);
    const legalReference = optionalString(rule, 'legalReference', { max: 200 });
    if (legalReference) parsed.legalReference = legalReference;
    if (!parsed.id) parsed.id = `rule_${parsed.code.toLowerCase()}_${index}`;
    return parsed;
  });
}

function parseAdjustments(
  raw: unknown,
  employees: StaffPayrollEmployee[],
  actor: string,
): PayrollAdjustment[] {
  if (!Array.isArray(raw)) {
    throw HttpError.unprocessable('validation_error', 'Liste de variables attendue.', {
      field: 'adjustments',
    });
  }
  if (raw.length > 200) {
    throw HttpError.unprocessable('validation_error', '200 variables maximum.', {
      field: 'adjustments',
    });
  }
  const known = new Set(employees.map((employee) => employee.employeeId));
  const now = nowIso();
  return raw.map((entry, index) => {
    const item = asObject(entry);
    const employeeId = requireString(item, 'employeeId', { max: 60 });
    if (!known.has(employeeId)) {
      throw HttpError.unprocessable(
        'validation_error',
        'Collaborateur absent de ce cycle de paie.',
        {
          field: `adjustments[${index}].employeeId`,
        },
      );
    }
    const type = requireString(item, 'type', { max: 20 });
    if (!['prime', 'retenue', 'avance'].includes(type)) {
      throw HttpError.unprocessable(
        'validation_error',
        'Type attendu : prime, retenue ou avance.',
        {
          field: `adjustments[${index}].type`,
        },
      );
    }
    return {
      id: `adj_${now.slice(0, 10).replace(/-/g, '')}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      employeeId,
      label: requireString(item, 'label', { min: 2, max: 80 }),
      type: type as PayrollAdjustment['type'],
      amountXof: numberField(item, 'amountXof', { min: 1, int: true }),
      note: optionalString(item, 'note', { max: 200 }) ?? null,
      createdBy: actor,
      createdAt: now,
    };
  });
}

function assertEditable(run: PayrollRun): void {
  if (run.locked)
    throw HttpError.conflict(
      'run_locked',
      'Ce cycle de paie est verrouillé et ne peut plus être modifié.',
    );
  if (run.status === 'en_cours')
    throw HttpError.conflict('run_in_progress', 'Un paiement est en cours sur ce cycle.');
  if (run.status === 'reussi')
    throw HttpError.conflict('run_paid', 'Ce cycle de paie est déjà réglé.');
}

function hasBlockingIssue(rules: PayRule[]): boolean {
  return validateRules(rules).some((issue) => issue.level === 'error');
}

export function buildPayrollApp(options: PayrollAppOptions): Route[] {
  const { store, staff, payment, publish } = options;

  const tenantName = async (tenantId: string): Promise<string> => {
    if (!options.tenant) return tenantId;
    try {
      const summary = await options.tenant.get<{ brandName?: string; name?: string }>(
        `/internal/tenants/${tenantId}/summary`,
      );
      return summary.brandName ?? summary.name ?? tenantId;
    } catch {
      return tenantId;
    }
  };

  const archivePayslips = async (run: PayrollRun, label: string): Promise<void> => {
    const generatedAt = nowIso();
    for (const line of run.payslips) {
      if (line.pdf) continue;
      const bytes = await payslipPdf(line, {
        tenantName: label,
        period: run.period,
        generatedAt,
        archivedReference: `${run.id}/${line.employeeId}`,
      });
      line.pdf = {
        fileName: `bulletin-${run.period}-${line.employeeId}.pdf`,
        base64: Buffer.from(bytes).toString('base64'),
        generatedAt,
      };
    }
  };

  const fetchStaffInput = async (
    tenantId: string,
    period: string,
  ): Promise<StaffPayrollEmployee[]> => {
    try {
      const response = await staff.get<StaffInputResponse>(
        `/internal/tenants/${tenantId}/staff/payroll-input?period=${encodeURIComponent(period)}`,
      );
      return response.employees;
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw error;
      throw new HttpError(
        503,
        'staff_unavailable',
        'Le service du personnel est indisponible ; réessayez plus tard.',
      );
    }
  };

  const requirePeriod = (raw: unknown): string => {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}$/.test(raw)) {
      throw HttpError.unprocessable('validation_error', 'Période attendue au format AAAA-MM.', {
        field: 'period',
      });
    }
    if (raw > periodOf()) {
      throw HttpError.unprocessable(
        'period_in_future',
        'Impossible de préparer la paie d’un mois futur.',
        { period: raw },
      );
    }
    return raw;
  };

  return [
    /* ----------------------------- Synthèse ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/summary',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        const runs = [...store.runs.values()].filter((run) => run.tenantId === tenantId);
        const counts: Record<string, number> = {};
        for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
        const current = runs.find((run) => run.period === periodOf());
        const latestPaid = runs
          .filter((run) => run.status === 'reussi')
          .sort((a, b) => b.period.localeCompare(a.period))[0];
        return {
          body: {
            tenantId,
            currentPeriod: periodOf(),
            settings: serializeSettings(getSettings(store, tenantId)),
            counts,
            runCount: runs.length,
            currentRun: current ? serializeRunSummary(current) : null,
            latestPaid: latestPaid ? serializeRunSummary(latestPaid) : null,
            generatedAt: nowIso(),
          },
        };
      },
    },

    /* ----------------------------- Paramétrage ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/settings',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        return { body: { settings: serializeSettings(getSettings(store, tenantId)) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/settings/validate',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        const body = asObject(ctx.body);
        const rules =
          body.rules === undefined ? getSettings(store, tenantId).rules : parseRules(body.rules);
        const issues = validateRules(rules);
        return { body: { valid: !issues.some((issue) => issue.level === 'error'), issues } };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/tenants/:tenantId/payroll/settings',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const body = asObject(ctx.body);
        const current = getSettings(store, tenantId);
        const monthlyHours =
          body.monthlyHours === undefined
            ? current.monthlyHours
            : numberField(body, 'monthlyHours', { min: 1, max: 744 });
        const workingDaysPerMonth =
          body.workingDaysPerMonth === undefined
            ? current.workingDaysPerMonth
            : numberField(body, 'workingDaysPerMonth', { min: 1, max: 31 });
        const rules = body.rules === undefined ? current.rules : parseRules(body.rules);
        const issues = validateRules(rules);
        if (issues.some((issue) => issue.level === 'error')) {
          throw new HttpError(
            422,
            'rules_invalid',
            'Règles de paie invalides : corrigez les erreurs signalées.',
            {
              issues,
            },
          );
        }
        const updated: PayrollSettings = {
          tenantId,
          currency: 'XOF',
          monthlyHours,
          workingDaysPerMonth,
          rules,
          updatedAt: nowIso(),
          updatedBy: claims.sub,
        };
        store.settings.set(tenantId, updated);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.settings.updated',
          targetType: 'settings',
          targetId: tenantId,
          meta: {
            monthlyHours,
            workingDaysPerMonth,
            enabledRules: rules.filter((rule) => rule.enabled).length,
            totalRules: rules.length,
          },
        });
        await publish('PayrollSettingsUpdated', tenantId, {
          tenantId,
          actorId: claims.sub,
          monthlyHours,
          workingDaysPerMonth,
          at: updated.updatedAt,
        });
        return { body: { settings: serializeSettings(updated), issues } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/settings/reset',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const fresh = defaultSettings(tenantId, claims.sub);
        store.settings.set(tenantId, fresh);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.settings.reset',
          targetType: 'settings',
          targetId: tenantId,
          meta: {},
        });
        return { body: { settings: serializeSettings(fresh) } };
      },
    },

    /* ----------------------------- Cycles ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/runs',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        const period = ctx.query.get('period');
        const status = ctx.query.get('status');
        const items = [...store.runs.values()]
          .filter((run) => run.tenantId === tenantId)
          .filter((run) => !period || run.period === period)
          .filter((run) => !status || run.status === status)
          .sort(
            (a, b) => b.period.localeCompare(a.period) || b.createdAt.localeCompare(a.createdAt),
          )
          .map(serializeRunSummary);
        return { body: { tenantId, items, count: items.length } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/runs',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const body = asObject(ctx.body);
        const period = requirePeriod(body.period ?? periodOf());
        const existing = [...store.runs.values()].find(
          (run) => run.tenantId === tenantId && run.period === period,
        );
        if (existing) {
          throw new HttpError(
            409,
            'run_exists',
            'Un cycle de paie existe déjà pour cette période.',
            {
              runId: existing.id,
              status: existing.status,
            },
          );
        }
        const settings = getSettings(store, tenantId);
        if (hasBlockingIssue(settings.rules)) {
          throw new HttpError(
            422,
            'rules_invalid',
            'Paramétrage de paie invalide : corrigez les règles avant de lancer la paie.',
            {
              issues: validateRules(settings.rules),
            },
          );
        }
        const employees = await fetchStaffInput(tenantId, period);
        if (employees.length === 0) {
          throw HttpError.unprocessable(
            'payroll_empty',
            'Aucun collaborateur éligible pour cette période.',
          );
        }
        const notes = optionalString(body, 'notes', { max: 400 }) ?? '';
        const run = createRun({ tenantId, period, employees, settings, actor: claims.sub, notes });
        store.runs.set(run.id, run);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.run.created',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: { period, headcount: run.totals.headcount, netXof: run.totals.netXof },
        });
        await publish('PayrollRunCreated', tenantId, {
          tenantId,
          runId: run.id,
          period,
          headcount: run.totals.headcount,
          netXof: run.totals.netXof,
          actorId: claims.sub,
          at: run.createdAt,
        });
        return { status: 201, body: { run: serializeRunDetail(run) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        return { body: { run: serializeRunDetail(loadRun(store, tenantId, ctx.params.id ?? '')) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/recalculate',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        assertEditable(run);
        const settings = getSettings(store, tenantId);
        const employees = await fetchStaffInput(tenantId, run.period);
        if (employees.length === 0)
          throw HttpError.unprocessable(
            'payroll_empty',
            'Aucun collaborateur éligible pour cette période.',
          );
        run.snapshot = {
          employees,
          settings: JSON.parse(JSON.stringify(settings)) as PayrollSettings,
          fetchedAt: nowIso(),
        };
        run.adjustments = [];
        recomputeRun(run);
        run.status = 'preparee';
        run.preparedBy = claims.sub;
        run.preparedAt = nowIso();
        run.validatedBy = null;
        run.validatedAt = null;
        run.staleReason = null;
        run.payslips.forEach((line) => {
          line.pdf = null;
        });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.run.recalculated',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: { headcount: run.totals.headcount, netXof: run.totals.netXof },
        });
        return { body: { run: serializeRunDetail(run) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        assertEditable(run);
        if (run.status === 'validee') {
          throw HttpError.conflict(
            'run_validated',
            'Cycle validé : créez une nouvelle version après recalcul.',
          );
        }
        const body = asObject(ctx.body);
        if (body.notes !== undefined) run.notes = optionalString(body, 'notes', { max: 400 }) ?? '';
        if (body.adjustments !== undefined) {
          run.adjustments = parseAdjustments(body.adjustments, run.snapshot.employees, claims.sub);
        }
        recomputeRun(run);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.variables.updated',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: {
            adjustments: run.adjustments.length,
            netXof: run.totals.netXof,
          },
        });
        return { body: { run: serializeRunDetail(run) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/validate',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:approve');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        if (run.locked) throw HttpError.conflict('run_locked', 'Ce cycle est verrouillé.');
        if (run.status !== 'preparee') {
          throw HttpError.conflict('invalid_status', 'Seul un cycle préparé peut être validé.', {
            status: run.status,
          });
        }
        if (!run.preparedBy) {
          throw HttpError.conflict('not_prepared', 'Le cycle doit d’abord être préparé.');
        }
        if (run.preparedBy === claims.sub) {
          throw new HttpError(
            403,
            'segregation_of_duties',
            'La validation doit être effectuée par une autre personne que le préparateur.',
            {
              preparedBy: run.preparedBy,
            },
          );
        }
        if (run.retentionBlocked) {
          throw new HttpError(
            409,
            'retention_blocked',
            'Ce cycle est suspendu par une décision de retenue en cours.',
          );
        }
        await archivePayslips(run, await tenantName(tenantId));
        run.validatedBy = claims.sub;
        run.validatedAt = nowIso();
        run.status = 'validee';
        run.updatedAt = run.validatedAt;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.run.validated',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: { period: run.period, netXof: run.totals.netXof, preparedBy: run.preparedBy },
        });
        await publish('PayrollApproved', tenantId, {
          tenantId,
          runId: run.id,
          period: run.period,
          totalXof: run.totals.netXof,
          headcount: run.totals.headcount,
          approvedBy: claims.sub,
          preparedBy: run.preparedBy,
          at: run.validatedAt,
        });
        return { body: { run: serializeRunDetail(run) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/pay',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:pay');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        if (run.locked)
          throw HttpError.conflict('run_locked', 'Ce cycle est verrouillé et déjà réglé.');
        if (run.status !== 'validee' && run.status !== 'echoue' && run.status !== 'a_rejouer') {
          throw HttpError.conflict('invalid_status', 'Le cycle doit être validé avant paiement.', {
            status: run.status,
          });
        }
        if (!run.validatedBy) {
          throw HttpError.conflict(
            'not_validated',
            'Aucune validation gérant enregistrée sur ce cycle.',
          );
        }
        if (run.retentionBlocked) {
          throw new HttpError(
            409,
            'retention_blocked',
            'Paiement bloqué par une décision de retenue en cours.',
          );
        }
        const liveEmployees = await fetchStaffInput(tenantId, run.period);
        if (liveEmployees.length !== run.totals.headcount) {
          throw new HttpError(
            422,
            'headcount_changed',
            'L’effectif a changé depuis la préparation : recalculez le cycle.',
            {
              preparedHeadcount: run.totals.headcount,
              liveHeadcount: liveEmployees.length,
            },
          );
        }
        const items = run.payslips
          .filter((line) => line.netXof > 0)
          .map((line) => ({
            employeeId: line.employeeId,
            label: `Salaire ${run.period} — ${line.name}`,
            amountXof: line.netXof,
            destination: line.paymentDestination,
          }));
        if (items.length === 0) {
          throw HttpError.unprocessable('payroll_empty', 'Aucun net à payer sur ce cycle.');
        }
        const reference = `PAY-${run.period.replace('-', '')}-${run.id.slice(-6).toUpperCase()}`;
        const attemptedAt = nowIso();
        run.status = 'en_cours';
        run.payment = {
          reference,
          status: 'en_cours',
          attemptedAt,
          message: 'Envoi des versements au service Paiement.',
        };
        run.attempts.push({
          at: attemptedAt,
          reference,
          status: 'en_cours',
          message: `Versement groupé de ${items.length} salaires.`,
        });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.run.payment_started',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: { reference, totalXof: run.totals.netXof, headcount: items.length },
        });
        try {
          const response = await payment.post<DisbursementResponse>(
            `/internal/tenants/${tenantId}/payments/disbursements`,
            {
              reference,
              memo: `Paie ${periodLabel(run.period)}`,
              approvedBy: run.validatedBy,
              items,
            },
          );
          run.status = 'reussi';
          run.paidAt = response.batch.paidAt ?? nowIso();
          run.locked = true;
          run.lockedAt = run.paidAt;
          run.lockReason = 'Paie réglée : cycle verrouillé pour l’archivage.';
          run.payment = {
            reference: response.batch.reference,
            status: 'reussi',
            attemptedAt,
            message: `Versements exécutés (${response.batch.status}).`,
          };
          run.attempts.push({
            at: run.paidAt,
            reference: response.batch.reference,
            status: 'reussi',
            message: `Net total versé : ${response.batch.totalXof} F CFA.`,
            walletAvailableXof: response.wallet?.availableXof,
          });
          run.updatedAt = run.paidAt;
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'payroll.run.paid',
            targetType: 'payroll_run',
            targetId: run.id,
            meta: {
              reference: response.batch.reference,
              totalXof: response.batch.totalXof,
              headcount: items.length,
            },
          });
          await publish('PayrollPaid', tenantId, {
            tenantId,
            runId: run.id,
            period: run.period,
            reference: response.batch.reference,
            totalXof: response.batch.totalXof,
            headcount: items.length,
            at: run.paidAt,
          });
        } catch (error) {
          const walletIssue = error instanceof HttpError && error.code === 'wallet_insufficient';
          const status = walletIssue ? 'a_rejouer' : 'echoue';
          const message = walletIssue
            ? 'Portefeuille insuffisant : approvisionnez le portefeuille puis rejouez le paiement.'
            : error instanceof HttpError
              ? error.message
              : 'Erreur inattendue du service Paiement.';
          run.status = status;
          run.payment = { reference, status, attemptedAt, message };
          run.attempts.push({ at: nowIso(), reference, status, message });
          run.updatedAt = nowIso();
          store.recordAudit({
            tenantId,
            actorId: claims.sub,
            action: 'payroll.run.payment_failed',
            targetType: 'payroll_run',
            targetId: run.id,
            meta: { reference, status, message },
          });
          await publish('PayrollPaymentFailed', tenantId, {
            tenantId,
            runId: run.id,
            period: run.period,
            reference,
            status,
            reason: message,
            at: run.updatedAt,
          });
        }
        return { body: { run: serializeRunDetail(run) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/batches',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        return {
          body: {
            tenantId,
            runId: run.id,
            status: run.status,
            payment: run.payment,
            attempts: run.attempts,
            locked: run.locked,
          },
        };
      },
    },

    /* ----------------------------- Bulletins ----------------------------- */
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/bulletins/send',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'payroll:prepare');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        const body = ctx.body ? asObject(ctx.body) : {};
        const filter = Array.isArray(body.employeeIds)
          ? new Set(body.employeeIds.map((id) => String(id)))
          : null;
        await archivePayslips(run, await tenantName(tenantId));
        const now = nowIso();
        const sent: string[] = [];
        for (const line of run.payslips) {
          if (filter && !filter.has(line.employeeId)) continue;
          if (line.sentAt) continue;
          line.sentAt = now;
          sent.push(line.employeeId);
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'payroll.bulletins.sent',
          targetType: 'payroll_run',
          targetId: run.id,
          meta: { count: sent.length },
        });
        await publish('PayslipsSent', tenantId, {
          tenantId,
          runId: run.id,
          count: sent.length,
          at: now,
        });
        return { body: { sent: sent.length, employees: sent, delivery: 'simulee', sentAt: now } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/bulletins/:employeeId/pdf',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'payroll:view');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        const line = run.payslips.find((payslip) => payslip.employeeId === ctx.params.employeeId);
        if (!line) throw HttpError.notFound('Bulletin introuvable pour ce cycle.');
        if (!line.pdf) await archivePayslips(run, await tenantName(tenantId));
        const archive = line.pdf as PdfArchive;
        return {
          raw: {
            data: Buffer.from(archive.base64, 'base64'),
            contentType: 'application/pdf',
            fileName: archive.fileName,
          },
        };
      },
    },

    /* ----------------------------- Exports ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/runs/:id/exports/:format',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'report:export');
        const run = loadRun(store, tenantId, ctx.params.id ?? '');
        const format = ctx.params.format ?? '';
        if (format === 'csv') {
          return {
            raw: {
              data: Buffer.from(payrollCsv(run), 'utf8'),
              contentType: 'text/csv; charset=utf-8',
              fileName: `paie-${run.period}.csv`,
            },
          };
        }
        if (format === 'xls') {
          return {
            raw: {
              data: Buffer.from(payrollXls(run), 'utf8'),
              contentType: 'application/vnd.ms-excel',
              fileName: `paie-${run.period}.xls`,
            },
          };
        }
        if (format === 'rules.csv') {
          return {
            raw: {
              data: Buffer.from(rulesCsv(run), 'utf8'),
              contentType: 'text/csv; charset=utf-8',
              fileName: `regles-paie-${run.period}.csv`,
            },
          };
        }
        if (format === 'pdf') {
          const pdf = await payrollJournalPdf(run, {
            tenantName: await tenantName(tenantId),
            generatedAt: nowIso(),
          });
          return {
            raw: {
              data: Buffer.from(pdf),
              contentType: 'application/pdf',
              fileName: `journal-paie-${run.period}.pdf`,
            },
          };
        }
        throw HttpError.notFound('Format d’export inconnu (csv, xls, pdf, rules.csv).');
      },
    },

    /* ----------------------------- Audit ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/payroll/audit',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'audit:view');
        const entries = store.audit
          .filter((entry) => entry.tenantId === tenantId)
          .slice(-100)
          .reverse();
        return {
          body: {
            tenantId,
            entries,
            integrity: verifyAuditChain(store.audit),
            generatedAt: nowIso(),
          },
        };
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Événements consommés                                                */
/* ------------------------------------------------------------------ */

export function handlePayrollEvent(
  store: PayrollStore,
  tenantId: string,
  event: { type: string; payload: Record<string, unknown> },
): void {
  if (event.type === 'StaffUpdated') {
    for (const run of store.runs.values()) {
      if (run.tenantId !== tenantId || run.locked) continue;
      if (run.status === 'en_cours' || run.status === 'reussi') continue;
      run.status = 'brouillon';
      run.preparedBy = null;
      run.preparedAt = null;
      run.validatedBy = null;
      run.validatedAt = null;
      run.staleReason = 'Fiche employé ou effectif modifié — recalcul requis avant validation.';
      run.updatedAt = nowIso();
    }
    return;
  }
  if (event.type === 'RetentionDecided') {
    const decision = typeof event.payload.decision === 'string' ? event.payload.decision : '';
    for (const run of store.runs.values()) {
      if (run.tenantId !== tenantId || run.locked) continue;
      run.retentionBlocked = decision === 'approuve' || decision === 'retenue';
      run.updatedAt = nowIso();
      if (run.retentionBlocked) {
        run.staleReason = 'Décision de retenue active : paiement suspendu.';
      }
    }
  }
}

/*
 * Utilitaire exposé pour la documentation et les tests : le calcul d’un
 * bulletin isolé, sans passer par un cycle complet.
 */
export function previewPayslip(input: StaffPayrollEmployee, settings: PayrollSettings): Payslip {
  return buildPayslip(input, settings, []);
}

export { computeSums };
