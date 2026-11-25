import { buildAuditEntry, newId, nowIso, randomToken, type AuditEntry } from '@resto-hub/service-kit';

export const ZONE_KINDS = ['salle', 'terrasse', 'vip', 'bar', 'etage'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const TABLE_TYPES = ['table', 'comptoir', 'canape', 'loge'] as const;
export type TableType = (typeof TABLE_TYPES)[number];

export const TABLE_STATUSES = ['libre', 'reservee', 'occupee', 'addition', 'nettoyage', 'hors_service'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const STATUS_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  libre: ['reservee', 'occupee', 'hors_service'],
  reservee: ['libre', 'occupee', 'hors_service'],
  occupee: ['addition', 'libre', 'hors_service'],
  addition: ['nettoyage', 'occupee', 'hors_service'],
  nettoyage: ['libre', 'hors_service'],
  hors_service: ['libre'],
};

export const RESERVATION_STATUSES = ['confirmee', 'installee', 'annulee', 'no_show'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  confirmee: ['installee', 'annulee', 'no_show'],
  installee: [],
  annulee: [],
  no_show: [],
};

export const RESERVATION_WINDOW_MINUTES = 90;

export interface FloorReservation {
  id: string;
  tenantId: string;
  reference: string;
  date: string;
  time: string;
  partySize: number;
  zoneId?: string;
  tableId?: string;
  customerName: string;
  customerPhone: string;
  note?: string;
  status: ReservationStatus;
  source: 'client' | 'staff';
  publicToken: string;
  createdAt: string;
  updatedAt: string;
  seatedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelBy?: string;
}

export const DEFAULT_ZONE_CODES: Record<ZoneKind, string> = {
  salle: 'SAL',
  terrasse: 'TER',
  vip: 'VIP',
  bar: 'BAR',
  etage: 'ETG',
};

export interface FloorSettings {
  tenantId: string;
  establishmentCode: string;
  updatedAt: string;
}

export interface FloorZone {
  id: string;
  tenantId: string;
  name: string;
  kind: ZoneKind;
  code: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloorTable {
  id: string;
  tenantId: string;
  zoneId: string;
  number: number;
  code: string;
  capacity: number;
  type: TableType;
  status: TableStatus;
  x: number;
  y: number;
  orderId?: string;
  reservationId?: string;
  mergedIntoId?: string;
  mergedIds: string[];
  qrToken: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FloorStore {
  settings: Map<string, FloorSettings>;
  zones: Map<string, FloorZone>;
  tables: Map<string, FloorTable>;
  reservations: Map<string, FloorReservation>;
  reservationCounter: number;
  audit: AuditEntry[];
  recordAudit(input: {
    tenantId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  }): AuditEntry;
}

export function createFloorStore(): FloorStore {
  const store: FloorStore = {
    settings: new Map(),
    zones: new Map(),
    tables: new Map(),
    reservations: new Map(),
    reservationCounter: 0,
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

export function tableCode(establishmentCode: string, zoneCode: string, number: number): string {
  return `${establishmentCode}-${zoneCode}-${String(number).padStart(3, '0')}`;
}

export function seedFloorDemo(store: FloorStore): void {
  if (store.zones.size > 0) return;
  const tenantId = 'tnt_sahelgrill';
  const now = nowIso();
  store.settings.set(tenantId, { tenantId, establishmentCode: 'LOME01', updatedAt: now });

  const zone = (id: string, name: string, kind: ZoneKind, code: string, position: number): FloorZone => ({
    id,
    tenantId,
    name,
    kind,
    code,
    position,
    createdAt: now,
    updatedAt: now,
  });
  const zones = [
    zone('zon_sg_salle', 'Salle principale', 'salle', 'SAL', 1),
    zone('zon_sg_terrasse', 'Terrasse', 'terrasse', 'TER', 2),
    zone('zon_sg_bar', 'Bar', 'bar', 'BAR', 3),
    zone('zon_sg_vip', 'Loge VIP', 'vip', 'VIP', 4),
  ];
  for (const entry of zones) store.zones.set(entry.id, entry);

  const table = (
    id: string,
    zoneId: string,
    number: number,
    capacity: number,
    type: TableType,
    status: TableStatus,
    x: number,
    y: number,
    extra: Partial<FloorTable> = {},
  ): FloorTable => {
    const zoneEntry = zones.find((entry) => entry.id === zoneId)!;
    return {
      id,
      tenantId,
      zoneId,
      number,
      code: tableCode('LOME01', zoneEntry.code, number),
      capacity,
      type,
      status,
      x,
      y,
      mergedIds: [],
      qrToken: randomToken(6),
      createdAt: now,
      updatedAt: now,
      updatedBy: 'usr_demo_seed',
      ...extra,
    };
  };

  const tables = [
    table('tbl_sg_s1', 'zon_sg_salle', 1, 4, 'table', 'occupee', 12, 14, { orderId: 'ord_demo_1001' }),
    table('tbl_sg_s2', 'zon_sg_salle', 2, 2, 'table', 'libre', 38, 14),
    table('tbl_sg_s3', 'zon_sg_salle', 3, 6, 'table', 'reservee', 64, 14, { reservationId: 'res_demo_2001' }),
    table('tbl_sg_s4', 'zon_sg_salle', 4, 4, 'table', 'addition', 12, 52, { orderId: 'ord_demo_1002' }),
    table('tbl_sg_s5', 'zon_sg_salle', 5, 4, 'table', 'nettoyage', 38, 52),
    table('tbl_sg_s6', 'zon_sg_salle', 6, 8, 'table', 'hors_service', 64, 52),
    table('tbl_sg_t1', 'zon_sg_terrasse', 1, 4, 'table', 'libre', 18, 22),
    table('tbl_sg_t2', 'zon_sg_terrasse', 2, 4, 'table', 'occupee', 48, 22, { orderId: 'ord_demo_1003' }),
    table('tbl_sg_t3', 'zon_sg_terrasse', 3, 2, 'canape', 'libre', 78, 22),
    table('tbl_sg_b1', 'zon_sg_bar', 1, 2, 'comptoir', 'occupee', 25, 30, { orderId: 'ord_demo_1004' }),
    table('tbl_sg_b2', 'zon_sg_bar', 2, 2, 'comptoir', 'libre', 60, 30),
    table('tbl_sg_v1', 'zon_sg_vip', 1, 8, 'loge', 'reservee', 30, 30, { reservationId: 'res_demo_2002' }),
  ];
  // Jetons QR stables en démonstration : permettent de tester le parcours
  // scan → menu → commande sans imprimer un QR. Les tables créées ensuite
  // reçoivent un jeton aléatoire (voir POST /floor/tables).
  for (const entry of tables) {
    entry.qrToken = `demo-${entry.code.toLowerCase()}`;
    store.tables.set(entry.id, entry);
  }

  const today = new Date().toISOString().slice(0, 10);
  const reservation = (
    id: string,
    reference: string,
    tableId: string,
    partySize: number,
    time: string,
    customerName: string,
    customerPhone: string,
    status: ReservationStatus,
  ): FloorReservation => ({
    id,
    tenantId,
    reference,
    date: today,
    time,
    partySize,
    zoneId: store.tables.get(tableId)?.zoneId,
    tableId,
    customerName,
    customerPhone,
    status,
    source: 'staff',
    publicToken: randomToken(8),
    createdAt: now,
    updatedAt: now,
  });
  const reservations = [
    reservation('res_demo_2001', 'RES-2026-0001', 'tbl_sg_s3', 6, '20:00', 'Famille Agbeko', '+22890223344', 'confirmee'),
    reservation('res_demo_2002', 'RES-2026-0002', 'tbl_sg_v1', 8, '21:00', 'Groupe Adjo', '+22891556677', 'confirmee'),
  ];
  for (const entry of reservations) store.reservations.set(entry.id, entry);
  store.reservationCounter = reservations.length;

  const extraFloors: Array<{
    tenantId: string;
    code: string;
    prefix: string;
    zones: Array<{ key: string; name: string; kind: ZoneKind; code: string }>;
    tables: Array<{ zone: string; number: number; capacity: number; type: TableType; status: TableStatus }>;
  }> = [
    {
      tenantId: 'tnt_baobab',
      code: 'BAOB01',
      prefix: 'bb',
      zones: [
        { key: 'salle', name: 'Salle', kind: 'salle', code: 'SAL' },
        { key: 'terrasse', name: 'Terrasse', kind: 'terrasse', code: 'TER' },
        { key: 'bar', name: 'Comptoir', kind: 'bar', code: 'BAR' },
      ],
      tables: [
        { zone: 'salle', number: 1, capacity: 4, type: 'table', status: 'libre' },
        { zone: 'salle', number: 2, capacity: 2, type: 'table', status: 'occupee' },
        { zone: 'terrasse', number: 1, capacity: 4, type: 'table', status: 'libre' },
        { zone: 'bar', number: 1, capacity: 2, type: 'comptoir', status: 'reservee' },
      ],
    },
    {
      tenantId: 'tnt_lagune',
      code: 'LAGN01',
      prefix: 'lg',
      zones: [
        { key: 'salle', name: 'Salle', kind: 'salle', code: 'SAL' },
        { key: 'terrasse', name: 'Bord de lagune', kind: 'terrasse', code: 'TER' },
      ],
      tables: [
        { zone: 'salle', number: 1, capacity: 4, type: 'table', status: 'libre' },
        { zone: 'salle', number: 2, capacity: 6, type: 'table', status: 'libre' },
        { zone: 'terrasse', number: 1, capacity: 4, type: 'table', status: 'libre' },
        { zone: 'terrasse', number: 2, capacity: 2, type: 'canape', status: 'libre' },
      ],
    },
  ];

  for (const floor of extraFloors) {
    store.settings.set(floor.tenantId, { tenantId: floor.tenantId, establishmentCode: floor.code, updatedAt: now });
    const zoneByKey = new Map<string, FloorZone>();
    floor.zones.forEach((entry, index) => {
      const zone: FloorZone = {
        id: `zon_${floor.prefix}_${entry.key}`,
        tenantId: floor.tenantId,
        name: entry.name,
        kind: entry.kind,
        code: entry.code,
        position: index + 1,
        createdAt: now,
        updatedAt: now,
      };
      zoneByKey.set(entry.key, zone);
      store.zones.set(zone.id, zone);
    });
    for (const entry of floor.tables) {
      const zone = zoneByKey.get(entry.zone);
      if (!zone) continue;
      const table: FloorTable = {
        id: `tbl_${floor.prefix}_${entry.zone}_${entry.number}`,
        tenantId: floor.tenantId,
        zoneId: zone.id,
        number: entry.number,
        code: tableCode(floor.code, zone.code, entry.number),
        capacity: entry.capacity,
        type: entry.type,
        status: entry.status,
        x: 18 + ((entry.number - 1) % 3) * 26,
        y: 22 + Math.floor((entry.number - 1) / 3) * 30,
        mergedIds: [],
        qrToken: `demo-${tableCode(floor.code, zone.code, entry.number).toLowerCase()}`,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'usr_demo_seed',
      };
      store.tables.set(table.id, table);
    }
  }

  store.recordAudit({
    tenantId,
    actorId: 'usr_demo_seed',
    action: 'floor.seeded',
    targetType: 'floor',
    targetId: tenantId,
    meta: { zones: zones.length, tables: tables.length },
  });
}

export function newFloorId(prefix: string): string {
  return newId(prefix);
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  return hours * 60 + minutes;
}

export function reservationsOverlap(a: string, b: string): boolean {
  return Math.abs(timeToMinutes(a) - timeToMinutes(b)) < RESERVATION_WINDOW_MINUTES;
}

export function reservationsOf(store: FloorStore, tenantId: string): FloorReservation[] {
  return [...store.reservations.values()].filter((entry) => entry.tenantId === tenantId);
}

export function reservationsForDate(store: FloorStore, tenantId: string, date: string): FloorReservation[] {
  return reservationsOf(store, tenantId)
    .filter((entry) => entry.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function nextReservationReference(store: FloorStore): string {
  store.reservationCounter += 1;
  return `RES-${new Date().getUTCFullYear()}-${String(store.reservationCounter).padStart(4, '0')}`;
}
