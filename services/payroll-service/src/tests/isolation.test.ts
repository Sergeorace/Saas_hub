import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createServiceClient,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildPayrollApp, handlePayrollEvent, previewPayslip } from '../app.js';
import { cloneRules, PRESET_RULES } from '../rules.js';
import {
  createPayrollStore,
  defaultSettings,
  getSettings,
  periodOf,
  seedPayrollDemo,
  type StaffPayrollEmployee,
} from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';

function claims(sub: string, name: string, tenantPermissions: Record<string, string[]>): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: true,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

function monthsAgo(count: number): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
}

function staffEmployee(
  employeeId: string,
  name: string,
  jobTitle: string,
  baseSalaryXof: number,
  stats: { days: number; hours: number; overtime: number; unpaid: number; sales: number; tips: number },
): StaffPayrollEmployee {
  return {
    employeeId,
    name,
    jobTitle,
    roleCode: 'waiter',
    contractType: 'cdi',
    hireDate: '2023-01-01',
    baseSalaryXof,
    paymentMethod: 'mobile_money',
    paymentDestination: `TMoney ${employeeId}`,
    daysPresent: stats.days,
    minutesWorked: Math.round(stats.hours * 60),
    hoursWorked: stats.hours,
    overtimeMinutes: Math.round(stats.overtime * 60),
    overtimeHours: stats.overtime,
    unpaidLeaveDays: stats.unpaid,
    paidLeaveDays: 0,
    tipsXof: stats.tips,
    salesXof: stats.sales,
  };
}

async function main() {
  const store = createPayrollStore();
  seedPayrollDemo(store);
  const bus = createEventBus({ name: 'payroll-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const published: string[] = [];

  const staffA = [
    staffEmployee('emp_akouvi', 'Akouvi Mensah', 'Serveur', 140000, { days: 22, hours: 178.75, overtime: 6.75, unpaid: 1, sales: 412000, tips: 9500 }),
    staffEmployee('emp_kossi', 'Kossi Adjo', 'Cuisinier', 160000, { days: 23, hours: 184, overtime: 0, unpaid: 0, sales: 0, tips: 900 }),
    staffEmployee('emp_sena', 'Sena Amah', 'Barman', 150000, { days: 21, hours: 168, overtime: 0, unpaid: 0, sales: 298000, tips: 6200 }),
    staffEmployee('emp_yawa', 'Yawa Doe', 'Caissière', 155000, { days: 22, hours: 176, overtime: 0, unpaid: 0, sales: 186000, tips: 3100 }),
    staffEmployee('emp_komlan', 'Komlan Tetteh', 'Manager de salle', 280000, { days: 23, hours: 184, overtime: 0, unpaid: 0, sales: 120000, tips: 2400 }),
  ];
  const staffB = [
    staffEmployee('emp_ama', 'Ama Kponou', 'Serveuse', 130000, { days: 20, hours: 160, overtime: 0, unpaid: 0, sales: 98000, tips: 1500 }),
    staffEmployee('emp_yao', 'Yao Sossou', 'Cuisinier', 150000, { days: 21, hours: 168, overtime: 0, unpaid: 0, sales: 0, tips: 400 }),
  ];
  let extraEmployee = false;

  const staffServer = await startServer(
    {
      name: 'staff-stub',
      routes: [
        {
          method: 'GET',
          path: '/internal/tenants/:tenantId/staff/payroll-input',
          service: true,
          handler: (ctx) => {
            const tenantId = ctx.params.tenantId ?? '';
            const base = tenantId === SAHEL ? staffA : tenantId === BAOBAB ? staffB : [];
            const employees =
              extraEmployee && tenantId === SAHEL
                ? [...base, staffEmployee('emp_extra', 'Nouvelle Recrue', 'Serveur', 120000, { days: 10, hours: 80, overtime: 0, unpaid: 0, sales: 0, tips: 0 })]
                : base;
            return { body: { tenantId, period: ctx.query.get('period') ?? periodOf(), employees } };
          },
        },
      ],
      authenticate: async () => undefined,
      internalKey: INTERNAL_KEY,
    },
    0,
  );

  let paymentMode: 'ok' | 'insufficient' = 'ok';
  const disbursements: Array<Record<string, unknown>> = [];
  const paymentServer = await startServer(
    {
      name: 'payment-stub',
      routes: [
        {
          method: 'POST',
          path: '/internal/tenants/:tenantId/payments/disbursements',
          service: true,
          handler: (ctx) => {
            const body = ctx.body as { reference: string; items: Array<{ amountXof: number }> };
            disbursements.push(body as unknown as Record<string, unknown>);
            const totalXof = body.items.reduce((sum, item) => sum + item.amountXof, 0);
            if (paymentMode === 'insufficient') {
              return {
                status: 422,
                body: {
                  error: {
                    code: 'wallet_insufficient',
                    message: 'Solde du portefeuille insuffisant.',
                    details: { availableXof: 1000, requestedXof: totalXof },
                  },
                },
              };
            }
            return {
              status: 201,
              body: {
                batch: {
                  reference: body.reference,
                  status: 'reussi',
                  totalXof,
                  lines: body.items.map((item, index) => ({ employeeId: `emp_${index}`, label: 'Salaire', amountXof: item.amountXof, destination: 'TMoney', status: 'paye' })),
                  paidAt: new Date().toISOString(),
                },
                wallet: { availableXof: 5000000 - totalXof },
              },
            };
          },
        },
      ],
      authenticate: async () => undefined,
      internalKey: INTERNAL_KEY,
    },
    0,
  );

  const tenantServer = await startServer(
    {
      name: 'tenant-stub',
      routes: [
        {
          method: 'GET',
          path: '/internal/tenants/:tenantId/summary',
          service: true,
          handler: (ctx) => ({ body: { brandName: ctx.params.tenantId === SAHEL ? 'Sahel Grill' : 'Baobab' } }),
        },
      ],
      authenticate: async () => undefined,
      internalKey: INTERNAL_KEY,
    },
    0,
  );

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const accountant = register(
    'token-accountant',
    claims('usr_accountant', 'Comptable Sahel', {
      [SAHEL]: ['payroll:view', 'payroll:prepare', 'report:export', 'audit:view'],
    }),
  );
  const owner = register(
    'token-owner',
    claims('usr_owner', 'Gérant Sahel', {
      [SAHEL]: ['payroll:view', 'payroll:prepare', 'payroll:approve', 'payroll:pay', 'report:export', 'audit:view'],
    }),
  );
  const owner2 = register(
    'token-owner2',
    claims('usr_owner2', 'Gérant adjoint Sahel', {
      [SAHEL]: ['payroll:view', 'payroll:prepare', 'payroll:approve', 'payroll:pay', 'report:export', 'audit:view'],
    }),
  );
  const ownerBaobab = register(
    'token-owner-baobab',
    claims('usr_owner_baobab', 'Gérant Baobab', { [BAOBAB]: ['payroll:view', 'payroll:approve', 'payroll:pay'] }),
  );
  const waiter = register('token-waiter', claims('usr_waiter', 'Serveur', { [SAHEL]: ['pos:operate'] }));

  const server = await startServer(
    {
      name: 'payroll-service-test',
      routes: buildPayrollApp({
        store,
        staff: createServiceClient({ baseUrl: staffServer.url, internalKey: INTERNAL_KEY }),
        payment: createServiceClient({ baseUrl: paymentServer.url, internalKey: INTERNAL_KEY }),
        tenant: createServiceClient({ baseUrl: tenantServer.url, internalKey: INTERNAL_KEY }),
        publish: async (type, tenantId, payload) => {
          published.push(type);
          return bus.publish(type, tenantId, payload);
        },
      }),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const A = `/api/v1/tenants/${SAHEL}`;

  const currentPeriod = periodOf();
  let currentRunId = '';
  let validationRunId = '';
  let headcountRunId = '';
  let netsBeforeAdjustments: Record<string, number> = {};

  const cases: TestCase[] = [
    {
      name: 'Isolation : cycles de paie cloisonnés par établissement',
      run: async () => {
        const own = await api(base, 'GET', `${A}/payroll/runs`, undefined, { token: owner });
        assertStatus(own, 200, 'Liste des cycles Sahel');
        assertEqual(own.body.items.length, 1, 'Un cycle historique seedé');
        assert(own.body.items.every((item: { tenantId: string }) => item.tenantId === SAHEL), 'Aucun cycle étranger');
        const cross = await api(base, 'GET', `${A}/payroll/runs`, undefined, { token: ownerBaobab });
        assertStatus(cross, 403, 'Accès croisé refusé');
        const seededRunId = own.body.items[0].id as string;
        const foreignRun = await api(base, 'GET', `/api/v1/tenants/${BAOBAB}/payroll/runs/${seededRunId}`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(foreignRun, 404, 'Cycle hors tenant invisible');
        const baobabRuns = await api(base, 'GET', `/api/v1/tenants/${BAOBAB}/payroll/runs`, undefined, { token: ownerBaobab });
        assertStatus(baobabRuns, 200, 'Liste Baobab');
        assertEqual(baobabRuns.body.items.length, 0, 'Baobab sans cycle');
      },
    },
    {
      name: 'RBAC : préparation et approbation séparées',
      run: async () => {
        const denied = await api(base, 'GET', `${A}/payroll/runs`, undefined, { token: waiter });
        assertStatus(denied, 403, 'Serveur sans payroll:view');
        const prevented = await api(base, 'POST', `${A}/payroll/runs`, { period: currentPeriod }, { token: waiter });
        assertStatus(prevented, 403, 'Serveur ne peut pas préparer');
        const accountantApprove = await api(base, 'POST', `${A}/payroll/runs/pr_demo_sahel_prev/validate`, {}, { token: accountant });
        assertStatus(accountantApprove, 403, 'Comptable sans payroll:approve');
      },
    },
    {
      name: 'Paramétrage : règles livrées, validation structurelle et sauvegarde auditable',
      run: async () => {
        const settings = await api(base, 'GET', `${A}/payroll/settings`, undefined, { token: accountant });
        assertStatus(settings, 200, 'Paramètres de paie');
        const rules = settings.body.settings.rules as Array<Record<string, unknown>>;
        assertEqual(rules.length, PRESET_RULES.length, 'Règles par défaut exposées');
        assertEqual(settings.body.settings.currency, 'XOF', 'Devise XOF');
        assertEqual(settings.body.settings.validation.some((issue: { level: string }) => issue.level === 'error'), false, 'Aucune erreur par défaut');

        const invalid = await api(base, 'POST', `${A}/payroll/settings/validate`, {
          rules: [{ id: 'bad', label: 'Bad', code: 'BAD', type: 'impot', base: 'net_imposable', kind: 'tranches', tranches: [{ upTo: 100000, ratePercent: 3 }] }],
        }, { token: accountant });
        assertStatus(invalid, 200, 'Validation de règles');
        assertEqual(invalid.body.valid, false, 'Barème sans dernière tranche rejeté');
        assert(invalid.body.issues.length > 0, 'Issues détaillées');

        const rejected = await api(base, 'PUT', `${A}/payroll/settings`, {
          rules: [{ id: 'x', label: 'Règle incomplète', code: 'XTEST', type: 'prime', base: 'ventes', kind: 'percent' }],
        }, { token: accountant });
        assertStatus(rejected, 422, 'Règles invalides refusées');
        assertEqual(rejected.body.error.code, 'rules_invalid', 'Code rules_invalid');

        const rulesWithRate = cloneRules(PRESET_RULES).map((rule) =>
          rule.code === 'PRIME_VENTES' ? { ...rule, ratePercent: 10 } : rule,
        );
        const saved = await api(base, 'PUT', `${A}/payroll/settings`, { rules: rulesWithRate }, { token: accountant });
        assertStatus(saved, 200, 'Règles enregistrées');
        assertEqual(saved.body.settings.updatedBy, 'usr_accountant', 'Auteur tracé');
        assert(
          saved.body.settings.rules.some((rule: { code: string; ratePercent: number }) => rule.code === 'PRIME_VENTES' && rule.ratePercent === 10),
          'Taux modifié persisté',
        );
        assert(published.includes('PayrollSettingsUpdated'), 'Événement PayrollSettingsUpdated publié');
      },
    },
    {
      name: 'Moteur de règles : calcul reproductible et traçable, aucun taux codé en dur',
      run: async () => {
        const settings = getSettings(store, SAHEL);
        const employee = staffA[0];
        const preview = previewPayslip(employee, settings);
        const overtime = preview.components.find((component) => component.code === 'HEURES_SUP');
        assert(overtime && overtime.amountXof > 0, 'Heures supplémentaires rémunérées');
        const cnss = preview.components.find((component) => component.code === 'CNSS_SAL');
        assert(cnss && cnss.amountXof > 0, 'Cotisation CNSS calculée');
        const irpp = preview.components.find((component) => component.code === 'IRPP');
        assert(irpp !== undefined, 'Barème IRPP exécuté');
        assertEqual(preview.brutImposableXof, preview.brutXof - 15000, 'Indemnité de transport exonérée');
        assert(preview.netXof > 0 && preview.netXof < preview.brutXof, 'Net cohérent');
        const komlan = previewPayslip(staffA[4], settings);
        assert(komlan.impotsXof > 0, 'IRPP progressif non nul au-delà de la première tranche');

        const before = previewPayslip(employee, { ...settings, rules: cloneRules(PRESET_RULES) });
        const after = previewPayslip(employee, { ...settings, rules: cloneRules(PRESET_RULES).map((rule) => rule.code === 'PRIME_VENTES' ? { ...rule, ratePercent: 10 } : rule) });
        assertEqual(after.brutXof - before.brutXof, Math.round(412000 * 0.095), 'Delta de prime conforme au taux paramétré');
        assert(after.netXof > before.netXof, 'Net recalculé à la hausse');
      },
    },
    {
      name: 'Cycle : création depuis le pointage, doublon refusé, variables et recalcul',
      run: async () => {
        const created = await api(base, 'POST', `${A}/payroll/runs`, { period: currentPeriod, notes: 'Paie courante' }, { token: accountant });
        assertStatus(created, 201, 'Cycle créé');
        currentRunId = created.body.run.id as string;
        assertEqual(created.body.run.status, 'preparee', 'Statut préparée');
        assertEqual(created.body.run.preparedBy, 'usr_accountant', 'Préparateur tracé');
        assertEqual(created.body.run.totals.headcount, 5, 'Cinq bulletins');
        assert(created.body.run.totals.netXof > 0, 'Net total positif');
        assert(published.includes('PayrollRunCreated'), 'PayrollRunCreated publié');

        const duplicate = await api(base, 'POST', `${A}/payroll/runs`, { period: currentPeriod }, { token: accountant });
        assertStatus(duplicate, 409, 'Doublon refusé');
        assertEqual(duplicate.body.error.code, 'run_exists', 'Code run_exists');

        netsBeforeAdjustments = Object.fromEntries(
          created.body.run.payslips.map((line: { employeeId: string; netXof: number }) => [line.employeeId, line.netXof]),
        );
        const patched = await api(base, 'PATCH', `${A}/payroll/runs/${currentRunId}`, {
          adjustments: [
            { employeeId: 'emp_akouvi', type: 'prime', label: 'Prime exceptionnelle', amountXof: 10000 },
            { employeeId: 'emp_sena', type: 'avance', label: 'Avance loyer', amountXof: 5000 },
          ],
        }, { token: accountant });
        assertStatus(patched, 200, 'Variables appliquées');
        const akouvi = patched.body.run.payslips.find((line: { employeeId: string }) => line.employeeId === 'emp_akouvi');
        const sena = patched.body.run.payslips.find((line: { employeeId: string }) => line.employeeId === 'emp_sena');
        assertEqual(akouvi.netXof, netsBeforeAdjustments.emp_akouvi + 10000, 'Prime ajoutée au net');
        assertEqual(sena.netXof, netsBeforeAdjustments.emp_sena - 5000, 'Avance déduite du net');
        assert(akouvi.adjustments.some((entry: { label: string }) => entry.label === 'Prime exceptionnelle'), 'Variable tracée sur le bulletin');

        const invalidAdjustment = await api(base, 'PATCH', `${A}/payroll/runs/${currentRunId}`, {
          adjustments: [{ employeeId: 'emp_unknown', type: 'prime', label: 'X', amountXof: 1000 }],
        }, { token: accountant });
        assertStatus(invalidAdjustment, 422, 'Collaborateur hors cycle refusé');

        const recalculated = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/recalculate`, {}, { token: accountant });
        assertStatus(recalculated, 200, 'Recalcul réussi');
        assertEqual(recalculated.body.run.adjustments.length, 0, 'Variables réinitialisées');
        assertEqual(recalculated.body.run.payslips.find((line: { employeeId: string }) => line.employeeId === 'emp_akouvi').netXof, netsBeforeAdjustments.emp_akouvi, 'Net recalculé depuis le pointage');
      },
    },
    {
      name: 'Validation à deux niveaux : séparation des devoirs et archivage PDF',
      run: async () => {
        const preparedByOwner = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/recalculate`, {}, { token: owner });
        assertStatus(preparedByOwner, 200, 'Recalcul par le gérant');
        assertEqual(preparedByOwner.body.run.preparedBy, 'usr_owner', 'Préparateur = gérant');

        const selfApproval = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/validate`, {}, { token: owner });
        assertStatus(selfApproval, 403, 'Auto-validation interdite');
        assertEqual(selfApproval.body.error.code, 'segregation_of_duties', 'Code segregation_of_duties');

        const approved = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/validate`, {}, { token: owner2 });
        assertStatus(approved, 200, 'Validation par un second responsable');
        assertEqual(approved.body.run.status, 'validee', 'Statut validée');
        assertEqual(approved.body.run.validatedBy, 'usr_owner2', 'Validateur tracé');
        assertEqual(approved.body.run.pdfReady, true, 'Bulletins archivés en PDF');
        assert(published.includes('PayrollApproved'), 'PayrollApproved publié');

        const twice = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/validate`, {}, { token: owner2 });
        assertStatus(twice, 409, 'Double validation refusée');

        const sendDenied = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/bulletins/send`, {}, { token: waiter });
        assertStatus(sendDenied, 403, 'Envoi réservé à payroll:prepare');
        const sent = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/bulletins/send`, {}, { token: accountant });
        assertStatus(sent, 200, 'Bulletins envoyés');
        assertEqual(sent.body.sent, 5, 'Cinq bulletins envoyés');
        assertEqual(sent.body.delivery, 'simulee', 'Envoi simulé');
        assert(published.includes('PayslipsSent'), 'PayslipsSent publié');

        const pdfResponse = await fetch(`${base}${A}/payroll/runs/${currentRunId}/bulletins/emp_akouvi/pdf`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        assertEqual(pdfResponse.status, 200, 'Téléchargement du bulletin');
        const bytes = Buffer.from(await pdfResponse.arrayBuffer());
        assertEqual(bytes.subarray(0, 4).toString(), '%PDF', 'Bulletin PDF valide');
        assert((pdfResponse.headers.get('content-type') ?? '').includes('application/pdf'), 'Type PDF annoncé');

        const foreignPdf = await fetch(`${base}${A}/payroll/runs/${currentRunId}/bulletins/emp_ama/pdf`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        assertEqual(foreignPdf.status, 404, 'Bulletin d’un autre établissement introuvable');
      },
    },
    {
      name: 'Exports : CSV, règles et journal PDF',
      run: async () => {
        const csv = await api<string>(base, 'GET', `${A}/payroll/runs/${currentRunId}/exports/csv`, undefined, { token: owner });
        assertStatus(csv, 200, 'Export CSV');
        assert(csv.body.includes('Collaborateur') && csv.body.includes('Akouvi Mensah'), 'Lignes de paie exportées');
        const rules = await api<string>(base, 'GET', `${A}/payroll/runs/${currentRunId}/exports/rules.csv`, undefined, { token: owner });
        assertStatus(rules, 200, 'Export des règles');
        assert(rules.body.includes('HEURES_SUP') && rules.body.includes('IRPP'), 'Règles validées exportées');
        const xls = await api<string>(base, 'GET', `${A}/payroll/runs/${currentRunId}/exports/xls`, undefined, { token: owner });
        assertStatus(xls, 200, 'Export Excel');
        const pdf = await fetch(`${base}${A}/payroll/runs/${currentRunId}/exports/pdf`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        const bytes = Buffer.from(await pdf.arrayBuffer());
        assertEqual(bytes.subarray(0, 4).toString(), '%PDF', 'Journal de paie PDF');
        const denied = await api(base, 'GET', `${A}/payroll/runs/${currentRunId}/exports/csv`, undefined, { token: waiter });
        assertStatus(denied, 403, 'Export refusé sans report:export');
      },
    },
    {
      name: 'Paiement groupé : portefeuille insuffisant, rejeu, verrouillage',
      run: async () => {
        const runBefore = await api(base, 'GET', `${A}/payroll/runs/${currentRunId}`, undefined, { token: owner });
        assertEqual(runBefore.body.run.status, 'validee', 'Cycle validé en attente de paiement');

        paymentMode = 'insufficient';
        const failed = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/pay`, {}, { token: owner });
        assertStatus(failed, 200, 'Tentative de paiement traitée');
        assertEqual(failed.body.run.status, 'a_rejouer', 'Statut à rejouer');
        assertEqual(failed.body.run.payment.status, 'a_rejouer', 'Échec de lot tracé');
        assert(failed.body.run.payment.message.includes('Portefeuille'), 'Motif lisible');
        assert(published.includes('PayrollPaymentFailed'), 'PayrollPaymentFailed publié');

        paymentMode = 'ok';
        const paid = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/pay`, {}, { token: owner });
        assertStatus(paid, 200, 'Rejeu réussi');
        assertEqual(paid.body.run.status, 'reussi', 'Statut réussi');
        assertEqual(paid.body.run.locked, true, 'Cycle verrouillé');
        assertEqual(paid.body.run.attempts.length, 4, 'Quatre tentatives historisées (dont deux en cours)');
        assert(published.includes('PayrollPaid'), 'PayrollPaid publié');
        const lastDisbursement = disbursements[disbursements.length - 1] as { items: unknown[]; reference: string };
        assertEqual(lastDisbursement.items.length, 5, 'Cinq versements transmis');
        assert(lastDisbursement.reference.startsWith('PAY-'), 'Référence de lot normalisée');

        const batches = await api(base, 'GET', `${A}/payroll/runs/${currentRunId}/batches`, undefined, { token: accountant });
        assertStatus(batches, 200, 'Suivi des lots');
        assertEqual(batches.body.attempts.length, 4, 'Historique exposé');

        const again = await api(base, 'POST', `${A}/payroll/runs/${currentRunId}/pay`, {}, { token: owner });
        assertStatus(again, 409, 'Cycle verrouillé non repayeable');
        const edited = await api(base, 'PATCH', `${A}/payroll/runs/${currentRunId}`, { notes: 'X' }, { token: accountant });
        assertStatus(edited, 409, 'Cycle verrouillé non modifiable');
      },
    },
    {
      name: 'Événements : StaffUpdated invalide la préparation, retenue bloque le paiement',
      run: async () => {
        const created = await api(base, 'POST', `${A}/payroll/runs`, { period: monthsAgo(2) }, { token: accountant });
        assertStatus(created, 201, 'Cycle du mois M-2 créé');
        validationRunId = created.body.run.id as string;

        handlePayrollEvent(store, SAHEL, { type: 'StaffUpdated', payload: { tenantId: SAHEL, employeeId: 'emp_akouvi' } });
        const invalidated = await api(base, 'GET', `${A}/payroll/runs/${validationRunId}`, undefined, { token: accountant });
        assertEqual(invalidated.body.run.status, 'brouillon', 'Cycle invalidé après modification du personnel');
        assert(invalidated.body.run.staleReason?.includes('recalcul'), 'Motif d’invalidation explicite');
        assertEqual(invalidated.body.run.validatedBy, null, 'Validation effacée');

        const recalculated = await api(base, 'POST', `${A}/payroll/runs/${validationRunId}/recalculate`, {}, { token: accountant });
        assertStatus(recalculated, 200, 'Recalcul après invalidation');
        const approved = await api(base, 'POST', `${A}/payroll/runs/${validationRunId}/validate`, {}, { token: owner });
        assertStatus(approved, 200, 'Nouvelle validation');

        handlePayrollEvent(store, SAHEL, { type: 'RetentionDecided', payload: { tenantId: SAHEL, decision: 'approuve' } });
        const blocked = await api(base, 'POST', `${A}/payroll/runs/${validationRunId}/pay`, {}, { token: owner });
        assertStatus(blocked, 409, 'Paiement bloqué par retenue');
        assertEqual(blocked.body.error.code, 'retention_blocked', 'Code retention_blocked');

        handlePayrollEvent(store, SAHEL, { type: 'RetentionDecided', payload: { tenantId: SAHEL, decision: 'refuse' } });
        const ready = await api(base, 'GET', `${A}/payroll/runs/${validationRunId}`, undefined, { token: owner });
        assertEqual(ready.body.run.retentionBlocked, false, 'Retenue levée');
      },
    },
    {
      name: 'Contrôle d’effectif : écart entre préparation et paiement détecté',
      run: async () => {
        extraEmployee = true;
        const created = await api(base, 'POST', `${A}/payroll/runs`, { period: monthsAgo(3) }, { token: accountant });
        assertStatus(created, 201, 'Cycle M-3 créé');
        headcountRunId = created.body.run.id as string;
        assertEqual(created.body.run.totals.headcount, 6, 'Six collaborateurs préparés');
        extraEmployee = false;

        const approved = await api(base, 'POST', `${A}/payroll/runs/${headcountRunId}/validate`, {}, { token: owner });
        assertStatus(approved, 200, 'Validation avec six bulletins');
        const blocked = await api(base, 'POST', `${A}/payroll/runs/${headcountRunId}/pay`, {}, { token: owner });
        assertStatus(blocked, 422, 'Paiement refusé sur effectif divergent');
        assertEqual(blocked.body.error.code, 'headcount_changed', 'Code headcount_changed');
        assertEqual(blocked.body.error.details.liveHeadcount, 5, 'Effectif réel exposé');
      },
    },
    {
      name: 'RBAC paiement : payroll:pay requis',
      run: async () => {
        const denied = await api(base, 'POST', `${A}/payroll/runs/${validationRunId}/pay`, {}, { token: accountant });
        assertStatus(denied, 403, 'Comptable sans payroll:pay');
      },
    },
    {
      name: 'Audit : chaîne immuable et filtrée par tenant',
      run: async () => {
        const audit = await api(base, 'GET', `${A}/payroll/audit`, undefined, { token: accountant });
        assertStatus(audit, 200, 'Journal de paie');
        assertEqual(audit.body.integrity, true, 'Chaîne intacte');
        const actions = audit.body.entries.map((entry: { action: string }) => entry.action);
        assert(actions.includes('payroll.run.validated'), 'Validation auditée');
        assert(actions.includes('payroll.run.paid'), 'Paiement audité');
        assert(actions.includes('payroll.settings.updated'), 'Paramétrage audité');
        assert(
          audit.body.entries.every((entry: { tenantId: string }) => entry.tenantId === SAHEL),
          'Filtré par tenant',
        );
      },
    },
  ];

  await runTests('payroll-service — isolation, règles et paie', cases);
  await server.close();
  await staffServer.close();
  await paymentServer.close();
  await tenantServer.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log(`Événements publiés : ${[...new Set(published)].join(', ')}`);
  console.log(`Versements transmis : ${disbursements.length}`);
  console.log(`Règles actives : ${defaultSettings('tnt_demo').rules.filter((rule) => rule.enabled).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
