import {
  api,
  assert,
  assertEqual,
  assertStatus,
  createEventBus,
  createEventInboxRoute,
  runTests,
  startServer,
  type AuthClaims,
  type TestCase,
} from '@resto-hub/service-kit';
import { buildFloorApp } from '../app.js';
import { createFloorStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';

function claims(sub: string, tenantPermissions: Record<string, string[]>): AuthClaims {
  return {
    sub,
    sid: `ses_${sub}`,
    name: sub,
    mfa: false,
    platformRoles: [],
    platformPermissions: [],
    tenantPermissions,
  };
}

async function main() {
  const store = createFloorStore();
  const bus = createEventBus({ name: 'floor-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };

  const managerA = register(
    'token-manager-a',
    claims('usr_manager_a', { tnt_alpha: ['floor:view', 'floor:manage', 'floor:status', 'audit:view'] }),
  );
  const waiterA = register('token-waiter-a', claims('usr_waiter_a', { tnt_alpha: ['floor:view', 'floor:status'] }));
  const managerB = register(
    'token-manager-b',
    claims('usr_manager_b', { tnt_beta: ['floor:view', 'floor:manage', 'floor:status', 'audit:view'] }),
  );

  const server = await startServer(
    {
      name: 'floor-service-test',
      routes: [
        ...buildFloorApp({
          store,
          appPublicUrl: 'https://app.resto-hub.tg',
          publish: (type, tenantId, payload) => bus.publish(type, tenantId, payload),
        }),
        createEventInboxRoute(bus),
      ],
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const a = '/api/v1/tenants/tnt_alpha/floor';
  const b = '/api/v1/tenants/tnt_beta/floor';

  await api(base, 'PUT', `${a}/settings`, { establishmentCode: 'LOMEA' }, { token: managerA });
  const zoneResult = await api(base, 'POST', `${a}/zones`, { name: 'Salle', kind: 'salle' }, { token: managerA });
  assertStatus(zoneResult, 201, 'Création zone');
  const zoneId: string = zoneResult.body.zone.id;
  const terraceResult = await api(base, 'POST', `${a}/zones`, { name: 'Terrasse', kind: 'terrasse' }, { token: managerA });
  assertStatus(terraceResult, 201, 'Création terrasse');
  const terraceId: string = terraceResult.body.zone.id;

  const createTable = async (token: string, zone: string, capacity: number) => {
    const result = await api(base, 'POST', `${a}/tables`, { zoneId: zone, capacity }, { token });
    assertStatus(result, 201, 'Création place');
    return result.body.table;
  };

  const table1 = await createTable(managerA, zoneId, 4);
  const table2 = await createTable(managerA, zoneId, 2);
  let reservationId = '';
  let reservationToken = '';

  const cases: TestCase[] = [
    {
      name: 'Paramétrage : code établissement validé et format des codes respecté',
      run: async () => {
        const invalid = await api(base, 'PUT', `${b}/settings`, { establishmentCode: 'lo' }, { token: managerB });
        assertStatus(invalid, 422, 'Code établissement trop court refusé');
        assertEqual(table1.code, 'LOMEA-SAL-001', 'Code ETAB-ZONE-NUMÉRO du premier table');
        assertEqual(table2.code, 'LOMEA-SAL-002', 'Numérotation séquentielle');
        const snapshot = await api(base, 'GET', a, undefined, { token: managerA });
        assertStatus(snapshot, 200, 'Snapshot floor');
        assertEqual(snapshot.body.settings.establishmentCode, 'LOMEA', 'Paramétrage visible');
        assertEqual(snapshot.body.summary.byStatus.libre, 2, 'Deux places libres');
      },
    },
    {
      name: 'Unicité : numéro dupliqué dans une zone refusé explicitement, code global unique',
      run: async () => {
        const duplicateNumber = await api(
          base,
          'POST',
          `${a}/tables`,
          { zoneId, number: 2, capacity: 4 },
          { token: managerA },
        );
        assertStatus(duplicateNumber, 409, 'Numéro déjà utilisé refusé');
        assertEqual(duplicateNumber.body.error.code, 'table_number_conflict', 'Code d’erreur explicite');
        const otherZone = await api(base, 'POST', `${a}/tables`, { zoneId: terraceId, number: 2, capacity: 4 }, { token: managerA });
        assertStatus(otherZone, 201, 'Le numéro reste disponible dans une autre zone');
        assertEqual(otherZone.body.table.code, 'LOMEA-TER-002', 'Code zone distinct');
        await api(base, 'PUT', `${b}/settings`, { establishmentCode: 'LOMEA' }, { token: managerB });
        const zoneB = await api(base, 'POST', `${b}/zones`, { name: 'Salle', kind: 'salle' }, { token: managerB });
        const tableB = await api(
          base,
          'POST',
          `${b}/tables`,
          { zoneId: zoneB.body.zone.id, number: 1, capacity: 4 },
          { token: managerB },
        );
        assertStatus(tableB, 201, 'Création équivalente chez Beta');
        assertEqual(tableB.body.table.code, 'LOMEA-SAL-001', 'Même code autorisé dans un autre établissement');
      },
    },
    {
      name: 'Isolation : les plans de salle A et B sont cloisonnés',
      run: async () => {
        const crossRead = await api(base, 'GET', b, undefined, { token: managerA });
        assertStatus(crossRead, 403, 'Alpha ne lit pas le plan de Beta');
        const crossPatch = await api(base, 'PATCH', `${b}/tables/${table1.id}`, { capacity: 10 }, { token: managerB });
        assert(crossPatch.status === 403 || crossPatch.status === 404, 'Place Alpha inaccessible depuis Beta');
        const snapshotB = await api(base, 'GET', b, undefined, { token: managerB });
        assertEqual(snapshotB.body.tables.length, 1, 'Beta ne voit que sa place');
      },
    },
    {
      name: 'RBAC : le serveur change le statut mais ne crée pas de place',
      run: async () => {
        const create = await api(base, 'POST', `${a}/tables`, { zoneId, capacity: 2 }, { token: waiterA });
        assertStatus(create, 403, 'Création refusée au serveur');
        const status = await api(
          base,
          'POST',
          `${a}/tables/${table1.id}/status`,
          { status: 'reservee', reservationId: 'res_demo_9' },
          { token: waiterA },
        );
        assertStatus(status, 200, 'Changement de statut autorisé au serveur');
        assertEqual(status.body.table.status, 'reservee', 'Statut réservée');
        const settings = await api(base, 'PUT', `${a}/settings`, { establishmentCode: 'HACK' }, { token: waiterA });
        assertStatus(settings, 403, 'Paramétrage réservé au manager');
      },
    },
    {
      name: 'Statuts : transitions contrôlées et événement TableStatusChanged',
      run: async () => {
        const invalid = await api(base, 'POST', `${a}/tables/${table1.id}/status`, { status: 'nettoyage' }, { token: managerA });
        assertStatus(invalid, 409, 'réservée → à nettoyer interdite');
        const seated = await api(
          base,
          'POST',
          `${a}/tables/${table1.id}/status`,
          { status: 'occupee', orderId: 'ord_alpha_1' },
          { token: managerA },
        );
        assertStatus(seated, 200, 'Installation des clients');
        assertEqual(seated.body.table.orderId, 'ord_alpha_1', 'Commande associée');
        const events = bus.outbox().filter((event) => event.type === 'TableStatusChanged');
        const last = events[events.length - 1];
        assertEqual(last.payload.from, 'reservee', 'Ancien statut dans l’événement');
        assertEqual(last.payload.to, 'occupee', 'Nouveau statut dans l’événement');
        assertEqual(last.payload.code, 'LOMEA-SAL-001', 'Code de table dans l’événement');
        const same = await api(base, 'POST', `${a}/tables/${table1.id}/status`, { status: 'occupee' }, { token: managerA });
        assertStatus(same, 422, 'Statut inchangé refusé');
        const bill = await api(base, 'POST', `${a}/tables/${table1.id}/status`, { status: 'addition' }, { token: managerA });
        assertStatus(bill, 200, 'Addition demandée');
        const cleaning = await api(base, 'POST', `${a}/tables/${table1.id}/status`, { status: 'nettoyage' }, { token: managerA });
        assertStatus(cleaning, 200, 'Table à nettoyer');
        const freed = await api(base, 'POST', `${a}/tables/${table1.id}/status`, { status: 'libre' }, { token: managerA });
        assertStatus(freed, 200, 'Table libérée');
        assertEqual(freed.body.table.orderId ?? null, null, 'Commande effacée à la libération');
      },
    },
    {
      name: 'Fusion / division : même zone, statuts bloqués sur les places fusionnées',
      run: async () => {
        const table3 = await createTable(managerA, zoneId, 4);
        const table4 = await createTable(managerA, zoneId, 4);
        const merged = await api(
          base,
          'POST',
          `${a}/tables/merge`,
          { tableIds: [table3.id, table4.id] },
          { token: managerA },
        );
        assertStatus(merged, 200, 'Fusion de deux places');
        assertEqual(merged.body.primary.mergedIds.length, 1, 'Une place secondaire fusionnée');
        assertEqual(merged.body.primary.effectiveCapacity, 8, 'Capacité cumulée');
        const onSecondary = await api(
          base,
          'POST',
          `${a}/tables/${table4.id}/status`,
          { status: 'reservee' },
          { token: managerA },
        );
        assertStatus(onSecondary, 409, 'Statut refusé sur une place fusionnée');
        const crossZone = await api(
          base,
          'POST',
          `${a}/tables/merge`,
          { tableIds: [table3.id, (await api(base, 'GET', a, undefined, { token: managerA })).body.tables.find((t: { zoneId: string }) => t.zoneId === terraceId).id] },
          { token: managerA },
        );
        assertStatus(crossZone, 422, 'Fusion inter-zones refusée');
        const split = await api(base, 'POST', `${a}/tables/${table3.id}/split`, {}, { token: managerA });
        assertStatus(split, 200, 'Division de la table');
        assertEqual(split.body.primary.mergedIds.length, 0, 'Plus aucune fusion');
        assert(bus.outbox().some((event) => event.type === 'FloorTablesMerged'), 'Événement de fusion émis');
        assert(bus.outbox().some((event) => event.type === 'FloorTablesSplit'), 'Événement de division émis');
      },
    },
    {
      name: 'Transfert : la commande change de place, la source passe à nettoyer',
      run: async () => {
        const table5 = await createTable(managerA, zoneId, 2);
        const table6 = await createTable(managerA, zoneId, 2);
        await api(
          base,
          'POST',
          `${a}/tables/${table5.id}/status`,
          { status: 'occupee', orderId: 'ord_transfer_1' },
          { token: managerA },
        );
        const transfer = await api(
          base,
          'POST',
          `${a}/tables/${table5.id}/transfer`,
          { toTableId: table6.id },
          { token: managerA },
        );
        assertStatus(transfer, 200, 'Transfert de commande');
        assertEqual(transfer.body.target.orderId, 'ord_transfer_1', 'Commande sur la cible');
        assertEqual(transfer.body.target.status, 'occupee', 'Cible occupée');
        assertEqual(transfer.body.source.status, 'nettoyage', 'Source à nettoyer');
        assertEqual(transfer.body.source.orderId ?? null, null, 'Source libérée de la commande');
        const event = bus.outbox().find((entry) => entry.type === 'FloorOrderTransferred');
        assert(event, 'Événement FloorOrderTransferred publié');
        assertEqual(event.payload.toCode, table6.code, 'Code cible dans l’événement');
        const busy = await api(
          base,
          'POST',
          `${a}/tables/${table5.id}/transfer`,
          { toTableId: table6.id },
          { token: managerA },
        );
        assertStatus(busy, 409, 'Aucune commande active à retransférer');
      },
    },
    {
      name: 'QR : SVG, PNG et planche PDF en lot accessibles au manager',
      run: async () => {
        const svgResponse = await fetch(`${base}${a}/tables/${table1.id}/qr`, {
          headers: { authorization: `Bearer ${managerA}` },
        });
        assertEqual(svgResponse.status, 200, 'QR SVG servi');
        assert((svgResponse.headers.get('content-type') ?? '').includes('image/svg+xml'), 'Type SVG');
        const svg = await svgResponse.text();
        assert(svg.includes('<svg'), 'Contenu SVG');
        assert(svg.includes('LOMEA-SAL-001') || svg.length > 200, 'QR généré');
        const pngResponse = await fetch(`${base}${a}/tables/${table1.id}/qr?format=png`, {
          headers: { authorization: `Bearer ${managerA}` },
        });
        assertEqual(pngResponse.status, 200, 'QR PNG servi');
        const pngBytes = Buffer.from(await pngResponse.arrayBuffer());
        assertEqual(pngBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Signature PNG');
        const pdfResponse = await fetch(`${base}${a}/qr-sheet.pdf`, {
          headers: { authorization: `Bearer ${managerA}` },
        });
        assertEqual(pdfResponse.status, 200, 'Planche PDF servie');
        assert((pdfResponse.headers.get('content-type') ?? '').includes('application/pdf'), 'Type PDF');
        const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
        assertEqual(pdfBytes.subarray(0, 5).toString('utf8'), '%PDF-', 'Signature PDF');
        assert(pdfBytes.length > 2_000, 'PDF non vide');
        const anonymous = await fetch(`${base}${a}/qr-sheet.pdf`);
        assertEqual(anonymous.status, 401, 'Planche QR protégée');
        const crossPdf = await fetch(`${base}${a}/qr-sheet.pdf`, {
          headers: { authorization: `Bearer ${managerB}` },
        });
        assertEqual(crossPdf.status, 403, 'Planche QR cloisonnée');
      },
    },
    {
      name: 'Occupation en direct : agrégats cohérents et lookup public sécurisé',
      run: async () => {
        const occupancy = await api(base, 'GET', `${a}/occupancy`, undefined, { token: managerA });
        assertStatus(occupancy, 200, 'Tableau de bord d’occupation');
        assert(occupancy.body.summary.tables >= 6, 'Toutes les places comptées');
        assert(occupancy.body.summary.occupancyRate > 0, 'Taux d’occupation non nul');
        assert(occupancy.body.zones.length === 2, 'Agrégats par zone');
        const publicLookup = await api(base, 'GET', '/api/v1/public/tenants/tnt_alpha/tables/LOMEA-SAL-002');
        assertStatus(publicLookup, 200, 'Scan public de la place');
        assertEqual(publicLookup.body.table.code, 'LOMEA-SAL-002', 'Code public');
        const unknown = await api(base, 'GET', '/api/v1/public/tenants/tnt_alpha/tables/INCONNU-000');
        assertStatus(unknown, 404, 'Code inconnu refusé');
        const internal = await api(base, 'GET', '/internal/tenants/tnt_alpha/floor/tables/LOMEA-SAL-002', undefined, {
          internalKey: INTERNAL_KEY,
        });
        assertStatus(internal, 200, 'Lecture interne pour order-service');
        const forbidden = await api(base, 'GET', '/internal/tenants/tnt_alpha/floor/tables/LOMEA-SAL-002');
        assertStatus(forbidden, 401, 'Lecture interne protégée');
      },
    },
    {
      name: 'Renommage de zone : les codes des places sont recalculés sans collision',
      run: async () => {
        const rename = await api(base, 'PATCH', `${a}/zones/${zoneId}`, { code: 'SAL2' }, { token: managerA });
        assertStatus(rename, 200, 'Renommage du code de zone');
        const snapshot = await api(base, 'GET', a, undefined, { token: managerA });
        const codes = snapshot.body.tables.map((table: { code: string }) => table.code);
        assert(codes.includes('LOMEA-SAL2-001'), 'Code recalculé avec la nouvelle zone');
        assertEqual(new Set(codes).size, codes.length, 'Aucun doublon de code');
      },
    },
    {
      name: 'Réservations publiques : créneaux, confirmation, conflits et validation des dates',
      run: async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const availability = await api(
          base,
          'GET',
          `/api/v1/public/tenants/tnt_alpha/reservations/availability?date=${tomorrow}&partySize=4`,
        );
        assertStatus(availability, 200, 'Disponibilités publiques');
        assertEqual(availability.body.slots.length, 24, 'Créneaux de 11:00 à 22:30');
        const evening = availability.body.slots.find((slot: { time: string }) => slot.time === '20:00');
        assertEqual(evening.available, true, 'Créneau du soir disponible');
        assert(availability.body.tables.length >= 1, 'Tables proposées');

        const created = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/reservations', {
          date: tomorrow,
          time: '20:00',
          partySize: 4,
          customerName: 'Akouvi Kossi',
          customerPhone: '+22890112233',
          note: 'Anniversaire',
        });
        assertStatus(created, 201, 'Réservation publique confirmée');
        const reservation = created.body.reservation;
        assertEqual(reservation.status, 'confirmee', 'Confirmation immédiate');
        assert(String(reservation.reference).startsWith('RES-'), 'Référence lisible');
        assert(reservation.tableCode, 'Table attribuée automatiquement');
        reservationId = reservation.id;
        reservationToken = created.body.publicToken;

        const forbidden = await api(base, 'GET', `/api/v1/public/tenants/tnt_alpha/reservations/${reservationId}?k=mauvais`);
        assertStatus(forbidden, 403, 'Jeton de réservation exigé');
        const tracked = await api(
          base,
          'GET',
          `/api/v1/public/tenants/tnt_alpha/reservations/${reservationId}?k=${reservationToken}`,
        );
        assertStatus(tracked, 200, 'Suivi de réservation');
        assertEqual(tracked.body.reservation.status, 'confirmee', 'Statut suivi');
        assert(!JSON.stringify(tracked.body).includes('+22890112233'), 'Téléphone absent de la vue publique');

        const conflict = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/reservations', {
          date: tomorrow,
          time: '20:30',
          partySize: 4,
          customerName: 'Autre Client',
          customerPhone: '+22890223344',
          tableId: reservation.tableId,
        });
        assertStatus(conflict, 409, 'Conflit de créneau sur la même table');

        const past = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/reservations', {
          date: '2020-01-01',
          time: '20:00',
          partySize: 2,
          customerName: 'Voyageur',
          customerPhone: '+22890334455',
        });
        assertStatus(past, 422, 'Date passée refusée');
        const early = await api(base, 'POST', '/api/v1/public/tenants/tnt_alpha/reservations', {
          date: tomorrow,
          time: '09:00',
          partySize: 2,
          customerName: 'Matinal',
          customerPhone: '+22890445566',
        });
        assertStatus(early, 422, 'Heure hors service refusée');
      },
    },
    {
      name: 'Réservations salle : gestion cloisonnée, installation, libération de table et événements',
      run: async () => {
        const list = await api(base, 'GET', `/api/v1/tenants/tnt_alpha/reservations`, undefined, { token: managerA });
        assertStatus(list, 200, 'Liste des réservations');
        assert(list.body.items.some((item: { id: string }) => item.id === reservationId), 'Réservation publique visible');
        const crossList = await api(base, 'GET', '/api/v1/tenants/tnt_alpha/reservations', undefined, {
          token: managerB,
        });
        assertStatus(crossList, 403, 'Réservations Alpha invisibles à Beta');

        const today = new Date().toISOString().slice(0, 10);
        const seated = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/reservations/${reservationId}/status`,
          { status: 'installee' },
          { token: waiterA },
        );
        assertStatus(seated, 200, 'Installation par le serveur');
        assertEqual(seated.body.reservation.status, 'installee', 'Statut installée');

        const publicCancel = await api(
          base,
          'POST',
          `/api/v1/public/tenants/tnt_alpha/reservations/${reservationId}/cancel`,
          { k: reservationToken },
        );
        assertStatus(publicCancel, 409, 'Annulation en ligne impossible une fois installée');

        const manual = await api(
          base,
          'POST',
          '/api/v1/tenants/tnt_alpha/reservations',
          {
            date: today,
            time: '21:00',
            partySize: 2,
            customerName: 'Client Salle',
            customerPhone: '+22890556677',
          },
          { token: managerA },
        );
        assertStatus(manual, 201, 'Réservation créée en salle');
        const manualId = manual.body.reservation.id as string;
        assertEqual(manual.body.reservation.source, 'staff', 'Source salle');
        const held = await api(base, 'GET', a, undefined, { token: managerA });
        const heldTable = held.body.tables.find((table: { reservationId?: string }) => table.reservationId === manualId);
        assertEqual(heldTable?.status, 'reservee', 'Table du jour marquée réservée');

        const noShow = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/reservations/${manualId}/status`,
          { status: 'no_show', reason: 'Client non présent' },
          { token: managerA },
        );
        assertStatus(noShow, 200, 'Marquage client absent');
        assertEqual(noShow.body.reservation.status, 'no_show', 'Statut absent');
        const released = await api(base, 'GET', a, undefined, { token: managerA });
        const releasedTable = released.body.tables.find((table: { id: string }) => table.id === heldTable.id);
        assertEqual(releasedTable?.status, 'libre', 'Table libérée après absence');

        const twice = await api(
          base,
          'POST',
          `/api/v1/tenants/tnt_alpha/reservations/${manualId}/status`,
          { status: 'installee' },
          { token: managerA },
        );
        assertStatus(twice, 409, 'Transition absente → installée refusée');

        const events = bus.outbox();
        assert(events.filter((event) => event.type === 'ReservationCreated').length >= 2, 'Événements ReservationCreated');
        assert(
          events.some(
            (event) => event.type === 'ReservationStatusChanged' && event.payload.to === 'installee',
          ),
          'Événement d’installation publié',
        );
        const audit = await api(base, 'GET', `${a}/audit`, undefined, { token: managerA });
        assertEqual(audit.body.integrity, true, 'Audit intègre avec réservations');
        assert(
          audit.body.entries.some((entry: { action: string }) => entry.action === 'floor.reservation.created'),
          'Création de réservation auditée',
        );
      },
    },
    {
      name: 'Audit immuable : fusions, transferts et statuts tracés, chaîne intègre',
      run: async () => {
        const audit = await api(base, 'GET', `${a}/audit`, undefined, { token: managerA });
        assertStatus(audit, 200, 'Journal d’audit');
        assertEqual(audit.body.integrity, true, 'Chaîne d’audit intègre');
        const actions = audit.body.entries.map((entry: { action: string }) => entry.action);
        assert(actions.includes('floor.tables.merged'), 'Fusion auditée');
        assert(actions.includes('floor.tables.split'), 'Division auditée');
        assert(actions.includes('floor.order.transferred'), 'Transfert audité');
        assert(actions.includes('floor.table.status_changed'), 'Changement de statut audité');
        const crossAudit = await api(base, 'GET', `${b}/audit`, undefined, { token: managerA });
        assertStatus(crossAudit, 403, 'Audit de Beta inaccessible à Alpha');
      },
    },
  ];

  await runTests('FLOOR-SERVICE — plan de salle, statuts temps réel, QR et isolation', cases);
  await server.close();
}

await main();
