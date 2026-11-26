import { buildAuditEntry, newId, nowIso, type AuditEntry } from '@resto-hub/service-kit';
import {
  cloneRules,
  evaluateRules,
  PRESET_RULES,
  type PayComponent,
  type PayRule,
  type PayrollComputation,
} from './rules.js';

export interface StaffPayrollEmployee {
  employeeId: string;
  name: string;
  jobTitle: string;
  roleCode: string;
  contractType: string;
  hireDate: string;
  baseSalaryXof: number;
  paymentMethod: 'mobile_money' | 'bank' | 'cash';
  paymentDestination: string;
  daysPresent: number;
  minutesWorked: number;
  hoursWorked: number;
  overtimeMinutes: number;
  overtimeHours: number;
  unpaidLeaveDays: number;
  paidLeaveDays: number;
  tipsXof: number;
  salesXof: number;
}

export interface PayrollSettings {
  tenantId: string;
  currency: 'XOF';
  monthlyHours: number;
  workingDaysPerMonth: number;
  rules: PayRule[];
  updatedAt: string;
  updatedBy: string | null;
}

export type AdjustmentType = 'prime' | 'retenue' | 'avance';

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  label: string;
  type: AdjustmentType;
  amountXof: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PdfArchive {
  fileName: string;
  base64: string;
  generatedAt: string;
}

export interface Payslip {
  employeeId: string;
  name: string;
  jobTitle: string;
  contractType: string;
  baseSalaryXof: number;
  paymentMethod: 'mobile_money' | 'bank' | 'cash';
  paymentDestination: string;
  daysPresent: number;
  hoursWorked: number;
  overtimeHours: number;
  unpaidLeaveDays: number;
  salesXof: number;
  tipsXof: number;
  components: PayComponent[];
  brutXof: number;
  brutImposableXof: number;
  cotisationsXof: number;
  retenuesXof: number;
  impotsXof: number;
  avancesXof: number;
  netXof: number;
  adjustments: PayrollAdjustment[];
  sentAt: string | null;
  pdf: PdfArchive | null;
}

export type RunStatus =
  'brouillon' | 'preparee' | 'validee' | 'en_cours' | 'reussi' | 'echoue' | 'a_rejouer';
export type PaymentStatus = 'en_cours' | 'reussi' | 'echoue' | 'a_rejouer';

export interface PaymentAttempt {
  at: string;
  reference: string;
  status: PaymentStatus;
  message: string;
  walletAvailableXof?: number;
}

export interface RunTotals {
  headcount: number;
  baseSalaryXof: number;
  brutXof: number;
  brutImposableXof: number;
  cotisationsXof: number;
  retenuesXof: number;
  impotsXof: number;
  avancesXof: number;
  netXof: number;
}

export interface PayrollRun {
  id: string;
  tenantId: string;
  period: string;
  status: RunStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  preparedBy: string | null;
  preparedAt: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  paidAt: string | null;
  locked: boolean;
  lockedAt: string | null;
  lockReason: string | null;
  retentionBlocked: boolean;
  staleReason: string | null;
  payslips: Payslip[];
  adjustments: PayrollAdjustment[];
  totals: RunTotals;
  snapshot: { employees: StaffPayrollEmployee[]; settings: PayrollSettings; fetchedAt: string };
  payment: {
    reference: string;
    status: PaymentStatus;
    attemptedAt: string;
    message: string;
  } | null;
  attempts: PaymentAttempt[];
}

export interface PayrollStore {
  settings: Map<string, PayrollSettings>;
  runs: Map<string, PayrollRun>;
  audit: AuditEntry[];
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export function createPayrollStore(): PayrollStore {
  const store: PayrollStore = {
    settings: new Map(),
    runs: new Map(),
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

export function defaultSettings(tenantId: string, actor: string | null = null): PayrollSettings {
  return {
    tenantId,
    currency: 'XOF',
    monthlyHours: 173.33,
    workingDaysPerMonth: 26,
    rules: cloneRules(PRESET_RULES),
    updatedAt: nowIso(),
    updatedBy: actor,
  };
}

export function getSettings(store: PayrollStore, tenantId: string): PayrollSettings {
  const existing = store.settings.get(tenantId);
  if (existing) return existing;
  const created = defaultSettings(tenantId);
  store.settings.set(tenantId, created);
  return created;
}

export function periodOf(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function previousPeriod(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return periodOf(date);
}

export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function computeSums(payslips: Payslip[]): RunTotals {
  return {
    headcount: payslips.length,
    baseSalaryXof: payslips.reduce((sum, line) => sum + line.baseSalaryXof, 0),
    brutXof: payslips.reduce((sum, line) => sum + line.brutXof, 0),
    brutImposableXof: payslips.reduce((sum, line) => sum + line.brutImposableXof, 0),
    cotisationsXof: payslips.reduce((sum, line) => sum + line.cotisationsXof, 0),
    retenuesXof: payslips.reduce((sum, line) => sum + line.retenuesXof, 0),
    impotsXof: payslips.reduce((sum, line) => sum + line.impotsXof, 0),
    avancesXof: payslips.reduce((sum, line) => sum + line.avancesXof, 0),
    netXof: payslips.reduce((sum, line) => sum + line.netXof, 0),
  };
}

export function buildPayslip(
  employee: StaffPayrollEmployee,
  settings: PayrollSettings,
  adjustments: PayrollAdjustment[],
): Payslip {
  const computation: PayrollComputation = evaluateRules(settings.rules, {
    baseSalaryXof: employee.baseSalaryXof,
    monthlyHours: settings.monthlyHours,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    overtimeHours: employee.overtimeHours,
    salesXof: employee.salesXof,
    tipsXof: employee.tipsXof,
    unpaidLeaveDays: employee.unpaidLeaveDays,
  });

  const components = [...computation.components];
  let brut = computation.brutXof;
  let brutImposable = computation.brutImposableXof;
  let retenues = computation.retenuesXof;
  let avances = computation.avancesXof;

  for (const adjustment of adjustments.filter(
    (entry) => entry.employeeId === employee.employeeId,
  )) {
    components.push({
      ruleId: adjustment.id,
      code: `AJUST_${adjustment.type.toUpperCase()}`,
      label: adjustment.label,
      type: adjustment.type === 'prime' ? 'prime' : adjustment.type,
      kind: 'amount',
      base: 'salaire_base',
      baseValue: 0,
      operation: 'montant variable saisi',
      amountXof: adjustment.amountXof,
      capApplied: false,
      taxable: adjustment.type === 'prime',
      deductible: false,
    });
    if (adjustment.type === 'prime') {
      brut += adjustment.amountXof;
      brutImposable += adjustment.amountXof;
    } else if (adjustment.type === 'retenue') {
      retenues += adjustment.amountXof;
    } else {
      avances += adjustment.amountXof;
    }
  }

  const net = Math.max(
    0,
    Math.round(brut - computation.cotisationsXof - retenues - computation.impotsXof - avances),
  );
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    jobTitle: employee.jobTitle,
    contractType: employee.contractType,
    baseSalaryXof: employee.baseSalaryXof,
    paymentMethod: employee.paymentMethod,
    paymentDestination: employee.paymentDestination,
    daysPresent: employee.daysPresent,
    hoursWorked: employee.hoursWorked,
    overtimeHours: employee.overtimeHours,
    unpaidLeaveDays: employee.unpaidLeaveDays,
    salesXof: employee.salesXof,
    tipsXof: employee.tipsXof,
    components,
    brutXof: Math.round(brut),
    brutImposableXof: Math.round(brutImposable),
    cotisationsXof: computation.cotisationsXof,
    retenuesXof: Math.round(retenues),
    impotsXof: computation.impotsXof,
    avancesXof: Math.round(avances),
    netXof: net,
    adjustments: adjustments.filter((entry) => entry.employeeId === employee.employeeId),
    sentAt: null,
    pdf: null,
  };
}

export function recomputeRun(run: PayrollRun): void {
  const previousSends = new Map(run.payslips.map((line) => [line.employeeId, line.sentAt]));
  run.payslips = run.snapshot.employees.map((employee) => {
    const line = buildPayslip(employee, run.snapshot.settings, run.adjustments);
    line.sentAt = previousSends.get(employee.employeeId) ?? null;
    return line;
  });
  run.totals = computeSums(run.payslips);
  run.updatedAt = nowIso();
}

export function createRun(input: {
  tenantId: string;
  period: string;
  employees: StaffPayrollEmployee[];
  settings: PayrollSettings;
  actor: string;
  notes?: string;
}): PayrollRun {
  const now = nowIso();
  const run: PayrollRun = {
    id: newId('pr'),
    tenantId: input.tenantId,
    period: input.period,
    status: 'preparee',
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor,
    preparedBy: input.actor,
    preparedAt: now,
    validatedBy: null,
    validatedAt: null,
    paidAt: null,
    locked: false,
    lockedAt: null,
    lockReason: null,
    retentionBlocked: false,
    staleReason: null,
    payslips: [],
    adjustments: [],
    totals: {
      headcount: 0,
      baseSalaryXof: 0,
      brutXof: 0,
      brutImposableXof: 0,
      cotisationsXof: 0,
      retenuesXof: 0,
      impotsXof: 0,
      avancesXof: 0,
      netXof: 0,
    },
    snapshot: {
      employees: input.employees,
      settings: JSON.parse(JSON.stringify(input.settings)) as PayrollSettings,
      fetchedAt: now,
    },
    payment: null,
    attempts: [],
  };
  recomputeRun(run);
  return run;
}

export function seedPayrollDemo(store: PayrollStore): void {
  if (store.runs.size > 0) return;
  const settings = getSettings(store, 'tnt_sahelgrill');
  settings.updatedBy = 'usr_demo_seed';
  const employees: StaffPayrollEmployee[] = [
    {
      employeeId: 'emp_akouvi',
      name: 'Akouvi Mensah',
      jobTitle: 'Serveur',
      roleCode: 'waiter',
      contractType: 'cdi',
      hireDate: '2023-02-14',
      baseSalaryXof: 140000,
      paymentMethod: 'mobile_money',
      paymentDestination: 'TMoney 90 12 34 56',
      daysPresent: 22,
      minutesWorked: 10725,
      hoursWorked: 178.75,
      overtimeMinutes: 405,
      overtimeHours: 6.75,
      unpaidLeaveDays: 1,
      paidLeaveDays: 0,
      tipsXof: 9500,
      salesXof: 4120000,
    },
    {
      employeeId: 'emp_kossi',
      name: 'Kossi Adjo',
      jobTitle: 'Cuisinier',
      roleCode: 'cook',
      contractType: 'cdi',
      hireDate: '2022-08-01',
      baseSalaryXof: 160000,
      paymentMethod: 'mobile_money',
      paymentDestination: 'Moov Money 96 55 44 33',
      daysPresent: 23,
      minutesWorked: 11040,
      hoursWorked: 184,
      overtimeMinutes: 0,
      overtimeHours: 0,
      unpaidLeaveDays: 0,
      paidLeaveDays: 0,
      tipsXof: 900,
      salesXof: 0,
    },
    {
      employeeId: 'emp_sena',
      name: 'Sena Amah',
      jobTitle: 'Barman',
      roleCode: 'bartender',
      contractType: 'cdi',
      hireDate: '2024-01-09',
      baseSalaryXof: 150000,
      paymentMethod: 'bank',
      paymentDestination: 'Compte BOA TG 000123',
      daysPresent: 21,
      minutesWorked: 10080,
      hoursWorked: 168,
      overtimeMinutes: 0,
      overtimeHours: 0,
      unpaidLeaveDays: 0,
      paidLeaveDays: 1,
      tipsXof: 6200,
      salesXof: 2980000,
    },
    {
      employeeId: 'emp_yawa',
      name: 'Yawa Doe',
      jobTitle: 'Caissière',
      roleCode: 'cashier',
      contractType: 'cdi',
      hireDate: '2023-11-02',
      baseSalaryXof: 155000,
      paymentMethod: 'mobile_money',
      paymentDestination: 'TMoney 90 77 88 99',
      daysPresent: 22,
      minutesWorked: 10560,
      hoursWorked: 176,
      overtimeMinutes: 0,
      overtimeHours: 0,
      unpaidLeaveDays: 0,
      paidLeaveDays: 0,
      tipsXof: 3100,
      salesXof: 1860000,
    },
    {
      employeeId: 'emp_komlan',
      name: 'Komlan Tetteh',
      jobTitle: 'Manager de salle',
      roleCode: 'floor_manager',
      contractType: 'cdi',
      hireDate: '2021-05-17',
      baseSalaryXof: 280000,
      paymentMethod: 'bank',
      paymentDestination: 'Compte Ecobank TG 445566',
      daysPresent: 23,
      minutesWorked: 11040,
      hoursWorked: 184,
      overtimeMinutes: 0,
      overtimeHours: 0,
      unpaidLeaveDays: 0,
      paidLeaveDays: 0,
      tipsXof: 2400,
      salesXof: 1200000,
    },
  ];
  const run = createRun({
    tenantId: 'tnt_sahelgrill',
    period: previousPeriod(),
    employees,
    settings,
    actor: 'usr_demo_seed',
  });
  run.id = 'pr_demo_sahel_prev';
  run.validatedBy = 'usr_demo_gerant';
  run.validatedAt = run.createdAt;
  run.status = 'reussi';
  run.paidAt = run.createdAt;
  run.locked = true;
  run.lockedAt = run.createdAt;
  run.lockReason = 'Paie clôturée et réglée.';
  run.payment = {
    reference: 'DISB-DEMO-0001',
    status: 'reussi',
    attemptedAt: run.createdAt,
    message: 'Versements simulés exécutés par le service Paiement.',
  };
  run.attempts.push({
    at: run.createdAt,
    reference: 'DISB-DEMO-0001',
    status: 'reussi',
    message: 'Versements simulés exécutés.',
    walletAvailableXof: 2450000,
  });
  store.runs.set(run.id, run);
  store.recordAudit({
    tenantId: null,
    actorId: 'usr_demo_seed',
    action: 'payroll.seeded',
    targetType: 'payroll',
    targetId: run.id,
    meta: { period: run.period, headcount: run.totals.headcount },
  });
}
