import {
  HttpError,
  asObject,
  newId,
  optionalEmail,
  optionalString,
  randomToken,
  requireEnum,
  requirePhone,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type Route,
} from '@resto-hub/service-kit';
import {
  CONTRACT_TYPES,
  LEAVE_TYPES,
  PAYMENT_METHODS,
  SHIFT_STATIONS,
  SHIFT_STATUSES,
  STAFF_STATUSES,
  getPerformance,
  minutesBetween,
  newPin,
  serializeEmployee,
  todayString,
  type AttendanceRecord,
  type ContractType,
  type Employee,
  type LeaveRequest,
  type LeaveType,
  type Shift,
  type ShiftStation,
  type StaffPaymentMethod,
  type StaffStore,
  type SwapRequest,
} from './store.js';

export interface StaffAppOptions {
  store: StaffStore;
  publish: (type: string, tenantId: string | null, payload: Record<string, unknown>) => Promise<unknown>;
}

function isoNow(): string {
  return new Date().toISOString();
}

function employeeName(store: StaffStore, employeeId: string): string {
  return store.employees.get(employeeId)?.name ?? employeeId;
}

function serializeShift(store: StaffStore, shift: Shift) {
  return {
    ...shift,
    employeeName: employeeName(store, shift.employeeId),
  };
}

function serializeSwap(store: StaffStore, swap: SwapRequest) {
  return {
    ...swap,
    fromEmployeeName: employeeName(store, swap.fromEmployeeId),
    toEmployeeName: employeeName(store, swap.toEmployeeId),
    shift: store.shifts.get(swap.shiftId) ?? null,
  };
}

function serializeLeave(store: StaffStore, leave: LeaveRequest) {
  return {
    ...leave,
    employeeName: employeeName(store, leave.employeeId),
  };
}

function findOpenAttendance(store: StaffStore, tenantId: string, employeeId: string, date: string) {
  return [...store.attendance.values()].find(
    (record) => record.tenantId === tenantId && record.employeeId === employeeId && record.date === date && !record.clockOut,
  );
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function periodRange(period: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw HttpError.unprocessable('validation_error', 'Période attendue au format AAAA-MM.', { field: 'period' });
  }
  const [year, month] = period.split('-').map(Number);
  const start = `${period}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${period}-${String(endDay).padStart(2, '0')}` };
}

export function buildStaffApp(options: StaffAppOptions): Route[] {
  const { store, publish } = options;

  return [
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/summary',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const employees = [...store.employees.values()].filter((employee) => employee.tenantId === tenantId);
        const today = todayString();
        const shiftsToday = [...store.shifts.values()].filter((shift) => shift.tenantId === tenantId && shift.date === today);
        const attendanceToday = [...store.attendance.values()].filter(
          (record) => record.tenantId === tenantId && record.date === today,
        );
        const leaves = [...store.leaves.values()].filter((leave) => leave.tenantId === tenantId);
        const swaps = [...store.swaps.values()].filter((swap) => swap.tenantId === tenantId && swap.status === 'en_attente');
        const performance = [...store.performance.values()].filter((record) => record.tenantId === tenantId);
        return {
          body: {
            tenantId,
            employees: {
              total: employees.length,
              active: employees.filter((employee) => employee.status === 'actif').length,
              invited: employees.filter((employee) => employee.status === 'invite').length,
              suspended: employees.filter((employee) => employee.status === 'suspendu').length,
            },
            today: {
              date: today,
              shifts: shiftsToday.length,
              present: attendanceToday.filter((record) => !record.clockOut).length + attendanceToday.filter((record) => record.clockOut).length,
              stillClockedIn: attendanceToday.filter((record) => !record.clockOut).length,
            },
            pending: {
              leaves: leaves.filter((leave) => leave.status === 'en_attente').length,
              swaps: swaps.length,
            },
            tipsXof: performance.reduce((sum, record) => sum + record.tipsXof, 0),
            salesXof: performance.reduce((sum, record) => sum + record.salesXof, 0),
            generatedAt: isoNow(),
          },
        };
      },
    },

    /* ----------------------------- Employés ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/employees',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const statusFilter = ctx.query.get('status');
        const query = (ctx.query.get('q') ?? '').toLowerCase();
        const items = [...store.employees.values()]
          .filter((employee) => employee.tenantId === tenantId)
          .filter((employee) => !statusFilter || employee.status === statusFilter)
          .filter((employee) => !query || `${employee.name} ${employee.jobTitle} ${employee.email ?? ''}`.toLowerCase().includes(query))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(serializeEmployee);
        return { body: { tenantId, items, count: items.length } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/employees',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        const now = isoNow();
        const employee: Employee = {
          id: newId('emp'),
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          phone: requirePhone(body, 'phone'),
          email: optionalEmail(body) ?? null,
          jobTitle: requireString(body, 'jobTitle', { min: 2, max: 60 }),
          roleCode: optionalString(body, 'roleCode', { max: 40 }) ?? 'waiter',
          contractType: body.contractType ? requireEnum(body, 'contractType', CONTRACT_TYPES) : ('cdi' as ContractType),
          hireDate: optionalString(body, 'hireDate', { max: 10 }) ?? todayString(),
          baseSalaryXof: typeof body.baseSalaryXof === 'number' ? Math.round(body.baseSalaryXof) : 0,
          paymentMethod: body.paymentMethod ? requireEnum(body, 'paymentMethod', PAYMENT_METHODS) : ('mobile_money' as StaffPaymentMethod),
          paymentDestination: optionalString(body, 'paymentDestination', { max: 120 }) ?? 'Mobile Money',
          documents: [],
          status: 'actif',
          pin: newPin(),
          qrToken: randomToken(12),
          userId: optionalString(body, 'userId', { max: 60 }) ?? null,
          createdAt: now,
          updatedAt: now,
          activatedAt: now,
        };
        if (employee.baseSalaryXof < 0) throw HttpError.unprocessable('validation_error', 'Salaire de base invalide.', { field: 'baseSalaryXof' });
        store.employees.set(employee.id, employee);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.employee.created',
          targetType: 'employee',
          targetId: employee.id,
          meta: { name: employee.name, roleCode: employee.roleCode },
        });
        await publish('StaffUpdated', tenantId, { tenantId, employeeId: employee.id, action: 'created', at: now });
        return { status: 201, body: { employee: serializeEmployee(employee) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/employees/:id',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const employee = store.employees.get(ctx.params.id ?? '');
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const performance = getPerformance(store, tenantId, employee.id);
        const attendance = [...store.attendance.values()]
          .filter((record) => record.tenantId === tenantId && record.employeeId === employee.id)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 31);
        const shifts = [...store.shifts.values()]
          .filter((shift) => shift.tenantId === tenantId && shift.employeeId === employee.id)
          .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
        return {
          body: {
            employee: serializeEmployee(employee),
            performance,
            attendance,
            shifts: shifts.map((shift) => serializeShift(store, shift)),
          },
        };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/staff/employees/:id',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const employee = store.employees.get(ctx.params.id ?? '');
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const body = asObject(ctx.body);
        if (body.name !== undefined) employee.name = requireString(body, 'name', { min: 2, max: 80 });
        if (body.phone !== undefined) employee.phone = requirePhone(body, 'phone');
        if (body.email !== undefined) employee.email = optionalEmail(body) ?? null;
        if (body.jobTitle !== undefined) employee.jobTitle = requireString(body, 'jobTitle', { min: 2, max: 60 });
        if (body.roleCode !== undefined) employee.roleCode = requireString(body, 'roleCode', { max: 40 });
        if (body.contractType !== undefined) employee.contractType = requireEnum(body, 'contractType', CONTRACT_TYPES);
        if (body.hireDate !== undefined) employee.hireDate = requireString(body, 'hireDate', { max: 10 });
        if (body.baseSalaryXof !== undefined) {
          if (typeof body.baseSalaryXof !== 'number' || body.baseSalaryXof < 0) {
            throw HttpError.unprocessable('validation_error', 'Salaire de base invalide.', { field: 'baseSalaryXof' });
          }
          employee.baseSalaryXof = Math.round(body.baseSalaryXof);
        }
        if (body.paymentMethod !== undefined) employee.paymentMethod = requireEnum(body, 'paymentMethod', PAYMENT_METHODS);
        if (body.paymentDestination !== undefined) {
          employee.paymentDestination = requireString(body, 'paymentDestination', { max: 120 });
        }
        if (body.status !== undefined) {
          employee.status = requireEnum(body, 'status', STAFF_STATUSES);
          if (employee.status === 'actif' && !employee.activatedAt) employee.activatedAt = isoNow();
        }
        employee.updatedAt = isoNow();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.employee.updated',
          targetType: 'employee',
          targetId: employee.id,
          meta: { fields: Object.keys(body) },
        });
        await publish('StaffUpdated', tenantId, { tenantId, employeeId: employee.id, action: 'updated', at: employee.updatedAt });
        return { body: { employee: serializeEmployee(employee) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/employees/:id/documents',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const employee = store.employees.get(ctx.params.id ?? '');
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const body = asObject(ctx.body);
        const document = {
          id: newId('doc'),
          name: requireString(body, 'name', { min: 2, max: 120 }),
          type: optionalString(body, 'type', { max: 40 }) ?? 'autre',
          uploadedAt: isoNow(),
        };
        employee.documents.push(document);
        employee.updatedAt = document.uploadedAt;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.document.added',
          targetType: 'employee',
          targetId: employee.id,
          meta: { documentId: document.id, name: document.name },
        });
        return { status: 201, body: { document, employee: serializeEmployee(employee) } };
      },
    },

    /* ----------------------------- Invitations ----------------------------- */
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/invitations',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        const channel = body.email ? 'email' : 'sms';
        const now = isoNow();
        const employee: Employee = {
          id: newId('emp'),
          tenantId,
          name: requireString(body, 'name', { min: 2, max: 80 }),
          phone: requirePhone(body, 'phone'),
          email: optionalEmail(body) ?? null,
          jobTitle: requireString(body, 'jobTitle', { min: 2, max: 60 }),
          roleCode: optionalString(body, 'roleCode', { max: 40 }) ?? 'waiter',
          contractType: 'cdi',
          hireDate: todayString(),
          baseSalaryXof: 0,
          paymentMethod: 'mobile_money',
          paymentDestination: 'Mobile Money',
          documents: [],
          status: 'invite',
          pin: newPin(),
          qrToken: randomToken(12),
          userId: null,
          createdAt: now,
          updatedAt: now,
          activatedAt: null,
        };
        store.employees.set(employee.id, employee);
        const invitation = {
          token: randomToken(24),
          tenantId,
          employeeId: employee.id,
          channel: channel as 'sms' | 'email',
          sentAt: now,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          acceptedAt: null,
        };
        store.invitations.set(invitation.token, invitation);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.invited',
          targetType: 'employee',
          targetId: employee.id,
          meta: { channel, email: employee.email, phone: employee.phone },
        });
        await publish('StaffInvited', tenantId, {
          tenantId,
          employeeId: employee.id,
          channel,
          at: now,
        });
        const destination = channel === 'email' ? employee.email : employee.phone;
        return {
          status: 201,
          body: {
            invitation: {
              token: invitation.token,
              channel,
              expiresAt: invitation.expiresAt,
              employeeId: employee.id,
              employeeName: employee.name,
              destination,
              link: `/staff/invitations/${invitation.token}/accept`,
              delivery: 'simulee',
            },
            employee: serializeEmployee(employee),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/invitations/:token/accept',
      auth: false,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const invitation = store.invitations.get(ctx.params.token ?? '');
        if (!invitation || invitation.tenantId !== tenantId) throw HttpError.notFound('Invitation introuvable.');
        if (invitation.acceptedAt) throw HttpError.conflict('invitation_already_used', 'Cette invitation a déjà été acceptée.');
        if (new Date(invitation.expiresAt).getTime() < Date.now()) {
          throw HttpError.unprocessable('invitation_expired', 'Cette invitation a expiré.');
        }
        const employee = store.employees.get(invitation.employeeId);
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const body = ctx.body ? asObject(ctx.body) : {};
        if (body.pin !== undefined) {
          const pin = String(body.pin);
          if (!/^\d{4}$/.test(pin)) throw HttpError.unprocessable('validation_error', 'Le PIN doit contenir 4 chiffres.', { field: 'pin' });
          employee.pin = pin;
        }
        const now = isoNow();
        invitation.acceptedAt = now;
        employee.status = 'actif';
        employee.activatedAt = now;
        employee.updatedAt = now;
        store.recordAudit({
          tenantId,
          actorId: employee.id,
          action: 'staff.invitation.accepted',
          targetType: 'employee',
          targetId: employee.id,
          meta: { channel: invitation.channel },
        });
        await publish('StaffActivated', tenantId, { tenantId, employeeId: employee.id, at: now });
        return { body: { employee: serializeEmployee(employee), acceptedAt: now } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/invitations/:token/resend',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const invitation = store.invitations.get(ctx.params.token ?? '');
        if (!invitation || invitation.tenantId !== tenantId) throw HttpError.notFound('Invitation introuvable.');
        if (invitation.acceptedAt) throw HttpError.conflict('invitation_already_used', 'Cette invitation a déjà été acceptée.');
        invitation.sentAt = isoNow();
        invitation.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.invitation.resent',
          targetType: 'employee',
          targetId: invitation.employeeId,
          meta: { channel: invitation.channel },
        });
        return { body: { invitation, delivery: 'simulee' } };
      },
    },

    /* ----------------------------- Plannings ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/shifts',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const from = ctx.query.get('from');
        const to = ctx.query.get('to');
        const items = [...store.shifts.values()]
          .filter((shift) => shift.tenantId === tenantId)
          .filter((shift) => (!from || shift.date >= from) && (!to || shift.date <= to))
          .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
          .map((shift) => serializeShift(store, shift));
        return { body: { tenantId, items, count: items.length } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/shifts',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        const employeeId = requireString(body, 'employeeId', { max: 60 });
        const employee = store.employees.get(employeeId);
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const date = requireString(body, 'date', { max: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw HttpError.unprocessable('validation_error', 'Date attendue au format AAAA-MM-JJ.', { field: 'date' });
        const start = requireString(body, 'start', { max: 5 });
        const end = requireString(body, 'end', { max: 5 });
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
          throw HttpError.unprocessable('validation_error', 'Plage horaire invalide.', { field: 'start' });
        }
        const overlap = [...store.shifts.values()].find(
          (shift) =>
            shift.tenantId === tenantId &&
            shift.employeeId === employeeId &&
            shift.date === date &&
            shift.status !== 'annule' &&
            start < shift.end &&
            end > shift.start,
        );
        if (overlap) throw HttpError.conflict('shift_overlap', 'Ce créneau chevauche un shift existant.');
        const now = isoNow();
        const shift: Shift = {
          id: newId('shf'),
          tenantId,
          employeeId,
          date,
          start,
          end,
          station: requireEnum(body, 'station', SHIFT_STATIONS) as ShiftStation,
          status: body.status ? requireEnum(body, 'status', SHIFT_STATUSES) : 'planifie',
          note: optionalString(body, 'note', { max: 160 }) ?? null,
          createdAt: now,
          updatedAt: now,
        };
        store.shifts.set(shift.id, shift);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.shift.created',
          targetType: 'shift',
          targetId: shift.id,
          meta: { employeeId, date, start, end, station: shift.station },
        });
        if (shift.status === 'publie') {
          await publish('ShiftPublished', tenantId, { tenantId, shiftId: shift.id, employeeId, date, at: now });
        }
        return { status: 201, body: { shift: serializeShift(store, shift) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/staff/shifts/:id',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const shift = store.shifts.get(ctx.params.id ?? '');
        if (!shift || shift.tenantId !== tenantId) throw HttpError.notFound('Shift introuvable.');
        const body = asObject(ctx.body);
        if (body.start !== undefined) shift.start = requireString(body, 'start', { max: 5 });
        if (body.end !== undefined) shift.end = requireString(body, 'end', { max: 5 });
        if (shift.end <= shift.start) throw HttpError.unprocessable('validation_error', 'Plage horaire invalide.', { field: 'end' });
        if (body.station !== undefined) shift.station = requireEnum(body, 'station', SHIFT_STATIONS);
        if (body.note !== undefined) shift.note = optionalString(body, 'note', { max: 160 }) ?? null;
        if (body.status !== undefined) shift.status = requireEnum(body, 'status', SHIFT_STATUSES);
        shift.updatedAt = isoNow();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.shift.updated',
          targetType: 'shift',
          targetId: shift.id,
          meta: { status: shift.status },
        });
        if (shift.status === 'publie') {
          await publish('ShiftPublished', tenantId, { tenantId, shiftId: shift.id, employeeId: shift.employeeId, date: shift.date, at: shift.updatedAt });
        }
        return { body: { shift: serializeShift(store, shift) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/shifts/:id/swap',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const shift = store.shifts.get(ctx.params.id ?? '');
        if (!shift || shift.tenantId !== tenantId) throw HttpError.notFound('Shift introuvable.');
        const body = asObject(ctx.body);
        const toEmployeeId = requireString(body, 'toEmployeeId', { max: 60 });
        const target = store.employees.get(toEmployeeId);
        if (!target || target.tenantId !== tenantId) throw HttpError.notFound('Employé cible introuvable.');
        if (toEmployeeId === shift.employeeId) {
          throw HttpError.unprocessable('validation_error', 'Le shift appartient déjà à cet employé.', { field: 'toEmployeeId' });
        }
        const now = isoNow();
        const swap: SwapRequest = {
          id: newId('swp'),
          tenantId,
          shiftId: shift.id,
          fromEmployeeId: shift.employeeId,
          toEmployeeId,
          status: 'en_attente',
          requestedBy: claims.sub,
          decidedBy: null,
          createdAt: now,
          decidedAt: null,
        };
        store.swaps.set(swap.id, swap);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.swap.requested',
          targetType: 'swap',
          targetId: swap.id,
          meta: { shiftId: shift.id, from: swap.fromEmployeeId, to: swap.toEmployeeId },
        });
        return { status: 201, body: { swap: serializeSwap(store, swap) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/swaps',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const items = [...store.swaps.values()]
          .filter((swap) => swap.tenantId === tenantId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((swap) => serializeSwap(store, swap));
        return { body: { tenantId, items } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/swaps/:id/decide',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const swap = store.swaps.get(ctx.params.id ?? '');
        if (!swap || swap.tenantId !== tenantId) throw HttpError.notFound('Demande d’échange introuvable.');
        if (swap.status !== 'en_attente') throw HttpError.conflict('swap_already_decided', 'Cette demande a déjà été traitée.');
        const body = asObject(ctx.body);
        const decision = requireEnum(body, 'decision', ['approuve', 'refuse'] as const);
        const shift = store.shifts.get(swap.shiftId);
        if (!shift || shift.tenantId !== tenantId) throw HttpError.notFound('Shift introuvable.');
        const now = isoNow();
        swap.status = decision;
        swap.decidedBy = claims.sub;
        swap.decidedAt = now;
        if (decision === 'approuve') {
          shift.employeeId = swap.toEmployeeId;
          shift.updatedAt = now;
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.swap.decided',
          targetType: 'swap',
          targetId: swap.id,
          meta: { decision, shiftId: shift.id },
        });
        await publish('ShiftSwapDecided', tenantId, {
          tenantId,
          swapId: swap.id,
          shiftId: shift.id,
          decision,
          at: now,
        });
        return { body: { swap: serializeSwap(store, swap), shift: serializeShift(store, shift) } };
      },
    },

    /* ----------------------------- Congés et absences ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/leaves',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const statusFilter = ctx.query.get('status');
        const items = [...store.leaves.values()]
          .filter((leave) => leave.tenantId === tenantId)
          .filter((leave) => !statusFilter || leave.status === statusFilter)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((leave) => serializeLeave(store, leave));
        return { body: { tenantId, items, counts: {
          en_attente: [...store.leaves.values()].filter((leave) => leave.tenantId === tenantId && leave.status === 'en_attente').length,
          approuve: [...store.leaves.values()].filter((leave) => leave.tenantId === tenantId && leave.status === 'approuve').length,
        } } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/leaves',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        const employeeId = requireString(body, 'employeeId', { max: 60 });
        const employee = store.employees.get(employeeId);
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const from = requireString(body, 'from', { max: 10 });
        const to = requireString(body, 'to', { max: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
          throw HttpError.unprocessable('validation_error', 'Période de congé invalide.', { field: 'from' });
        }
        const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
        const now = isoNow();
        const leave: LeaveRequest = {
          id: newId('lea'),
          tenantId,
          employeeId,
          type: requireEnum(body, 'type', LEAVE_TYPES) as LeaveType,
          from,
          to,
          days,
          reason: optionalString(body, 'reason', { max: 200 }) ?? null,
          status: 'en_attente',
          createdAt: now,
          decidedBy: null,
          decidedAt: null,
        };
        store.leaves.set(leave.id, leave);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.leave.requested',
          targetType: 'leave',
          targetId: leave.id,
          meta: { employeeId, type: leave.type, days },
        });
        return { status: 201, body: { leave: serializeLeave(store, leave) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/leaves/:id/decide',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const leave = store.leaves.get(ctx.params.id ?? '');
        if (!leave || leave.tenantId !== tenantId) throw HttpError.notFound('Demande de congé introuvable.');
        if (leave.status !== 'en_attente') throw HttpError.conflict('leave_already_decided', 'Cette demande a déjà été traitée.');
        const body = asObject(ctx.body);
        const decision = requireEnum(body, 'decision', ['approuve', 'refuse'] as const);
        leave.status = decision;
        leave.decidedBy = claims.sub;
        leave.decidedAt = isoNow();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.leave.decided',
          targetType: 'leave',
          targetId: leave.id,
          meta: { decision, employeeId: leave.employeeId, days: leave.days },
        });
        await publish('LeaveDecided', tenantId, {
          tenantId,
          leaveId: leave.id,
          employeeId: leave.employeeId,
          decision,
          from: leave.from,
          to: leave.to,
          at: leave.decidedAt,
        });
        return { body: { leave: serializeLeave(store, leave) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/absences',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        const employeeId = requireString(body, 'employeeId', { max: 60 });
        const employee = store.employees.get(employeeId);
        if (!employee || employee.tenantId !== tenantId) throw HttpError.notFound('Employé introuvable.');
        const date = requireString(body, 'date', { max: 10 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw HttpError.unprocessable('validation_error', 'Date attendue au format AAAA-MM-JJ.', { field: 'date' });
        const existing = [...store.leaves.values()].find(
          (leave) => leave.tenantId === tenantId && leave.employeeId === employeeId && leave.type === 'absence' && leave.from === date,
        );
        if (existing) throw HttpError.conflict('absence_exists', 'Une absence est déjà enregistrée pour cette date.');
        const now = isoNow();
        const leave: LeaveRequest = {
          id: newId('lea'),
          tenantId,
          employeeId,
          type: 'absence',
          from: date,
          to: date,
          days: 1,
          reason: optionalString(body, 'reason', { max: 200 }) ?? null,
          status: 'approuve',
          createdAt: now,
          decidedBy: claims.sub,
          decidedAt: now,
        };
        store.leaves.set(leave.id, leave);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.absence.recorded',
          targetType: 'leave',
          targetId: leave.id,
          meta: { employeeId, date },
        });
        return { status: 201, body: { absence: serializeLeave(store, leave) } };
      },
    },

    /* ----------------------------- Pointage ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/attendance',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const date = ctx.query.get('date') ?? todayString();
        const items = [...store.attendance.values()]
          .filter((record) => record.tenantId === tenantId && record.date === date)
          .sort((a, b) => a.clockIn.localeCompare(b.clockIn))
          .map((record) => ({ ...record, employeeName: employeeName(store, record.employeeId) }));
        return { body: { tenantId, date, items } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/attendance/clock',
      auth: false,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const body = asObject(ctx.body);
        const pin = optionalString(body, 'pin', { max: 4 });
        const qrToken = optionalString(body, 'qrToken', { max: 40 });
        if (!pin && !qrToken) {
          throw HttpError.unprocessable('validation_error', 'PIN ou badge QR requis.', { field: 'pin' });
        }
        const employee = [...store.employees.values()].find(
          (candidate) =>
            candidate.tenantId === tenantId &&
            candidate.status === 'actif' &&
            ((pin && candidate.pin === pin) || (qrToken && candidate.qrToken === qrToken)),
        );
        if (!employee) {
          throw HttpError.unprocessable('badge_invalid', 'PIN ou badge invalide.', { field: 'pin' });
        }
        const date = todayString();
        if (findOpenAttendance(store, tenantId, employee.id, date)) {
          throw HttpError.conflict('already_clocked_in', 'Un pointage est déjà ouvert pour aujourd’hui.');
        }
        let location: AttendanceRecord['location'] = null;
        const geofence = store.geofences.get(tenantId);
        if (geofence) {
          if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
            throw HttpError.unprocessable('geolocation_required', 'La géolocalisation est requise pour ce pointage.', { field: 'lat' });
          }
          const distance = distanceMeters(geofence, { lat: body.lat, lng: body.lng });
          if (distance > geofence.radiusM) {
            throw HttpError.unprocessable('outside_geofence', 'Pointage hors du périmètre autorisé.', {
              distanceM: Math.round(distance),
              radiusM: geofence.radiusM,
            });
          }
          location = { lat: body.lat, lng: body.lng, withinFence: true };
        } else if (typeof body.lat === 'number' && typeof body.lng === 'number') {
          location = { lat: body.lat, lng: body.lng, withinFence: true };
        }
        const now = isoNow();
        const record: AttendanceRecord = {
          id: newId('att'),
          tenantId,
          employeeId: employee.id,
          date,
          clockIn: now,
          clockOut: null,
          method: pin ? 'pin' : 'qr',
          minutesWorked: 0,
          location,
        };
        store.attendance.set(record.id, record);
        store.recordAudit({
          tenantId,
          actorId: employee.id,
          action: 'staff.attendance.clocked_in',
          targetType: 'attendance',
          targetId: record.id,
          meta: { method: record.method, employeeId: employee.id },
        });
        await publish('AttendanceClocked', tenantId, {
          tenantId,
          employeeId: employee.id,
          attendanceId: record.id,
          direction: 'in',
          at: now,
        });
        return {
          status: 201,
          body: { attendance: { ...record, employeeName: employee.name } },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/staff/attendance/:id/clock-out',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const record = store.attendance.get(ctx.params.id ?? '');
        if (!record || record.tenantId !== tenantId) throw HttpError.notFound('Pointage introuvable.');
        if (record.clockOut) throw HttpError.conflict('already_clocked_out', 'Ce pointage est déjà clôturé.');
        record.clockOut = isoNow();
        record.minutesWorked = minutesBetween(record.clockIn, record.clockOut);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.attendance.clocked_out',
          targetType: 'attendance',
          targetId: record.id,
          meta: { employeeId: record.employeeId, minutesWorked: record.minutesWorked },
        });
        await publish('AttendanceClocked', tenantId, {
          tenantId,
          employeeId: record.employeeId,
          attendanceId: record.id,
          direction: 'out',
          at: record.clockOut,
        });
        return {
          body: { attendance: { ...record, employeeName: employeeName(store, record.employeeId) } },
        };
      },
    },

    /* ----------------------------- Performances ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/performance',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const items = [...store.employees.values()]
          .filter((employee) => employee.tenantId === tenantId)
          .map((employee) => {
            const record = getPerformance(store, tenantId, employee.id);
            return {
              employeeId: employee.id,
              employeeName: employee.name,
              jobTitle: employee.jobTitle,
              roleCode: employee.roleCode,
              salesXof: record.salesXof,
              orders: record.orders,
              tablesServed: record.tablesServed,
              tipsXof: record.tipsXof,
              averageTicketXof: record.orders > 0 ? Math.round(record.salesXof / record.orders) : 0,
              updatedAt: record.updatedAt,
            };
          })
          .sort((a, b) => b.salesXof - a.salesXof);
        return {
          body: {
            tenantId,
            items,
            totals: {
              salesXof: items.reduce((sum, item) => sum + item.salesXof, 0),
              orders: items.reduce((sum, item) => sum + item.orders, 0),
              tablesServed: items.reduce((sum, item) => sum + item.tablesServed, 0),
              tipsXof: items.reduce((sum, item) => sum + item.tipsXof, 0),
            },
          },
        };
      },
    },

    /* ----------------------------- Paramètres et audit ----------------------------- */
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/settings',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        return { body: { tenantId, geofence: store.geofences.get(tenantId) ?? null } };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/tenants/:tenantId/staff/settings',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = requireTenantPermission(ctx.auth, tenantId, 'staff:manage');
        const body = asObject(ctx.body);
        if (body.geofence === null) {
          store.geofences.delete(tenantId);
        } else {
          const geofence = asObject(body.geofence);
          if (typeof geofence.lat !== 'number' || typeof geofence.lng !== 'number' || typeof geofence.radiusM !== 'number') {
            throw HttpError.unprocessable('validation_error', 'Géofence invalide (lat, lng, radiusM).', { field: 'geofence' });
          }
          if (geofence.radiusM < 20 || geofence.radiusM > 5000) {
            throw HttpError.unprocessable('validation_error', 'Rayon de géofence attendu entre 20 et 5000 m.', { field: 'geofence.radiusM' });
          }
          store.geofences.set(tenantId, { lat: geofence.lat, lng: geofence.lng, radiusM: geofence.radiusM });
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'staff.settings.updated',
          targetType: 'settings',
          targetId: tenantId,
          meta: { geofence: store.geofences.get(tenantId) ?? null },
        });
        return { body: { tenantId, geofence: store.geofences.get(tenantId) ?? null } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/staff/audit',
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        requireTenantPermission(ctx.auth, tenantId, 'staff:view');
        const entries = store.audit.filter((entry) => entry.tenantId === tenantId).slice(-100).reverse();
        return {
          body: {
            tenantId,
            entries,
            integrity: verifyAuditChain(store.audit),
            generatedAt: isoNow(),
          },
        };
      },
    },

    /* ----------------------------- Interne (paie) ----------------------------- */
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/staff/payroll-input',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const period = ctx.query.get('period') ?? todayString().slice(0, 7);
        const { start, end } = periodRange(period);
        const employees = [...store.employees.values()]
          .filter((employee) => employee.tenantId === tenantId && (employee.status === 'actif' || employee.status === 'suspendu'))
          .map((employee) => {
            const records = [...store.attendance.values()].filter(
              (record) =>
                record.tenantId === tenantId &&
                record.employeeId === employee.id &&
                record.date >= start &&
                record.date <= end &&
                record.clockOut !== null,
            );
            const totalMinutes = records.reduce((sum, record) => sum + record.minutesWorked, 0);
            const overtimeMinutes = records.reduce((sum, record) => sum + Math.max(0, record.minutesWorked - 480), 0);
            const leaves = [...store.leaves.values()].filter(
              (leave) =>
                leave.tenantId === tenantId &&
                leave.employeeId === employee.id &&
                leave.status === 'approuve' &&
                leave.to >= start &&
                leave.from <= end,
            );
            const unpaidLeaveDays = leaves
              .filter((leave) => leave.type === 'sans_solde' || leave.type === 'absence')
              .reduce((sum, leave) => sum + leave.days, 0);
            const performance = getPerformance(store, tenantId, employee.id);
            return {
              employeeId: employee.id,
              name: employee.name,
              jobTitle: employee.jobTitle,
              roleCode: employee.roleCode,
              contractType: employee.contractType,
              hireDate: employee.hireDate,
              baseSalaryXof: employee.baseSalaryXof,
              paymentMethod: employee.paymentMethod,
              paymentDestination: employee.paymentDestination,
              daysPresent: records.length,
              minutesWorked: totalMinutes,
              hoursWorked: Math.round((totalMinutes / 60) * 100) / 100,
              overtimeMinutes,
              overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
              unpaidLeaveDays,
              paidLeaveDays: leaves
                .filter((leave) => leave.type === 'conges_payes' || leave.type === 'maladie')
                .reduce((sum, leave) => sum + leave.days, 0),
              tipsXof: performance.tipsXof,
              salesXof: performance.salesXof,
            };
          });
        return {
          body: {
            tenantId,
            period,
            from: start,
            to: end,
            employees,
            generatedAt: isoNow(),
          },
        };
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Événements consommés                                                */
/* ------------------------------------------------------------------ */

export function handleStaffEvent(
  store: StaffStore,
  tenantId: string,
  event: { type: string; payload: Record<string, unknown> },
): void {
  if (event.type === 'OrderPaid') {
    const orderId = typeof event.payload.orderId === 'string' ? event.payload.orderId : '';
    if (!orderId || store.handledOrders.has(`${tenantId}::${orderId}`)) return;
    const candidateId =
      (typeof event.payload.waiterId === 'string' && event.payload.waiterId) ||
      (typeof event.payload.servedByEmployeeId === 'string' && event.payload.servedByEmployeeId) ||
      (typeof event.payload.actorId === 'string' && event.payload.actorId) ||
      '';
    if (!candidateId) return;
    const employee = [...store.employees.values()].find(
      (candidate) => candidate.tenantId === tenantId && (candidate.id === candidateId || candidate.userId === candidateId),
    );
    if (!employee) return;
    const amount =
      typeof event.payload.totalXof === 'number'
        ? event.payload.totalXof
        : typeof event.payload.amountXof === 'number'
          ? event.payload.amountXof
          : 0;
    if (amount <= 0) return;
    const record = getPerformance(store, tenantId, employee.id);
    record.salesXof += amount;
    record.orders += 1;
    if (typeof event.payload.tableCode === 'string' && event.payload.tableCode) record.tablesServed += 1;
    record.updatedAt = isoNow();
    store.handledOrders.add(`${tenantId}::${orderId}`);
    return;
  }
  if (event.type === 'TipDistributed') {
    const allocations = Array.isArray(event.payload.allocations) ? event.payload.allocations : [];
    for (const item of allocations) {
      const allocation = typeof item === 'object' && item ? (item as Record<string, unknown>) : null;
      if (!allocation) continue;
      const staffId = typeof allocation.staffId === 'string' ? allocation.staffId : '';
      const amount = typeof allocation.amountXof === 'number' ? allocation.amountXof : 0;
      if (!staffId || amount <= 0) continue;
      const key = `${tenantId}::${staffId}::${typeof event.payload.transactionId === 'string' ? event.payload.transactionId : ''}::${amount}`;
      if (store.handledTips.has(key)) continue;
      const employee = [...store.employees.values()].find(
        (candidate) => candidate.tenantId === tenantId && (candidate.id === staffId || candidate.userId === staffId),
      );
      if (!employee) continue;
      const record = getPerformance(store, tenantId, employee.id);
      record.tipsXof += amount;
      record.updatedAt = isoNow();
      store.handledTips.add(key);
    }
  }
}
