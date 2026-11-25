import { buildAuditEntry, newId, nowIso, randomDigits, randomToken, type AuditEntry } from '@resto-hub/service-kit';

export const STAFF_STATUSES = ['invite', 'actif', 'suspendu', 'sorti'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const CONTRACT_TYPES = ['cdi', 'cdd', 'stage', 'extra'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const SHIFT_STATIONS = ['salle', 'cuisine', 'bar', 'caisse', 'livraison'] as const;
export type ShiftStation = (typeof SHIFT_STATIONS)[number];

export const SHIFT_STATUSES = ['planifie', 'publie', 'termine', 'annule'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const LEAVE_TYPES = ['conges_payes', 'maladie', 'sans_solde', 'absence'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['en_attente', 'approuve', 'refuse'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const SWAP_STATUSES = ['en_attente', 'approuve', 'refuse'] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export const PAYMENT_METHODS = ['mobile_money', 'bank', 'cash'] as const;
export type StaffPaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface StaffDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: string;
}

export interface Employee {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email: string | null;
  jobTitle: string;
  roleCode: string;
  contractType: ContractType;
  hireDate: string;
  baseSalaryXof: number;
  paymentMethod: StaffPaymentMethod;
  paymentDestination: string;
  documents: StaffDocument[];
  status: StaffStatus;
  pin: string;
  qrToken: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface Invitation {
  token: string;
  tenantId: string;
  employeeId: string;
  channel: 'sms' | 'email';
  sentAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface Shift {
  id: string;
  tenantId: string;
  employeeId: string;
  date: string;
  start: string;
  end: string;
  station: ShiftStation;
  status: ShiftStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SwapRequest {
  id: string;
  tenantId: string;
  shiftId: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  status: SwapStatus;
  requestedBy: string;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface LeaveRequest {
  id: string;
  tenantId: string;
  employeeId: string;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  method: 'pin' | 'qr' | 'manuel';
  minutesWorked: number;
  location: { lat: number; lng: number; withinFence: boolean } | null;
}

export interface PerformanceRecord {
  tenantId: string;
  employeeId: string;
  salesXof: number;
  orders: number;
  tablesServed: number;
  tipsXof: number;
  updatedAt: string;
}

export interface Geofence {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface StaffStore {
  employees: Map<string, Employee>;
  invitations: Map<string, Invitation>;
  shifts: Map<string, Shift>;
  swaps: Map<string, SwapRequest>;
  leaves: Map<string, LeaveRequest>;
  attendance: Map<string, AttendanceRecord>;
  performance: Map<string, PerformanceRecord>;
  geofences: Map<string, Geofence>;
  handledOrders: Set<string>;
  handledTips: Set<string>;
  audit: AuditEntry[];
  recordAudit(input: Omit<Parameters<typeof buildAuditEntry>[0], 'previousHash'>): AuditEntry;
}

export function createStaffStore(): StaffStore {
  const store: StaffStore = {
    employees: new Map(),
    invitations: new Map(),
    shifts: new Map(),
    swaps: new Map(),
    leaves: new Map(),
    attendance: new Map(),
    performance: new Map(),
    geofences: new Map(),
    handledOrders: new Set(),
    handledTips: new Set(),
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

export function performanceKey(tenantId: string, employeeId: string): string {
  return `${tenantId}::${employeeId}`;
}

export function getPerformance(store: StaffStore, tenantId: string, employeeId: string): PerformanceRecord {
  const key = performanceKey(tenantId, employeeId);
  const existing = store.performance.get(key);
  if (existing) return existing;
  const record: PerformanceRecord = {
    tenantId,
    employeeId,
    salesXof: 0,
    orders: 0,
    tablesServed: 0,
    tipsXof: 0,
    updatedAt: nowIso(),
  };
  store.performance.set(key, record);
  return record;
}

export function serializeEmployee(employee: Employee) {
  return {
    id: employee.id,
    tenantId: employee.tenantId,
    name: employee.name,
    phone: employee.phone,
    email: employee.email,
    jobTitle: employee.jobTitle,
    roleCode: employee.roleCode,
    contractType: employee.contractType,
    hireDate: employee.hireDate,
    baseSalaryXof: employee.baseSalaryXof,
    paymentMethod: employee.paymentMethod,
    paymentDestination: employee.paymentDestination,
    documents: employee.documents,
    status: employee.status,
    pinMasked: `••••`,
    qrToken: employee.qrToken,
    userId: employee.userId,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
    activatedAt: employee.activatedAt,
  };
}

export function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function dateOnly(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function seedStaffDemo(store: StaffStore): void {
  if (store.employees.size > 0) return;
  const now = nowIso();

  const make = (
    id: string,
    tenantId: string,
    name: string,
    jobTitle: string,
    roleCode: string,
    phone: string,
    email: string | null,
    baseSalaryXof: number,
    pin: string,
    destination: string,
    paymentMethod: StaffPaymentMethod,
    hireDate: string,
    contractType: ContractType = 'cdi',
    status: StaffStatus = 'actif',
  ): Employee => ({
    id,
    tenantId,
    name,
    phone,
    email,
    jobTitle,
    roleCode,
    contractType,
    hireDate,
    baseSalaryXof,
    paymentMethod,
    paymentDestination: destination,
    documents: [
      { id: newId('doc'), name: 'Contrat signé.pdf', type: 'contrat', uploadedAt: now },
      { id: newId('doc'), name: 'Pièce d’identité.pdf', type: 'identite', uploadedAt: now },
    ],
    status,
    pin,
    qrToken: randomToken(12),
    userId: null,
    createdAt: now,
    updatedAt: now,
    activatedAt: status === 'actif' ? now : null,
  });

  const employees: Employee[] = [
    make('emp_akouvi', 'tnt_sahelgrill', 'Akouvi Mensah', 'Serveur', 'waiter', '+228 90 11 22 33', 'akouvi@sahelgrill.tg', 140000, '1234', 'TMoney 90 12 34 56', 'mobile_money', '2023-02-14'),
    make('emp_kossi', 'tnt_sahelgrill', 'Kossi Adjo', 'Cuisinier', 'cook', '+228 90 22 33 44', 'kossi@sahelgrill.tg', 160000, '2345', 'Moov Money 96 55 44 33', 'mobile_money', '2022-08-01'),
    make('emp_sena', 'tnt_sahelgrill', 'Sena Amah', 'Barman', 'bartender', '+228 90 33 44 55', 'sena@sahelgrill.tg', 150000, '3456', 'Compte BOA TG 000123', 'bank', '2024-01-09'),
    make('emp_yawa', 'tnt_sahelgrill', 'Yawa Doe', 'Caissière', 'cashier', '+228 90 44 55 66', 'yawa@sahelgrill.tg', 155000, '4567', 'TMoney 90 77 88 99', 'mobile_money', '2023-11-02'),
    make('emp_komlan', 'tnt_sahelgrill', 'Komlan Tetteh', 'Manager de salle', 'floor_manager', '+228 90 55 66 77', 'komlan@sahelgrill.tg', 280000, '5678', 'Compte Ecobank TG 445566', 'bank', '2021-05-17'),
    make('emp_ama', 'tnt_baobab', 'Ama Kponou', 'Serveuse', 'waiter', '+228 91 10 20 30', 'ama@baobab.tg', 130000, '6789', 'Moov Money 97 12 34 56', 'mobile_money', '2024-03-04'),
    make('emp_yao', 'tnt_baobab', 'Yao Sossou', 'Cuisinier', 'cook', '+228 91 20 30 40', 'yao@baobab.tg', 150000, '7890', 'TMoney 90 55 66 77', 'mobile_money', '2023-06-12', 'cdd'),
  ];
  for (const employee of employees) store.employees.set(employee.id, employee);

  const shiftPlan: Array<[string, string, string, ShiftStation, ShiftStatus]> = [
    ['emp_akouvi', dateOnly(0), '11:00', 'salle', 'publie'],
    ['emp_akouvi', dateOnly(1), '18:00', 'salle', 'publie'],
    ['emp_kossi', dateOnly(0), '10:00', 'cuisine', 'publie'],
    ['emp_sena', dateOnly(0), '17:00', 'bar', 'publie'],
    ['emp_yawa', dateOnly(0), '18:00', 'caisse', 'planifie'],
    ['emp_komlan', dateOnly(1), '12:00', 'salle', 'planifie'],
  ];
  for (const [employeeId, date, start, station, status] of shiftPlan) {
    const shift: Shift = {
      id: newId('shf'),
      tenantId: 'tnt_sahelgrill',
      employeeId,
      date,
      start,
      end: `${String(Math.min(23, Number(start.slice(0, 2)) + 8)).padStart(2, '0')}:00`,
      station,
      status,
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    store.shifts.set(shift.id, shift);
  }

  const pendingSwap: SwapRequest = {
    id: newId('swp'),
    tenantId: 'tnt_sahelgrill',
    shiftId: [...store.shifts.values()][1].id,
    fromEmployeeId: 'emp_akouvi',
    toEmployeeId: 'emp_sena',
    status: 'en_attente',
    requestedBy: 'emp_akouvi',
    decidedBy: null,
    createdAt: now,
    decidedAt: null,
  };
  store.swaps.set(pendingSwap.id, pendingSwap);

  const leaves: LeaveRequest[] = [
    {
      id: newId('lea'),
      tenantId: 'tnt_sahelgrill',
      employeeId: 'emp_akouvi',
      type: 'conges_payes',
      from: dateOnly(7),
      to: dateOnly(9),
      days: 3,
      reason: 'Mariage familial',
      status: 'en_attente',
      createdAt: now,
      decidedBy: null,
      decidedAt: null,
    },
    {
      id: newId('lea'),
      tenantId: 'tnt_sahelgrill',
      employeeId: 'emp_kossi',
      type: 'maladie',
      from: dateOnly(-10),
      to: dateOnly(-9),
      days: 2,
      reason: 'Certificat médical',
      status: 'approuve',
      createdAt: daysAgoIso(12),
      decidedBy: 'usr_demo_seed',
      decidedAt: daysAgoIso(11),
    },
  ];
  for (const leave of leaves) store.leaves.set(leave.id, leave);

  // Pointages du mois courant pour 4 employés (10 jours ouvrés).
  for (let day = 1; day <= 10; day += 1) {
    for (const employeeId of ['emp_akouvi', 'emp_kossi', 'emp_sena', 'emp_yawa']) {
      const date = dateOnly(-day);
      const clockIn = new Date(`${date}T09:05:00.000Z`).toISOString();
      const overtime = employeeId === 'emp_akouvi' && day % 3 === 0 ? 45 : 0;
      const clockOut = new Date(new Date(clockIn).getTime() + (8 * 60 + 5 + overtime) * 60000).toISOString();
      const record: AttendanceRecord = {
        id: newId('att'),
        tenantId: 'tnt_sahelgrill',
        employeeId,
        date,
        clockIn,
        clockOut,
        method: 'pin',
        minutesWorked: minutesBetween(clockIn, clockOut),
        location: null,
      };
      store.attendance.set(record.id, record);
    }
  }

  const seedPerf: Array<[string, number, number, number, number]> = [
    ['emp_akouvi', 412000, 24, 61, 9500],
    ['emp_sena', 298000, 18, 42, 6200],
    ['emp_yawa', 186000, 12, 24, 3100],
    ['emp_komlan', 120000, 6, 15, 2400],
    ['emp_kossi', 0, 0, 0, 900],
  ];
  for (const [employeeId, salesXof, orders, tablesServed, tipsXof] of seedPerf) {
    const record = getPerformance(store, 'tnt_sahelgrill', employeeId);
    record.salesXof = salesXof;
    record.orders = orders;
    record.tablesServed = tablesServed;
    record.tipsXof = tipsXof;
  }

  store.recordAudit({
    tenantId: null,
    actorId: 'usr_demo_seed',
    action: 'staff.seeded',
    targetType: 'staff',
    targetId: 'demo',
    meta: { employees: store.employees.size, shifts: store.shifts.size },
  });
}

export function newPin(): string {
  return randomDigits(4);
}
