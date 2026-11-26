import {
  HttpError,
  asObject,
  hasTenantPermission,
  optionalString,
  randomToken,
  requirePhone,
  requireString,
  requireTenantPermission,
  verifyAuditChain,
  type AuthClaims,
  type RequestContext,
  type Route,
} from '@resto-hub/service-kit';
import {
  DEFAULT_ZONE_CODES,
  RESERVATION_TRANSITIONS,
  STATUS_TRANSITIONS,
  TABLE_STATUSES,
  TABLE_TYPES,
  ZONE_KINDS,
  newFloorId,
  nextReservationReference,
  reservationsForDate,
  reservationsOverlap,
  tableCode,
  timeToMinutes,
  type FloorReservation,
  type FloorStore,
  type FloorTable,
  type FloorZone,
  type ReservationStatus,
  type TableStatus,
  type TableType,
  type ZoneKind,
} from './store.js';
import { buildQrSheetPdf, qrPng, qrSvg } from './qr.js';

export interface FloorAppOptions {
  store: FloorStore;
  appPublicUrl: string;
  publish: (
    type: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}

const ESTABLISHMENT_CODE = /^[A-Z0-9]{3,12}$/;
const ZONE_CODE = /^[A-Z0-9]{2,4}$/;
const ORDER_ID = /^[A-Za-z0-9_-]{3,64}$/;

function nowIso(): string {
  return new Date().toISOString();
}

function requireInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const value = source[field];
  const min = opts.min ?? 0;
  const max = opts.max ?? 1_000_000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être un entier entre ${min} et ${max}.`,
      {
        field,
      },
    );
  }
  return value;
}

function optionalInt(
  source: Record<string, unknown>,
  field: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  return requireInt(source, field, opts);
}

function optionalNumber(source: Record<string, unknown>, field: string): number | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être un pourcentage 0–100.`,
      { field },
    );
  }
  return Math.round(value * 100) / 100;
}

function tenantOf(
  ctx: RequestContext,
  permission: string,
): { tenantId: string; claims: AuthClaims } {
  const tenantId = ctx.params.tenantId ?? '';
  const claims = requireTenantPermission(ctx.auth, tenantId, permission);
  return { tenantId, claims };
}

function canAny(claims: AuthClaims, tenantId: string, permissions: string[]): boolean {
  return permissions.some((permission) => hasTenantPermission(claims, tenantId, permission));
}

function requireZone(store: FloorStore, tenantId: string, id: string): FloorZone {
  const zone = store.zones.get(id);
  if (!zone || zone.tenantId !== tenantId) throw HttpError.notFound('Zone introuvable.');
  return zone;
}

function requireTable(store: FloorStore, tenantId: string, id: string): FloorTable {
  const table = store.tables.get(id);
  if (!table || table.tenantId !== tenantId) throw HttpError.notFound('Table introuvable.');
  return table;
}

function settingsOf(store: FloorStore, tenantId: string) {
  return store.settings.get(tenantId);
}

function tablesOf(store: FloorStore, tenantId: string): FloorTable[] {
  return [...store.tables.values()].filter((table) => table.tenantId === tenantId);
}

function zonesOf(store: FloorStore, tenantId: string): FloorZone[] {
  return [...store.zones.values()]
    .filter((zone) => zone.tenantId === tenantId)
    .sort((a, b) => a.position - b.position);
}

function effectiveCapacity(store: FloorStore, table: FloorTable): number {
  const members = table.mergedIds
    .map((id) => store.tables.get(id))
    .filter((member): member is FloorTable => Boolean(member));
  return table.capacity + members.reduce((sum, member) => sum + member.capacity, 0);
}

function occupancy(store: FloorStore, tenantId: string) {
  const tables = tablesOf(store, tenantId);
  const primaries = tables.filter((table) => !table.mergedIntoId);
  const byStatus: Record<TableStatus, number> = {
    libre: 0,
    reservee: 0,
    occupee: 0,
    addition: 0,
    nettoyage: 0,
    hors_service: 0,
  };
  let seatsTotal = 0;
  let seatsOccupied = 0;
  for (const table of primaries) {
    byStatus[table.status] += 1;
    const seats = effectiveCapacity(store, table);
    seatsTotal += seats;
    if (table.status === 'occupee' || table.status === 'addition') seatsOccupied += seats;
  }
  return {
    tables: tables.length,
    primaries: primaries.length,
    byStatus,
    seatsTotal,
    seatsOccupied,
    occupancyRate: seatsTotal > 0 ? Math.round((seatsOccupied / seatsTotal) * 100) : 0,
    mergedGroups: primaries.filter((table) => table.mergedIds.length > 0).length,
    mergedTables: tables.filter((table) => table.mergedIntoId).length,
    serviceable: primaries.filter((table) => table.status !== 'hors_service').length,
  };
}

function serializeTable(store: FloorStore, table: FloorTable, appPublicUrl: string) {
  const zone = store.zones.get(table.zoneId);
  const mergedCodes = table.mergedIds
    .map((id) => store.tables.get(id)?.code)
    .filter((code): code is string => Boolean(code));
  const primary = table.mergedIntoId ? store.tables.get(table.mergedIntoId) : undefined;
  return {
    id: table.id,
    zoneId: table.zoneId,
    zoneName: zone?.name ?? '—',
    zoneCode: zone?.code ?? '—',
    zoneKind: zone?.kind ?? 'salle',
    number: table.number,
    code: table.code,
    capacity: table.capacity,
    effectiveCapacity: effectiveCapacity(store, table),
    type: table.type,
    status: table.status,
    x: table.x,
    y: table.y,
    orderId: table.orderId,
    reservationId: table.reservationId,
    mergedIntoId: table.mergedIntoId,
    mergedIntoCode: primary?.code,
    mergedIds: table.mergedIds,
    mergedCodes,
    qrUrl: `${appPublicUrl}/t/${table.tenantId}/${encodeURIComponent(table.code)}`,
    updatedAt: table.updatedAt,
    updatedBy: table.updatedBy,
  };
}

function ensureCodeFree(store: FloorStore, tenantId: string, code: string, exceptId: string) {
  const existing = tablesOf(store, tenantId).find(
    (table) => table.code === code && table.id !== exceptId,
  );
  if (existing) {
    throw HttpError.conflict(
      'table_code_conflict',
      `Le code « ${code} » est déjà attribué à une autre place.`,
      {
        code,
        tableId: existing.id,
      },
    );
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OPEN_MINUTES = 11 * 60;
const LAST_SLOT_MINUTES = 22 * 60 + 30;
const MAX_DAYS_AHEAD = 60;

function requireDate(source: Record<string, unknown>, field: string): string {
  const value = requireString(source, field, { min: 10, max: 10 });
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw HttpError.unprocessable(
      'validation_error',
      `« ${field} » doit être une date AAAA-MM-JJ.`,
      { field },
    );
  }
  return value;
}

function requireSlotTime(source: Record<string, unknown>, field: string): string {
  const value = requireString(source, field, { min: 5, max: 5 });
  if (!TIME_RE.test(value)) {
    throw HttpError.unprocessable('validation_error', `« ${field} » doit être une heure HH:MM.`, {
      field,
    });
  }
  const minutes = timeToMinutes(value);
  if (minutes < OPEN_MINUTES || minutes > LAST_SLOT_MINUTES) {
    throw HttpError.unprocessable(
      'validation_error',
      'Les réservations sont possibles entre 11:00 et 22:30.',
      {
        field,
      },
    );
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureBookableDate(date: string): void {
  const today = todayIso();
  if (date < today) {
    throw HttpError.unprocessable('reservation_date_past', 'Cette date est déjà passée.', { date });
  }
  const limit = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (date > limit) {
    throw HttpError.unprocessable(
      'reservation_date_too_far',
      `Réservation limitée à ${MAX_DAYS_AHEAD} jours à l’avance.`,
      {
        date,
      },
    );
  }
}

function activeReservations(store: FloorStore, tenantId: string, date: string): FloorReservation[] {
  return reservationsForDate(store, tenantId, date).filter(
    (entry) => entry.status === 'confirmee' || entry.status === 'installee',
  );
}

function bookableTables(
  store: FloorStore,
  tenantId: string,
  date: string,
  time: string,
  partySize: number,
  excludeReservationId?: string,
): FloorTable[] {
  const active = activeReservations(store, tenantId, date);
  const sameDay = date === todayIso();
  return tablesOf(store, tenantId)
    .filter((table) => !table.mergedIntoId && table.status !== 'hors_service')
    .filter((table) => effectiveCapacity(store, table) >= partySize)
    .filter((table) => !sameDay || table.status === 'libre' || table.status === 'reservee')
    .filter((table) => !(sameDay && table.orderId))
    .filter(
      (table) =>
        !active.some(
          (entry) =>
            entry.id !== excludeReservationId &&
            entry.tableId === table.id &&
            reservationsOverlap(entry.time, time),
        ),
    )
    .sort((a, b) => effectiveCapacity(store, a) - effectiveCapacity(store, b));
}

function slotsFor(date: string, partySize: number, store: FloorStore, tenantId: string) {
  const slots: Array<{ time: string; tablesAvailable: number; available: boolean }> = [];
  for (let minutes = OPEN_MINUTES; minutes <= LAST_SLOT_MINUTES; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const tables = bookableTables(store, tenantId, date, time, partySize);
    slots.push({ time, tablesAvailable: tables.length, available: tables.length > 0 });
  }
  return slots;
}

function requireReservation(store: FloorStore, tenantId: string, id: string): FloorReservation {
  const reservation = store.reservations.get(id);
  if (!reservation || reservation.tenantId !== tenantId)
    throw HttpError.notFound('Réservation introuvable.');
  return reservation;
}

function reservationView(
  store: FloorStore,
  reservation: FloorReservation,
  options: { staff: boolean },
) {
  const table = reservation.tableId ? store.tables.get(reservation.tableId) : undefined;
  const zone = table ? store.zones.get(table.zoneId) : undefined;
  return {
    id: reservation.id,
    reference: reservation.reference,
    date: reservation.date,
    time: reservation.time,
    partySize: reservation.partySize,
    status: reservation.status,
    tableId: reservation.tableId,
    tableCode: table?.code ?? null,
    zoneName: zone?.name ?? null,
    note: reservation.note ?? null,
    source: reservation.source,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    seatedAt: reservation.seatedAt ?? null,
    cancelledAt: reservation.cancelledAt ?? null,
    cancelReason: reservation.cancelReason ?? null,
    ...(options.staff
      ? { customerName: reservation.customerName, customerPhone: reservation.customerPhone }
      : {}),
  };
}

function requirePartySize(source: Record<string, unknown>): number {
  return requireInt(source, 'partySize', { min: 1, max: 20 });
}

function chooseTable(
  store: FloorStore,
  tenantId: string,
  date: string,
  time: string,
  partySize: number,
  requestedTableId?: string,
  excludeReservationId?: string,
): FloorTable | undefined {
  if (requestedTableId) {
    const table = requireTable(store, tenantId, requestedTableId);
    const available = bookableTables(
      store,
      tenantId,
      date,
      time,
      partySize,
      excludeReservationId,
    ).some((entry) => entry.id === table.id);
    if (!available) {
      throw HttpError.conflict(
        'table_unavailable',
        'Cette table n’est pas disponible pour ce créneau.',
        {
          tableId: table.id,
        },
      );
    }
    return table;
  }
  return bookableTables(store, tenantId, date, time, partySize, excludeReservationId)[0];
}

function holdTable(
  store: FloorStore,
  table: FloorTable,
  reservation: FloorReservation,
  actorId: string,
): boolean {
  if (reservation.date !== todayIso()) return false;
  if (table.status !== 'libre') return false;
  table.status = 'reservee';
  table.reservationId = reservation.id;
  table.updatedAt = reservation.updatedAt;
  table.updatedBy = actorId;
  return true;
}

function releaseTable(
  store: FloorStore,
  reservation: FloorReservation,
  actorId: string,
): FloorTable | undefined {
  if (!reservation.tableId) return undefined;
  const table = store.tables.get(reservation.tableId);
  if (!table) return undefined;
  if (table.reservationId !== reservation.id || table.status !== 'reservee') return undefined;
  table.status = 'libre';
  delete table.reservationId;
  table.updatedAt = nowIso();
  table.updatedBy = actorId;
  return table;
}

function emitStatus(
  store: FloorStore,
  table: FloorTable,
  from: TableStatus,
  actorId: string,
): Record<string, unknown> {
  return {
    tenantId: table.tenantId,
    tableId: table.id,
    code: table.code,
    zoneId: table.zoneId,
    from,
    to: table.status,
    orderId: table.orderId,
    actorId,
    at: table.updatedAt,
  };
}

export function buildFloorApp(options: FloorAppOptions): Route[] {
  const { store, appPublicUrl, publish } = options;

  const payloadFor = (table: FloorTable) =>
    `${appPublicUrl}/t/${table.tenantId}/${encodeURIComponent(table.code)}?k=${table.qrToken}`;

  const snapshot = (tenantId: string) => {
    const settings = settingsOf(store, tenantId);
    return {
      tenantId,
      live: true,
      generatedAt: nowIso(),
      settings: settings
        ? { establishmentCode: settings.establishmentCode, updatedAt: settings.updatedAt }
        : null,
      zones: zonesOf(store, tenantId).map(({ tenantId: _tenantId, ...rest }) => rest),
      tables: tablesOf(store, tenantId)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((table) => serializeTable(store, table, appPublicUrl)),
      summary: occupancy(store, tenantId),
    };
  };

  return [
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/floor',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'floor:view');
        return { body: snapshot(tenantId) };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/floor/occupancy',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'floor:view');
        const zones = zonesOf(store, tenantId).map((zone) => {
          const tables = tablesOf(store, tenantId).filter(
            (table) => table.zoneId === zone.id && !table.mergedIntoId,
          );
          return {
            id: zone.id,
            name: zone.name,
            kind: zone.kind,
            tables: tables.length,
            occupied: tables.filter(
              (table) => table.status === 'occupee' || table.status === 'addition',
            ).length,
            seats: tables.reduce((sum, table) => sum + effectiveCapacity(store, table), 0),
          };
        });
        return {
          body: {
            tenantId,
            live: true,
            generatedAt: nowIso(),
            summary: occupancy(store, tenantId),
            zones,
          },
        };
      },
    },
    {
      method: 'PUT',
      path: '/api/v1/tenants/:tenantId/floor/settings',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const body = asObject(ctx.body);
        const establishmentCode = requireString(body, 'establishmentCode', {
          max: 12,
        }).toUpperCase();
        if (!ESTABLISHMENT_CODE.test(establishmentCode)) {
          throw HttpError.unprocessable(
            'validation_error',
            'Code établissement : 3 à 12 caractères A-Z/0-9 (ex. LOME01).',
            { field: 'establishmentCode' },
          );
        }
        const tables = tablesOf(store, tenantId);
        const nextCodes = new Map<string, string>();
        for (const table of tables) {
          const zone = store.zones.get(table.zoneId);
          if (!zone) continue;
          const code = tableCode(establishmentCode, zone.code, table.number);
          const clash = tables.find(
            (other) => other.id !== table.id && nextCodes.get(other.id) === code,
          );
          if (clash) {
            throw HttpError.conflict(
              'table_code_conflict',
              `Le code « ${code} » serait dupliqué.`,
              {
                code,
                tableId: clash.id,
              },
            );
          }
          nextCodes.set(table.id, code);
        }
        const now = nowIso();
        for (const table of tables) {
          const code = nextCodes.get(table.id);
          if (code && code !== table.code) {
            table.code = code;
            table.updatedAt = now;
          }
        }
        store.settings.set(tenantId, { tenantId, establishmentCode, updatedAt: now });
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.settings.updated',
          targetType: 'floor',
          targetId: tenantId,
          meta: { establishmentCode },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'settings',
          establishmentCode,
        });
        return { body: snapshot(tenantId) };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/zones',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const body = asObject(ctx.body);
        const name = requireString(body, 'name', { min: 2, max: 60 });
        const kind = body.kind;
        if (typeof kind !== 'string' || !(ZONE_KINDS as readonly string[]).includes(kind)) {
          throw HttpError.unprocessable('validation_error', 'Type de zone invalide.', {
            field: 'kind',
          });
        }
        const zoneKind = kind as ZoneKind;
        const requestedCode = (
          optionalString(body, 'code', { max: 4 }) ?? DEFAULT_ZONE_CODES[zoneKind]
        ).toUpperCase();
        if (!ZONE_CODE.test(requestedCode)) {
          throw HttpError.unprocessable(
            'validation_error',
            'Code de zone : 2 à 4 caractères A-Z/0-9.',
            {
              field: 'code',
            },
          );
        }
        if (zonesOf(store, tenantId).some((zone) => zone.code === requestedCode)) {
          throw HttpError.conflict(
            'zone_code_conflict',
            `Le code de zone « ${requestedCode} » existe déjà.`,
            {
              code: requestedCode,
            },
          );
        }
        const now = nowIso();
        const zone: FloorZone = {
          id: newFloorId('zon'),
          tenantId,
          name,
          kind: zoneKind,
          code: requestedCode,
          position:
            optionalInt(body, 'position', { min: 0, max: 999 }) ??
            Math.max(0, ...zonesOf(store, tenantId).map((entry) => entry.position)) + 1,
          createdAt: now,
          updatedAt: now,
        };
        store.zones.set(zone.id, zone);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.zone.created',
          targetType: 'zone',
          targetId: zone.id,
          meta: { name, kind: zoneKind, code: requestedCode },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'zone_created',
          zoneId: zone.id,
        });
        return { status: 201, body: { zone } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/floor/zones/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const zone = requireZone(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (body.name !== undefined) zone.name = requireString(body, 'name', { min: 2, max: 60 });
        if (body.kind !== undefined) {
          if (
            typeof body.kind !== 'string' ||
            !(ZONE_KINDS as readonly string[]).includes(body.kind)
          ) {
            throw HttpError.unprocessable('validation_error', 'Type de zone invalide.', {
              field: 'kind',
            });
          }
          zone.kind = body.kind as ZoneKind;
        }
        if (body.code !== undefined) {
          const code = requireString(body, 'code', { max: 4 }).toUpperCase();
          if (!ZONE_CODE.test(code)) {
            throw HttpError.unprocessable(
              'validation_error',
              'Code de zone : 2 à 4 caractères A-Z/0-9.',
              {
                field: 'code',
              },
            );
          }
          if (
            zonesOf(store, tenantId).some((other) => other.id !== zone.id && other.code === code)
          ) {
            throw HttpError.conflict(
              'zone_code_conflict',
              `Le code de zone « ${code} » existe déjà.`,
              { code },
            );
          }
          const settings = settingsOf(store, tenantId);
          if (!settings)
            throw HttpError.unprocessable(
              'floor_settings_required',
              'Configurez d’abord le code établissement.',
            );
          const nextCodes = new Map<string, string>();
          const zoneTables = tablesOf(store, tenantId).filter((table) => table.zoneId === zone.id);
          for (const table of zoneTables) {
            const nextCode = tableCode(settings.establishmentCode, code, table.number);
            ensureCodeFree(store, tenantId, nextCode, table.id);
            if ([...nextCodes.values()].includes(nextCode)) {
              throw HttpError.conflict(
                'table_code_conflict',
                `Le code « ${nextCode} » serait dupliqué.`,
                {
                  code: nextCode,
                  tableId: table.id,
                },
              );
            }
            nextCodes.set(table.id, nextCode);
          }
          zone.code = code;
          const now = nowIso();
          for (const table of zoneTables) {
            table.code = nextCodes.get(table.id) ?? table.code;
            table.updatedAt = now;
          }
        }
        const position = optionalInt(body, 'position', { min: 0, max: 999 });
        if (position !== undefined) zone.position = position;
        zone.updatedAt = nowIso();
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.zone.updated',
          targetType: 'zone',
          targetId: zone.id,
          meta: { name: zone.name, code: zone.code },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'zone_updated',
          zoneId: zone.id,
        });
        return { body: { zone } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/floor/zones/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const zone = requireZone(store, tenantId, ctx.params.id);
        const count = tablesOf(store, tenantId).filter((table) => table.zoneId === zone.id).length;
        if (count > 0) {
          throw HttpError.conflict(
            'zone_not_empty',
            'Déplacez ou supprimez d’abord les places de cette zone.',
            { tables: count },
          );
        }
        store.zones.delete(zone.id);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.zone.deleted',
          targetType: 'zone',
          targetId: zone.id,
          meta: { name: zone.name },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'zone_deleted',
          zoneId: zone.id,
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/tables',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const settings = settingsOf(store, tenantId);
        if (!settings) {
          throw HttpError.unprocessable(
            'floor_settings_required',
            'Renseignez le code établissement avant d’ajouter des places.',
          );
        }
        const body = asObject(ctx.body);
        const zone = requireZone(store, tenantId, requireString(body, 'zoneId', { max: 64 }));
        const zoneTables = tablesOf(store, tenantId).filter((table) => table.zoneId === zone.id);
        const number =
          optionalInt(body, 'number', { min: 1, max: 999 }) ??
          Math.max(0, ...zoneTables.map((table) => table.number)) + 1;
        if (zoneTables.some((table) => table.number === number)) {
          throw HttpError.conflict(
            'table_number_conflict',
            `Le numéro ${number} est déjà utilisé dans « ${zone.name} ».`,
            {
              number,
              zoneId: zone.id,
            },
          );
        }
        const code = tableCode(settings.establishmentCode, zone.code, number);
        ensureCodeFree(store, tenantId, code, '');
        const type = body.type ?? 'table';
        if (typeof type !== 'string' || !(TABLE_TYPES as readonly string[]).includes(type)) {
          throw HttpError.unprocessable('validation_error', 'Type de place invalide.', {
            field: 'type',
          });
        }
        const count = zoneTables.length;
        const now = nowIso();
        const table: FloorTable = {
          id: newFloorId('tbl'),
          tenantId,
          zoneId: zone.id,
          number,
          code,
          capacity: requireInt(body, 'capacity', { min: 1, max: 50 }),
          type: type as TableType,
          status: 'libre',
          x: optionalNumber(body, 'x') ?? 14 + (count % 4) * 24,
          y: optionalNumber(body, 'y') ?? 18 + Math.floor(count / 4) * 26,
          mergedIds: [],
          qrToken: randomToken(6),
          createdAt: now,
          updatedAt: now,
          updatedBy: claims.sub,
        };
        store.tables.set(table.id, table);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.table.created',
          targetType: 'table',
          targetId: table.id,
          meta: { code: table.code, zoneId: zone.id, capacity: table.capacity },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'table_created',
          tableId: table.id,
          code: table.code,
        });
        return { status: 201, body: { table: serializeTable(store, table, appPublicUrl) } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const table = requireTable(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        const settings = settingsOf(store, tenantId);
        if (!settings)
          throw HttpError.unprocessable('floor_settings_required', 'Code établissement manquant.');
        let nextZone = store.zones.get(table.zoneId);
        let nextNumber = table.number;
        let touchedCode = false;
        if (body.zoneId !== undefined) {
          nextZone = requireZone(store, tenantId, requireString(body, 'zoneId', { max: 64 }));
          touchedCode = true;
        }
        if (body.number !== undefined) {
          nextNumber = requireInt(body, 'number', { min: 1, max: 999 });
          touchedCode = true;
        }
        if (!nextZone) throw HttpError.notFound('Zone introuvable.');
        if (touchedCode) {
          const duplicate = tablesOf(store, tenantId).find(
            (other) =>
              other.id !== table.id && other.zoneId === nextZone!.id && other.number === nextNumber,
          );
          if (duplicate) {
            throw HttpError.conflict(
              'table_number_conflict',
              `Le numéro ${nextNumber} est déjà utilisé dans cette zone.`,
              {
                number: nextNumber,
                zoneId: nextZone.id,
              },
            );
          }
          const code = tableCode(settings.establishmentCode, nextZone.code, nextNumber);
          ensureCodeFree(store, tenantId, code, table.id);
          table.zoneId = nextZone.id;
          table.number = nextNumber;
          table.code = code;
        }
        const capacity = optionalInt(body, 'capacity', { min: 1, max: 50 });
        if (capacity !== undefined) table.capacity = capacity;
        if (body.type !== undefined) {
          if (
            typeof body.type !== 'string' ||
            !(TABLE_TYPES as readonly string[]).includes(body.type)
          ) {
            throw HttpError.unprocessable('validation_error', 'Type de place invalide.', {
              field: 'type',
            });
          }
          table.type = body.type as TableType;
        }
        const x = optionalNumber(body, 'x');
        if (x !== undefined) table.x = x;
        const y = optionalNumber(body, 'y');
        if (y !== undefined) table.y = y;
        table.updatedAt = nowIso();
        table.updatedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.table.updated',
          targetType: 'table',
          targetId: table.id,
          meta: {
            code: table.code,
            x: table.x,
            y: table.y,
            capacity: table.capacity,
            type: table.type,
          },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'table_updated',
          tableId: table.id,
          code: table.code,
        });
        return { body: { table: serializeTable(store, table, appPublicUrl) } };
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const table = requireTable(store, tenantId, ctx.params.id);
        if (table.orderId) {
          throw HttpError.conflict('table_has_order', 'Cette place porte une commande en cours.', {
            orderId: table.orderId,
          });
        }
        if (table.mergedIds.length > 0 || table.mergedIntoId) {
          throw HttpError.conflict('table_merged', 'Divisez la table avant de la supprimer.');
        }
        store.tables.delete(table.id);
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.table.deleted',
          targetType: 'table',
          targetId: table.id,
          meta: { code: table.code },
        });
        await publish('FloorLayoutUpdated', tenantId, {
          tenantId,
          change: 'table_deleted',
          tableId: table.id,
          code: table.code,
        });
        return { body: { ok: true } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id/status',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = ctx.auth;
        if (!claims) throw HttpError.unauthorized();
        if (!canAny(claims, tenantId, ['floor:status', 'floor:manage'])) {
          throw new HttpError(
            403,
            'tenant_scope_denied',
            "Vous n'avez pas accès à cet établissement.",
          );
        }
        const table = requireTable(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        if (
          typeof body.status !== 'string' ||
          !(TABLE_STATUSES as readonly string[]).includes(body.status)
        ) {
          throw HttpError.unprocessable('validation_error', 'Statut de table inconnu.', {
            field: 'status',
          });
        }
        const status = body.status as TableStatus;
        if (table.mergedIntoId) {
          throw HttpError.conflict(
            'table_merged',
            'Cette place est fusionnée : pilotez la table principale.',
          );
        }
        if (status === table.status) {
          throw HttpError.unprocessable('status_unchanged', 'La table est déjà dans ce statut.', {
            field: 'status',
          });
        }
        if (!STATUS_TRANSITIONS[table.status].includes(status)) {
          throw HttpError.conflict(
            'status_transition_invalid',
            `Transition ${table.status} → ${status} interdite.`,
            {
              from: table.status,
              to: status,
              allowed: STATUS_TRANSITIONS[table.status],
            },
          );
        }
        if (status === 'occupee' && body.orderId !== undefined) {
          const orderId = requireString(body, 'orderId', { max: 64 });
          if (!ORDER_ID.test(orderId)) {
            throw HttpError.unprocessable('validation_error', 'Identifiant de commande invalide.', {
              field: 'orderId',
            });
          }
          table.orderId = orderId;
        }
        if (body.reservationId !== undefined) {
          table.reservationId = optionalString(body, 'reservationId', { max: 64 });
        }
        if (status === 'libre') {
          delete table.orderId;
          delete table.reservationId;
        }
        const from = table.status;
        table.status = status;
        table.updatedAt = nowIso();
        table.updatedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.table.status_changed',
          targetType: 'table',
          targetId: table.id,
          meta: { from, to: status, orderId: table.orderId },
        });
        await publish('TableStatusChanged', tenantId, emitStatus(store, table, from, claims.sub));
        return { body: { table: serializeTable(store, table, appPublicUrl) } };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/tables/merge',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const body = asObject(ctx.body);
        const ids = body.tableIds;
        if (!Array.isArray(ids) || ids.length < 2 || ids.length > 6) {
          throw HttpError.unprocessable('validation_error', 'Fusionnez 2 à 6 places à la fois.', {
            field: 'tableIds',
          });
        }
        const tables = ids.map((id) => requireTable(store, tenantId, String(id)));
        const primaryId = optionalString(body, 'primaryId', { max: 64 }) ?? tables[0].id;
        const primary = tables.find((table) => table.id === primaryId);
        if (!primary)
          throw HttpError.unprocessable(
            'validation_error',
            'La table principale doit figurer dans la sélection.',
          );
        if (
          tables.some(
            (table) =>
              table.mergedIntoId || (table.id !== primary.id && table.mergedIds.length > 0),
          )
        ) {
          throw HttpError.conflict('table_merged', 'Une des places est déjà fusionnée.');
        }
        if (tables.some((table) => table.zoneId !== primary.zoneId)) {
          throw HttpError.unprocessable(
            'validation_error',
            'Les places à fusionner doivent être dans la même zone.',
          );
        }
        if (tables.some((table) => table.status === 'hors_service')) {
          throw HttpError.conflict(
            'table_out_of_service',
            'Impossible de fusionner une place hors service.',
          );
        }
        const secondaries = tables.filter((table) => table.id !== primary.id);
        const now = nowIso();
        primary.mergedIds = [
          ...new Set([...primary.mergedIds, ...secondaries.map((table) => table.id)]),
        ];
        primary.updatedAt = now;
        primary.updatedBy = claims.sub;
        for (const table of secondaries) {
          table.mergedIntoId = primary.id;
          table.updatedAt = now;
          table.updatedBy = claims.sub;
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.tables.merged',
          targetType: 'table',
          targetId: primary.id,
          meta: { primaryCode: primary.code, mergedCodes: secondaries.map((table) => table.code) },
        });
        await publish('FloorTablesMerged', tenantId, {
          tenantId,
          primaryId: primary.id,
          primaryCode: primary.code,
          tableIds: tables.map((table) => table.id),
          codes: tables.map((table) => table.code),
          capacity: effectiveCapacity(store, primary),
          actorId: claims.sub,
          at: now,
        });
        return {
          body: {
            primary: serializeTable(store, primary, appPublicUrl),
            summary: occupancy(store, tenantId),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id/split',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const table = requireTable(store, tenantId, ctx.params.id);
        if (table.mergedIds.length === 0) {
          throw HttpError.conflict(
            'table_not_merged',
            'Cette place n’est pas une table fusionnée.',
          );
        }
        const memberIds = [...table.mergedIds];
        const now = nowIso();
        for (const memberId of memberIds) {
          const member = store.tables.get(memberId);
          if (member) {
            delete member.mergedIntoId;
            member.updatedAt = now;
            member.updatedBy = claims.sub;
          }
        }
        table.mergedIds = [];
        table.updatedAt = now;
        table.updatedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.tables.split',
          targetType: 'table',
          targetId: table.id,
          meta: { primaryCode: table.code, released: memberIds },
        });
        await publish('FloorTablesSplit', tenantId, {
          tenantId,
          primaryId: table.id,
          primaryCode: table.code,
          tableIds: [table.id, ...memberIds],
          actorId: claims.sub,
          at: now,
        });
        return {
          body: {
            primary: serializeTable(store, table, appPublicUrl),
            summary: occupancy(store, tenantId),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id/transfer',
      handler: async (ctx) => {
        const { tenantId, claims } = tenantOf(ctx, 'floor:manage');
        const source = requireTable(store, tenantId, ctx.params.id);
        const body = asObject(ctx.body);
        const target = requireTable(store, tenantId, requireString(body, 'toTableId', { max: 64 }));
        if (source.id === target.id) {
          throw HttpError.unprocessable('validation_error', 'Choisissez une autre place.', {
            field: 'toTableId',
          });
        }
        if (source.mergedIntoId) {
          throw HttpError.conflict('table_merged', 'Transférez depuis la table principale.');
        }
        if (!source.orderId || (source.status !== 'occupee' && source.status !== 'addition')) {
          throw HttpError.conflict(
            'no_active_order',
            'Aucune commande active à transférer sur cette place.',
          );
        }
        if (target.mergedIntoId) {
          throw HttpError.conflict(
            'table_merged',
            'La place cible est fusionnée : choisissez sa table principale.',
          );
        }
        if (target.orderId || (target.status !== 'libre' && target.status !== 'reservee')) {
          throw HttpError.conflict('target_busy', 'La place cible n’est pas disponible.', {
            status: target.status,
          });
        }
        const orderId = source.orderId;
        const now = nowIso();
        const sourceFrom = source.status;
        const targetFrom = target.status;
        source.status = body.releaseSource === true ? 'libre' : 'nettoyage';
        delete source.orderId;
        delete source.reservationId;
        target.status = 'occupee';
        target.orderId = orderId;
        delete target.reservationId;
        source.updatedAt = now;
        source.updatedBy = claims.sub;
        target.updatedAt = now;
        target.updatedBy = claims.sub;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.order.transferred',
          targetType: 'table',
          targetId: target.id,
          meta: { orderId, fromCode: source.code, toCode: target.code },
        });
        await publish(
          'TableStatusChanged',
          tenantId,
          emitStatus(store, source, sourceFrom, claims.sub),
        );
        await publish(
          'TableStatusChanged',
          tenantId,
          emitStatus(store, target, targetFrom, claims.sub),
        );
        await publish('FloorOrderTransferred', tenantId, {
          tenantId,
          orderId,
          fromTableId: source.id,
          fromCode: source.code,
          toTableId: target.id,
          toCode: target.code,
          actorId: claims.sub,
          at: now,
        });
        return {
          body: {
            source: serializeTable(store, source, appPublicUrl),
            target: serializeTable(store, target, appPublicUrl),
            summary: occupancy(store, tenantId),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/floor/tables/:id/qr',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'floor:view');
        const table = requireTable(store, tenantId, ctx.params.id);
        const format = ctx.query.get('format') === 'png' ? 'png' : 'svg';
        const data =
          format === 'png' ? await qrPng(payloadFor(table)) : await qrSvg(payloadFor(table));
        return {
          raw: {
            data,
            contentType: format === 'png' ? 'image/png' : 'image/svg+xml',
            fileName: `qr-${table.code}.${format}`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/floor/qr-sheet.pdf',
      handler: async (ctx) => {
        const { tenantId } = tenantOf(ctx, 'floor:view');
        const settings = settingsOf(store, tenantId);
        if (!settings)
          throw HttpError.unprocessable('floor_settings_required', 'Code établissement manquant.');
        const zones = zonesOf(store, tenantId);
        const tables = tablesOf(store, tenantId).sort((a, b) => {
          const zoneA = zones.findIndex((zone) => zone.id === a.zoneId);
          const zoneB = zones.findIndex((zone) => zone.id === b.zoneId);
          return zoneA - zoneB || a.number - b.number;
        });
        if (tables.length === 0) {
          throw HttpError.unprocessable('floor_empty', 'Aucune place à imprimer.');
        }
        const pdf = await buildQrSheetPdf({
          establishmentCode: settings.establishmentCode,
          tenantId,
          tables: tables.map((table) => ({
            code: table.code,
            zoneName: store.zones.get(table.zoneId)?.name ?? '—',
            capacity: table.capacity,
            payload: payloadFor(table),
          })),
        });
        return {
          raw: {
            data: Buffer.from(pdf),
            contentType: 'application/pdf',
            fileName: `qr-${settings.establishmentCode}.pdf`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/floor/audit',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'audit:view');
        return {
          body: {
            entries: store.audit.filter((entry) => entry.tenantId === tenantId),
            integrity: verifyAuditChain(store.audit),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/reservations/availability',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        if (!settingsOf(store, tenantId)) throw HttpError.notFound('Établissement introuvable.');
        const dateParam = ctx.query.get('date') ?? todayIso();
        const date = requireDate({ date: dateParam }, 'date');
        ensureBookableDate(date);
        const partySize = Number(ctx.query.get('partySize') ?? 2);
        if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
          throw HttpError.unprocessable('validation_error', 'Nombre de personnes : 1 à 20.');
        }
        const tables = bookableTables(store, tenantId, date, '19:00', partySize).map((table) => ({
          id: table.id,
          code: table.code,
          capacity: table.capacity,
          effectiveCapacity: effectiveCapacity(store, table),
          type: table.type,
          zoneId: table.zoneId,
          zoneName: store.zones.get(table.zoneId)?.name ?? null,
        }));
        return {
          body: {
            tenantId,
            date,
            partySize,
            slots: slotsFor(date, partySize, store, tenantId),
            tables,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/public/tenants/:tenantId/reservations',
      auth: false,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        if (!settingsOf(store, tenantId)) throw HttpError.notFound('Établissement introuvable.');
        const body = asObject(ctx.body);
        const date = requireDate(body, 'date');
        ensureBookableDate(date);
        const time = requireSlotTime(body, 'time');
        const partySize = requirePartySize(body);
        const customerName = requireString(body, 'customerName', { min: 2, max: 80 });
        const customerPhone = requirePhone(body, 'customerPhone');
        const note = optionalString(body, 'note', { max: 240 });
        const requestedTableId = optionalString(body, 'tableId', { max: 64 });
        const table = chooseTable(store, tenantId, date, time, partySize, requestedTableId);
        if (!table) {
          throw HttpError.conflict(
            'no_table_available',
            'Plus aucune table disponible pour ce créneau.',
          );
        }
        const now = nowIso();
        const reservation: FloorReservation = {
          id: newFloorId('res'),
          tenantId,
          reference: nextReservationReference(store),
          date,
          time,
          partySize,
          zoneId: table.zoneId,
          tableId: table.id,
          customerName,
          customerPhone,
          note,
          status: 'confirmee',
          source: 'client',
          publicToken: randomToken(8),
          createdAt: now,
          updatedAt: now,
        };
        store.reservations.set(reservation.id, reservation);
        if (holdTable(store, table, reservation, 'client')) {
          await publish(
            'TableStatusChanged',
            tenantId,
            emitStatus(store, table, 'libre', 'client'),
          );
        }
        store.recordAudit({
          tenantId,
          actorId: 'client',
          action: 'floor.reservation.created',
          targetType: 'reservation',
          targetId: reservation.id,
          meta: { reference: reservation.reference, date, time, partySize, tableCode: table.code },
        });
        await publish('ReservationCreated', tenantId, {
          tenantId,
          reservationId: reservation.id,
          reference: reservation.reference,
          date,
          time,
          partySize,
          tableId: table.id,
          tableCode: table.code,
          source: 'client',
          at: now,
        });
        return {
          status: 201,
          body: {
            reservation: reservationView(store, reservation, { staff: false }),
            publicToken: reservation.publicToken,
            trackUrl: `${appPublicUrl}/reservation/${tenantId}/${reservation.id}?k=${reservation.publicToken}`,
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/reservations/:id',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const reservation = requireReservation(store, tenantId, ctx.params.id ?? '');
        const token = ctx.query.get('k') ?? '';
        if (!token || token !== reservation.publicToken) {
          throw new HttpError(403, 'reservation_token_invalid', 'Accès à la réservation refusé.');
        }
        const table = reservation.tableId ? store.tables.get(reservation.tableId) : undefined;
        return {
          body: {
            reservation: {
              ...reservationView(store, reservation, { staff: false }),
              status: reservation.status,
            },
            tableStatus: table?.status ?? null,
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/public/tenants/:tenantId/reservations/:id/cancel',
      auth: false,
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const reservation = requireReservation(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        if (body.k !== reservation.publicToken) {
          throw new HttpError(403, 'reservation_token_invalid', 'Accès à la réservation refusé.');
        }
        if (reservation.status === 'annulee')
          return { body: { reservation: reservationView(store, reservation, { staff: false }) } };
        if (reservation.status !== 'confirmee') {
          throw HttpError.conflict(
            'reservation_not_cancelable',
            'Cette réservation ne peut plus être annulée en ligne.',
          );
        }
        const now = nowIso();
        const from = reservation.status;
        reservation.status = 'annulee';
        reservation.cancelledAt = now;
        reservation.cancelBy = 'client';
        reservation.cancelReason = 'Annulée par le client';
        reservation.updatedAt = now;
        const table = releaseTable(store, reservation, 'client');
        if (table)
          await publish(
            'TableStatusChanged',
            tenantId,
            emitStatus(store, table, 'reservee', 'client'),
          );
        store.recordAudit({
          tenantId,
          actorId: 'client',
          action: 'floor.reservation.cancelled',
          targetType: 'reservation',
          targetId: reservation.id,
          meta: { reference: reservation.reference, by: 'client' },
        });
        await publish('ReservationStatusChanged', tenantId, {
          tenantId,
          reservationId: reservation.id,
          reference: reservation.reference,
          from,
          to: reservation.status,
          actorId: 'client',
          at: now,
        });
        return { body: { reservation: reservationView(store, reservation, { staff: false }) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/tenants/:tenantId/reservations',
      handler: (ctx) => {
        const { tenantId } = tenantOf(ctx, 'floor:view');
        const dateParam = ctx.query.get('date');
        const statusFilter = ctx.query.get('status');
        let items = dateParam
          ? reservationsForDate(store, tenantId, requireDate({ date: dateParam }, 'date'))
          : [...store.reservations.values()].filter((entry) => entry.tenantId === tenantId);
        if (statusFilter) {
          items = items.filter((entry) => entry.status === statusFilter);
        }
        items = items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        return {
          body: {
            tenantId,
            items: items.map((entry) => reservationView(store, entry, { staff: true })),
            generatedAt: nowIso(),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/reservations',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = ctx.auth;
        if (!claims) throw HttpError.unauthorized();
        if (!canAny(claims, tenantId, ['floor:status', 'floor:manage'])) {
          throw new HttpError(
            403,
            'tenant_scope_denied',
            "Vous n'avez pas accès à cet établissement.",
          );
        }
        const body = asObject(ctx.body);
        const date = requireDate(body, 'date');
        ensureBookableDate(date);
        const time = requireSlotTime(body, 'time');
        const partySize = requirePartySize(body);
        const customerName = requireString(body, 'customerName', { min: 2, max: 80 });
        const customerPhone = requirePhone(body, 'customerPhone');
        const note = optionalString(body, 'note', { max: 240 });
        const requestedTableId = optionalString(body, 'tableId', { max: 64 });
        const table = chooseTable(store, tenantId, date, time, partySize, requestedTableId);
        const now = nowIso();
        const reservation: FloorReservation = {
          id: newFloorId('res'),
          tenantId,
          reference: nextReservationReference(store),
          date,
          time,
          partySize,
          zoneId: table?.zoneId,
          tableId: table?.id,
          customerName,
          customerPhone,
          note,
          status: 'confirmee',
          source: 'staff',
          publicToken: randomToken(8),
          createdAt: now,
          updatedAt: now,
        };
        store.reservations.set(reservation.id, reservation);
        if (table && holdTable(store, table, reservation, claims.sub)) {
          await publish(
            'TableStatusChanged',
            tenantId,
            emitStatus(store, table, 'libre', claims.sub),
          );
        }
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.reservation.created',
          targetType: 'reservation',
          targetId: reservation.id,
          meta: {
            reference: reservation.reference,
            date,
            time,
            partySize,
            tableCode: table?.code ?? null,
          },
        });
        await publish('ReservationCreated', tenantId, {
          tenantId,
          reservationId: reservation.id,
          reference: reservation.reference,
          date,
          time,
          partySize,
          tableId: table?.id ?? null,
          tableCode: table?.code ?? null,
          source: 'staff',
          at: now,
        });
        return {
          status: 201,
          body: { reservation: reservationView(store, reservation, { staff: true }) },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/reservations/:id/status',
      handler: async (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const claims = ctx.auth;
        if (!claims) throw HttpError.unauthorized();
        if (!canAny(claims, tenantId, ['floor:status', 'floor:manage'])) {
          throw new HttpError(
            403,
            'tenant_scope_denied',
            "Vous n'avez pas accès à cet établissement.",
          );
        }
        const reservation = requireReservation(store, tenantId, ctx.params.id ?? '');
        const body = asObject(ctx.body);
        const next = body.status;
        if (
          typeof next !== 'string' ||
          next === 'confirmee' ||
          !['installee', 'annulee', 'no_show'].includes(next)
        ) {
          throw HttpError.unprocessable('validation_error', 'Statut de réservation invalide.', {
            field: 'status',
          });
        }
        if (next === reservation.status) {
          throw HttpError.unprocessable(
            'status_unchanged',
            'La réservation est déjà dans ce statut.',
            { field: 'status' },
          );
        }
        if (!RESERVATION_TRANSITIONS[reservation.status].includes(next as ReservationStatus)) {
          throw HttpError.conflict(
            'reservation_transition_invalid',
            `Transition ${reservation.status} → ${next} interdite.`,
            {
              from: reservation.status,
              to: next,
              allowed: RESERVATION_TRANSITIONS[reservation.status],
            },
          );
        }
        const now = nowIso();
        const from = reservation.status;
        const table = reservation.tableId ? store.tables.get(reservation.tableId) : undefined;
        if (next === 'installee') {
          if (!table) {
            throw HttpError.unprocessable(
              'reservation_table_required',
              'Attribuez une table avant d’installer les clients.',
            );
          }
          if (table.mergedIntoId) {
            throw HttpError.conflict(
              'table_merged',
              'La table de cette réservation a été fusionnée.',
            );
          }
          if (table.status === 'occupee' || table.status === 'addition') {
            throw HttpError.conflict('table_busy', 'Cette table est déjà occupée.');
          }
          if (table.status === 'hors_service') {
            throw HttpError.conflict('table_out_of_service', 'Cette table est hors service.');
          }
          if (table.status === 'libre') {
            const statusFrom = table.status;
            table.status = 'occupee';
            table.reservationId = reservation.id;
            table.updatedAt = now;
            table.updatedBy = claims.sub;
            await publish(
              'TableStatusChanged',
              tenantId,
              emitStatus(store, table, statusFrom, claims.sub),
            );
          }
          reservation.seatedAt = now;
        } else {
          const released = releaseTable(store, reservation, claims.sub);
          if (released)
            await publish(
              'TableStatusChanged',
              tenantId,
              emitStatus(store, released, 'reservee', claims.sub),
            );
          reservation.cancelledAt = now;
          reservation.cancelBy = claims.sub;
          reservation.cancelReason =
            optionalString(body, 'reason', { max: 240 }) ??
            (next === 'no_show' ? 'Client absent' : 'Annulée par l’établissement');
        }
        reservation.status = next as ReservationStatus;
        reservation.updatedAt = now;
        store.recordAudit({
          tenantId,
          actorId: claims.sub,
          action: 'floor.reservation.status_changed',
          targetType: 'reservation',
          targetId: reservation.id,
          meta: { reference: reservation.reference, from, to: reservation.status },
        });
        await publish('ReservationStatusChanged', tenantId, {
          tenantId,
          reservationId: reservation.id,
          reference: reservation.reference,
          from,
          to: reservation.status,
          tableId: reservation.tableId ?? null,
          actorId: claims.sub,
          at: now,
        });
        return { body: { reservation: reservationView(store, reservation, { staff: true }) } };
      },
    },
    {
      method: 'GET',
      path: '/api/v1/public/tenants/:tenantId/tables/:code',
      auth: false,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const code = (ctx.params.code ?? '').toUpperCase();
        const table = tablesOf(store, tenantId).find((entry) => entry.code === code);
        if (!table) throw HttpError.notFound('Place introuvable.');
        const zone = store.zones.get(table.zoneId);
        return {
          body: {
            tenantId,
            table: {
              id: table.id,
              code: table.code,
              capacity: table.capacity,
              type: table.type,
              status: table.status,
              zoneName: zone?.name ?? null,
              zoneKind: zone?.kind ?? null,
            },
            orderUrl: `${appPublicUrl}/t/${tenantId}/${encodeURIComponent(table.code)}`,
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/floor/tables/:code/verify',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const code = (ctx.params.code ?? '').toUpperCase();
        const table = tablesOf(store, tenantId).find((entry) => entry.code === code);
        if (!table) throw HttpError.notFound('Place introuvable.');
        const body = asObject(ctx.body);
        const token = requireString(body, 'token', { max: 120 });
        if (token !== table.qrToken) {
          throw new HttpError(403, 'table_token_invalid', 'QR de place invalide ou révoqué.');
        }
        const primary = table.mergedIntoId ? store.tables.get(table.mergedIntoId) : undefined;
        return {
          body: {
            tenantId,
            table: {
              id: table.id,
              code: table.code,
              status: table.status,
              capacity: effectiveCapacity(store, table),
              orderId: table.orderId ?? null,
              mergedIntoCode: primary?.code ?? null,
            },
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/floor/tables/:code/order',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const code = (ctx.params.code ?? '').toUpperCase();
        const table = tablesOf(store, tenantId).find((entry) => entry.code === code);
        if (!table) throw HttpError.notFound('Place introuvable.');
        if (table.mergedIntoId) {
          throw HttpError.conflict(
            'table_merged',
            'Place fusionnée : attachez la commande à la table principale.',
            {
              primaryCode: store.tables.get(table.mergedIntoId)?.code ?? null,
            },
          );
        }
        if (table.status === 'hors_service') {
          throw HttpError.conflict('table_out_of_service', 'Cette place est hors service.');
        }
        const body = asObject(ctx.body);
        const orderId = requireString(body, 'orderId', { max: 64 });
        const from = table.status;
        table.orderId = orderId;
        if (table.status === 'libre' || table.status === 'reservee') table.status = 'occupee';
        table.updatedAt = nowIso();
        table.updatedBy = 'order-service';
        store.recordAudit({
          tenantId,
          actorId: 'order-service',
          action: 'floor.order.attached',
          targetType: 'table',
          targetId: table.id,
          meta: { orderId, from, to: table.status },
        });
        if (from !== table.status) {
          void publish(
            'TableStatusChanged',
            tenantId,
            emitStatus(store, table, from, 'order-service'),
          );
        }
        return { body: { table: serializeTable(store, table, appPublicUrl) } };
      },
    },
    {
      method: 'POST',
      path: '/internal/tenants/:tenantId/floor/tables/:code/release',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const code = (ctx.params.code ?? '').toUpperCase();
        const table = tablesOf(store, tenantId).find((entry) => entry.code === code);
        if (!table) throw HttpError.notFound('Place introuvable.');
        const body = asObject(ctx.body);
        const orderId = requireString(body, 'orderId', { max: 64 });
        if (table.orderId !== orderId) {
          throw HttpError.conflict(
            'order_mismatch',
            'Cette place n’est pas liée à la commande indiquée.',
          );
        }
        const to = body.to === 'nettoyage' ? 'nettoyage' : 'libre';
        const from = table.status;
        delete table.orderId;
        delete table.reservationId;
        table.status = to;
        table.updatedAt = nowIso();
        table.updatedBy = 'order-service';
        store.recordAudit({
          tenantId,
          actorId: 'order-service',
          action: 'floor.order.released',
          targetType: 'table',
          targetId: table.id,
          meta: { orderId, from, to },
        });
        void publish(
          'TableStatusChanged',
          tenantId,
          emitStatus(store, table, from, 'order-service'),
        );
        return { body: { table: serializeTable(store, table, appPublicUrl) } };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/floor/tables/:code',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const code = (ctx.params.code ?? '').toUpperCase();
        const table = tablesOf(store, tenantId).find((entry) => entry.code === code);
        if (!table) throw HttpError.notFound('Place introuvable.');
        return {
          body: {
            tenantId,
            table: {
              id: table.id,
              code: table.code,
              status: table.status,
              capacity: effectiveCapacity(store, table),
              orderId: table.orderId ?? null,
              mergedIntoCode: table.mergedIntoId
                ? (store.tables.get(table.mergedIntoId)?.code ?? null)
                : null,
            },
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/internal/tenants/:tenantId/floor/capacity',
      service: true,
      handler: (ctx) => {
        const tenantId = ctx.params.tenantId ?? '';
        const primaries = tablesOf(store, tenantId).filter((table) => !table.mergedIntoId);
        return {
          body: {
            tenantId,
            tables: primaries.length,
            seats: primaries.reduce((sum, table) => sum + effectiveCapacity(store, table), 0),
            zones: zonesOf(store, tenantId).map((zone) => ({
              id: zone.id,
              name: zone.name,
              tables: primaries.filter((table) => table.zoneId === zone.id).length,
              seats: primaries
                .filter((table) => table.zoneId === zone.id)
                .reduce((sum, table) => sum + effectiveCapacity(store, table), 0),
            })),
          },
        };
      },
    },
  ];
}
