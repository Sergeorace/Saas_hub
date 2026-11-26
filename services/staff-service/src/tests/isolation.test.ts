import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildStaffApp, handleStaffEvent } from '../app.js';
import { createStaffStore, seedStaffDemo, todayString } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';

function claims(sub: string, name: string, tenantPermissions: Record<string, string[]>): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name,
    mfa: false,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

async function main() {
  const store = createStaffStore();
  seedStaffDemo(store);
  const bus = createEventBus({ name: 'staff-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const published: Array<{ type: string; tenantId: string | null }> = [];

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const ownerSahel = register(
    'token-owner-sahel',
    claims('usr_owner_sahel', 'Gérant Sahel', { [SAHEL]: ['staff:view', 'staff:manage', 'payroll:view'] }),
  );
  const ownerBaobab = register(
    'token-owner-baobab',
    claims('usr_owner_baobab', 'Gérant Baobab', { [BAOBAB]: ['staff:view', 'staff:manage'] }),
  );
  const waiterSahel = register(
    'token-waiter-sahel',
    claims('usr_waiter_sahel', 'Serveur Sahel', { [SAHEL]: ['pos:operate'] }),
  );

  const server = await startServer(
    {
      name: 'staff-service-test',
      routes: buildStaffApp({
        store,
        publish: async (type, tenantId, payload) => {
          published.push({ type, tenantId });
          return bus.publish(type, tenantId, payload);
        },
      }),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;

  const cases: TestCase[] = [
    {
      name: 'Isolation : un gérant ne voit que les employés de son établissement',
      run: async () => {
        const own = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/employees`, undefined, {
          token: ownerSahel,
        });
        assertStatus(own, 200, 'Liste employés Sahel');
        assertEqual(own.body.count, 5, 'Cinq employés Sahel');
        assert(
          own.body.items.every((employee: { tenantId: string }) => employee.tenantId === SAHEL),
          'Aucun employé d’un autre établissement',
        );
        const cross = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/employees`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(cross, 403, 'Accès croisé refusé');
        const foreignEmployee = await api(base, 'GET', `/api/v1/tenants/${BAOBAB}/staff/employees/emp_akouvi`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(foreignEmployee, 404, 'Employé hors tenant invisible');
        const wrongTenantPath = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/employees/emp_ama`, undefined, {
          token: ownerSahel,
        });
        assertStatus(wrongTenantPath, 404, 'Employé d’un autre tenant introuvable');
      },
    },
    {
      name: 'RBAC : staff:view requis, un serveur est refusé',
      run: async () => {
        const denied = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/summary`, undefined, {
          token: waiterSahel,
        });
        assertStatus(denied, 403, 'Serveur sans staff:view');
        const manageDenied = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/employees`,
          { name: 'Test', phone: '+228 90 00 00 00', jobTitle: 'Serveur' },
          { token: waiterSahel },
        );
        assertStatus(manageDenied, 403, 'Création employé refusée');
      },
    },
    {
      name: 'Employé : création, fiche, documents, performance',
      run: async () => {
        const created = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/employees`,
          {
            name: 'Adjoa Kponton',
            phone: '+228 90 99 88 77',
            email: 'adjoa@sahelgrill.tg',
            jobTitle: 'Hôtesse',
            roleCode: 'hostess',
            baseSalaryXof: 135000,
            paymentMethod: 'mobile_money',
            paymentDestination: 'TMoney 90 99 88 77',
          },
          { token: ownerSahel },
        );
        assertStatus(created, 201, 'Employé créé');
        assertEqual(created.body.employee.status, 'actif', 'Statut actif');
        assertEqual(created.body.employee.pinMasked, '••••', 'PIN masqué dans la réponse');
        const employeeId = created.body.employee.id as string;

        const document = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/employees/${employeeId}/documents`,
          { name: 'Attestation CNSS.pdf', type: 'social' },
          { token: ownerSahel },
        );
        assertStatus(document, 201, 'Document ajouté');
        assertEqual(document.body.employee.documents.length, 1, 'Un document');

        const detail = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/employees/${employeeId}`, undefined, {
          token: ownerSahel,
        });
        assertStatus(detail, 200, 'Fiche employé');
        assertEqual(detail.body.performance.salesXof, 0, 'Aucune vente initiale');
        assert(published.some((event) => event.type === 'StaffUpdated'), 'StaffUpdated publié');
      },
    },
    {
      name: 'Invitation : envoi, acceptation avec PIN, anti-réutilisation',
      run: async () => {
        const invite = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/invitations`,
          {
            name: 'Dodji Amouzou',
            phone: '+228 90 12 12 12',
            email: 'dodji@sahelgrill.tg',
            jobTitle: 'Livreur',
            roleCode: 'delivery',
          },
          { token: ownerSahel },
        );
        assertStatus(invite, 201, 'Invitation créée');
        assertEqual(invite.body.invitation.channel, 'email', 'Canal e-mail');
        assertEqual(invite.body.employee.status, 'invite', 'Statut invité');
        const token = invite.body.invitation.token as string;
        assert(published.some((event) => event.type === 'StaffInvited'), 'StaffInvited publié');

        const crossAccept = await api(base, 'POST', `/api/v1/tenants/${BAOBAB}/staff/invitations/${token}/accept`, {});
        assertStatus(crossAccept, 404, 'Invitation inaccessible depuis un autre tenant');

        const accepted = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/invitations/${token}/accept`, {
          pin: '8642',
        });
        assertStatus(accepted, 200, 'Invitation acceptée');
        assertEqual(accepted.body.employee.status, 'actif', 'Employé activé');
        assert(published.some((event) => event.type === 'StaffActivated'), 'StaffActivated publié');

        const reused = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/invitations/${token}/accept`, {});
        assertStatus(reused, 409, 'Invitation non réutilisable');

        const resend = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/invitations/${token}/resend`, undefined, {
          token: ownerSahel,
        });
        assertStatus(resend, 409, 'Renvoi impossible après acceptation');
      },
    },
    {
      name: 'Planning : chevauchement refusé, publication et échange approuvé',
      run: async () => {
        const date = todayString();
        const first = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/shifts`,
          { employeeId: 'emp_yawa', date, start: '08:00', end: '14:00', station: 'caisse', status: 'publie' },
          { token: ownerSahel },
        );
        assertStatus(first, 201, 'Shift créé');
        assert(published.some((event) => event.type === 'ShiftPublished'), 'ShiftPublished publié');
        const overlap = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/shifts`,
          { employeeId: 'emp_yawa', date, start: '13:00', end: '19:00', station: 'caisse' },
          { token: ownerSahel },
        );
        assertStatus(overlap, 409, 'Chevauchement refusé');

        const swap = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/shifts/${first.body.shift.id}/swap`,
          { toEmployeeId: 'emp_sena' },
          { token: ownerSahel },
        );
        assertStatus(swap, 201, 'Échange demandé');
        const decided = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/swaps/${swap.body.swap.id}/decide`,
          { decision: 'approuve' },
          { token: ownerSahel },
        );
        assertStatus(decided, 200, 'Échange approuvé');
        assertEqual(decided.body.shift.employeeId, 'emp_sena', 'Shift transféré');
        const again = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/swaps/${swap.body.swap.id}/decide`,
          { decision: 'refuse' },
          { token: ownerSahel },
        );
        assertStatus(again, 409, 'Décision déjà prise');
      },
    },
    {
      name: 'Congés : demande calculée, décision unique, absence sans doublon',
      run: async () => {
        const leave = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/leaves`,
          { employeeId: 'emp_kossi', type: 'sans_solde', from: '2026-12-01', to: '2026-12-03', reason: 'Voyage' },
          { token: ownerSahel },
        );
        assertStatus(leave, 201, 'Congé demandé');
        assertEqual(leave.body.leave.days, 3, 'Trois jours');
        const decide = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/leaves/${leave.body.leave.id}/decide`,
          { decision: 'approuve' },
          { token: ownerSahel },
        );
        assertStatus(decide, 200, 'Congé approuvé');
        assert(published.some((event) => event.type === 'LeaveDecided'), 'LeaveDecided publié');

        const absence = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/absences`,
          { employeeId: 'emp_sena', date: '2026-12-05', reason: 'Non venu' },
          { token: ownerSahel },
        );
        assertStatus(absence, 201, 'Absence enregistrée');
        const duplicate = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/absences`,
          { employeeId: 'emp_sena', date: '2026-12-05' },
          { token: ownerSahel },
        );
        assertStatus(duplicate, 409, 'Absence déjà enregistrée');
      },
    },
    {
      name: 'Pointage : PIN, anti-double, QR, géofence et clôture',
      run: async () => {
        const wrong = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, { pin: '0000' });
        assertStatus(wrong, 422, 'PIN inconnu refusé');
        assertEqual(wrong.body.error.code, 'badge_invalid', 'Code badge_invalid');

        const clockIn = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, { pin: '5678' });
        assertStatus(clockIn, 201, 'Pointage entrée PIN');
        assert(published.some((event) => event.type === 'AttendanceClocked'), 'AttendanceClocked publié');
        const duplicate = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, { pin: '5678' });
        assertStatus(duplicate, 409, 'Double pointage refusé');

        const settings = await api(
          base,
          'PUT',
          `/api/v1/tenants/${SAHEL}/staff/settings`,
          { geofence: { lat: 6.1319, lng: 1.2228, radiusM: 150 } },
          { token: ownerSahel },
        );
        assertStatus(settings, 200, 'Géofence configurée');
        const noGeo = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, { pin: '2345' });
        assertStatus(noGeo, 422, 'Géolocalisation requise');
        assertEqual(noGeo.body.error.code, 'geolocation_required', 'Code geolocation_required');
        const outside = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, {
          pin: '2345',
          lat: 6.2,
          lng: 1.35,
        });
        assertStatus(outside, 422, 'Hors périmètre refusé');
        assertEqual(outside.body.error.code, 'outside_geofence', 'Code outside_geofence');
        const inside = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, {
          pin: '2345',
          lat: 6.132,
          lng: 1.2229,
        });
        assertStatus(inside, 201, 'Pointage dans le périmètre');
        const qr = await api(base, 'POST', `/api/v1/tenants/${SAHEL}/staff/attendance/clock`, {
          qrToken: store.employees.get('emp_yawa')?.qrToken,
          lat: 6.1319,
          lng: 1.2228,
        });
        assertStatus(qr, 201, 'Pointage QR');

        const clockOut = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/attendance/${clockIn.body.attendance.id}/clock-out`,
          {},
          { token: ownerSahel },
        );
        assertStatus(clockOut, 200, 'Sortie enregistrée');
        assert(typeof clockOut.body.attendance.clockOut === 'string', 'Heure de sortie renseignée');
        const twice = await api(
          base,
          'POST',
          `/api/v1/tenants/${SAHEL}/staff/attendance/${clockIn.body.attendance.id}/clock-out`,
          {},
          { token: ownerSahel },
        );
        assertStatus(twice, 409, 'Double sortie refusée');
      },
    },
    {
      name: 'Performances : OrderPaid et pourboires attribués une seule fois',
      run: async () => {
        const before = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/performance`, undefined, {
          token: ownerSahel,
        });
        assertStatus(before, 200, 'Performances');
        const akouviBefore = before.body.items.find((item: { employeeId: string }) => item.employeeId === 'emp_akouvi');
        handleStaffEvent(store, SAHEL, {
          type: 'OrderPaid',
          payload: { tenantId: SAHEL, orderId: 'ord_test_1', waiterId: 'emp_akouvi', totalXof: 14500, tableCode: 'T12' },
        });
        handleStaffEvent(store, SAHEL, {
          type: 'OrderPaid',
          payload: { tenantId: SAHEL, orderId: 'ord_test_1', waiterId: 'emp_akouvi', totalXof: 14500, tableCode: 'T12' },
        });
        handleStaffEvent(store, BAOBAB, {
          type: 'OrderPaid',
          payload: { tenantId: BAOBAB, orderId: 'ord_test_2', waiterId: 'emp_akouvi', totalXof: 99000 },
        });
        handleStaffEvent(store, SAHEL, {
          type: 'TipDistributed',
          payload: {
            tenantId: SAHEL,
            transactionId: 'tx_tip_1',
            allocations: [{ staffId: 'emp_akouvi', amountXof: 1500 }],
          },
        });
        handleStaffEvent(store, SAHEL, {
          type: 'TipDistributed',
          payload: {
            tenantId: SAHEL,
            transactionId: 'tx_tip_1',
            allocations: [{ staffId: 'emp_akouvi', amountXof: 1500 }],
          },
        });
        const after = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/performance`, undefined, {
          token: ownerSahel,
        });
        const akouviAfter = after.body.items.find((item: { employeeId: string }) => item.employeeId === 'emp_akouvi');
        assertEqual(akouviAfter.salesXof - akouviBefore.salesXof, 14500, 'Vente comptée une seule fois');
        assertEqual(akouviAfter.orders - akouviBefore.orders, 1, 'Commande comptée une seule fois');
        assertEqual(akouviAfter.tablesServed - akouviBefore.tablesServed, 1, 'Table servie comptée');
        assertEqual(akouviAfter.tipsXof - akouviBefore.tipsXof, 1500, 'Pourboire idempotent');
      },
    },
    {
      name: 'Paie : entrées internes réservées au service et calcul des heures',
      run: async () => {
        const forbidden = await api(base, 'GET', `/internal/tenants/${SAHEL}/staff/payroll-input?period=${todayString().slice(0, 7)}`);
        assert(forbidden.status === 401 || forbidden.status === 403, 'Accès interne refusé sans clé');
        const internal = await api(
          base,
          'GET',
          `/internal/tenants/${SAHEL}/staff/payroll-input?period=${todayString().slice(0, 7)}`,
          undefined,
          { internalKey: INTERNAL_KEY },
        );
        assertStatus(internal, 200, 'Entrées de paie');
        const akouvi = internal.body.employees.find((employee: { employeeId: string }) => employee.employeeId === 'emp_akouvi');
        assert(akouvi.daysPresent >= 10, 'Jours pointés');
        assert(akouvi.overtimeHours > 0, 'Heures supplémentaires détectées');
        assertEqual(akouvi.baseSalaryXof, 140000, 'Salaire de base');
        assert(
          internal.body.employees.every((employee: { employeeId: string }) => employee.employeeId !== 'emp_ama'),
          'Aucun employé d’un autre tenant',
        );
      },
    },
    {
      name: 'Audit : chaîne d’intégrité vérifiée',
      run: async () => {
        const audit = await api(base, 'GET', `/api/v1/tenants/${SAHEL}/staff/audit`, undefined, {
          token: ownerSahel,
        });
        assertStatus(audit, 200, 'Journal d’audit');
        assert(audit.body.entries.length > 0, 'Entrées présentes');
        assertEqual(audit.body.integrity, true, 'Chaîne intacte');
        assert(
          audit.body.entries.every((entry: { tenantId: string }) => entry.tenantId === SAHEL),
          'Audit filtré par tenant',
        );
      },
    },
  ];

  await runTests('staff-service — isolation et parcours', cases);
  await server.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log(`Événements publiés : ${published.map((event) => event.type).join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
