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
import { buildReportingApp, handleReportingEvent, type OrderSnapshot } from '../app.js';
import { createReportingStore, seedReportingDemo, type ReportingStore } from '../store.js';

const INTERNAL_KEY = 'test-internal-key';
const SAHEL = 'tnt_sahelgrill';
const BAOBAB = 'tnt_baobab';

function claims(sub: string, name: string, tenantPermissions: Record<string, string[]> = {}): AuthClaims {
  return { sub, sid: `ses_${sub}`, name, mfa: true, platformRoles: [], platformPermissions: [], tenantPermissions };
}

function dayShift(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const store: ReportingStore = createReportingStore();
  seedReportingDemo(store);
  const bus = createEventBus({ name: 'reporting-test', internalKey: INTERNAL_KEY, subscribers: [] });
  const published: string[] = [];
  const publish = async (type: string, tenantId: string | null, payload: Record<string, unknown>) => {
    published.push(type);
    return bus.publish(type, tenantId, payload);
  };

  const orders = new Map<string, OrderSnapshot>();
  const today = new Date().toISOString();
  orders.set('ord_new_1', {
    order: {
      id: 'ord_new_1',
      number: 'CMD-2026-000099',
      tenantId: SAHEL,
      status: 'payee',
      channel: 'dine_in',
      tableCode: 'T7',
      guests: 4,
      paymentStatus: 'payee',
      subtotalXof: 6500,
      taxXof: 1170,
      taxRate: 0.18,
      totalXof: 7670,
      invoiceNumber: 'FA-2026-000099',
      createdAt: today,
      paidAt: today,
      lines: [
        { id: 'l1', productId: 'prd_sg_poulet', productName: 'Poulet braisé', variantName: null, station: 'cuisine', quantity: 1, unitPriceXof: 4500, lineTotalXof: 4500 },
        { id: 'l2', productId: 'prd_sg_bissap', productName: 'Bissap maison', variantName: null, station: 'bar', quantity: 1, unitPriceXof: 2000, lineTotalXof: 2000 },
      ],
    },
  });

  const identities = new Map<string, AuthClaims>();
  const register = (token: string, authClaims: AuthClaims) => {
    identities.set(token, authClaims);
    return token;
  };
  const owner = register('token-owner', claims('usr_gerant_sahel', 'Gérant Sahel', {
    [SAHEL]: ['report:view', 'report:export'],
  }));
  const accountant = register('token-accountant', claims('usr_comptable_sahel', 'Comptable', {
    [SAHEL]: ['report:view'],
  }));
  const waiter = register('token-waiter', claims('usr_serveur', 'Serveur', {
    [SAHEL]: ['order:view'],
  }));
  const ownerBaobab = register('token-baobab', claims('usr_baobab', 'Gérant Baobab', {
    [BAOBAB]: ['report:view', 'report:export'],
  }));

  const options = {
    store,
    publish,
    readOrder: async (tenantId: string, orderId: string) =>
      tenantId === SAHEL ? orders.get(orderId) ?? null : null,
    cogs: async () => 900000,
    capacity: async () => ({ seats: 78, tables: 14 }),
  };

  const server = await startServer(
    {
      name: 'reporting-service-test',
      routes: buildReportingApp(options),
      authenticate: async (token) => identities.get(token),
      internalKey: INTERNAL_KEY,
    },
    0,
  );
  const base = server.url;
  const R = `/api/v1/tenants/${SAHEL}/reports`;
  const width30 = `from=${dayShift(29)}&to=${dayShift(0)}`;

  const cases: TestCase[] = [
    {
      name: 'Tableau de bord : CA, panier moyen, marges, occupation et mix',
      run: async () => {
        const result = await api(base, 'GET', `${R}/dashboard?${width30}`, undefined, { token: owner });
        assertStatus(result, 200, 'Tableau de bord accessible');
        const view = result.body.dashboard;
        assert(view.revenueXof > 500000, 'CA significatif sur 30 jours');
        assert(view.orders > 50, 'Commandes nombreuses');
        assert(view.averageTicketXof > 3000 && view.averageTicketXof < 40000, 'Panier moyen plausible');
        assert(view.netRevenueXof < view.revenueXof, 'CA net inférieur au CA brut');
        assertEqual(view.cogsXof, 900000, 'Coût fourni par le service stock');
        assert(view.grossMarginXof !== null && view.grossMarginXof > 0, 'Marge brute calculée');
        assert(view.marginRatePct !== null && view.marginRatePct > 20, 'Taux de marge significatif');
        const shares = view.paymentMix.reduce((total: number, entry: { sharePct: number }) => total + entry.sharePct, 0);
        assert(Math.abs(shares - 100) <= 0.5, 'Répartition des paiements cohérente');
        assertEqual(view.topProducts.length, 6, 'Six produits vendus');
        assert(view.topProducts[0].revenueXof >= view.topProducts[1].revenueXof, 'Classement par CA');
        assertEqual(view.peakHours.length, 24, '24 tranches horaires');
        assert(view.occupancy.ratePct > 5 && view.occupancy.ratePct < 100, 'Taux d’occupation plausible');
        assert(view.reservations.count > 0, 'Réservations prises en compte');
        assert(view.reviews.average >= 4 && view.reviews.average <= 5, 'Note moyenne des avis');
        assert(view.stock.latestValueXof > 0, 'Dernière valorisation du stock');
        assert(view.payroll.runs >= 1, 'Paie versée sur la période');
        assertEqual(view.currency, 'XOF', 'Devise XOF');
        assertEqual(result.body.sites.length, 2, 'Deux sites');
      },
    },
    {
      name: 'Filtres période et site, validation des paramètres',
      run: async () => {
        const plateau = await api(base, 'GET', `${R}/dashboard?${width30}&siteId=ste_plateau`, undefined, {
          token: owner,
        });
        const lagune = await api(base, 'GET', `${R}/dashboard?${width30}&siteId=ste_lagune`, undefined, {
          token: owner,
        });
        assert(lagune.body.dashboard.revenueXof < plateau.body.dashboard.revenueXof, 'Site secondaire plus petit');
        assert(lagune.body.dashboard.orders > 0, 'Site secondaire actif');

        const week = await api(base, 'GET', `${R}/dashboard?from=${dayShift(6)}&to=${dayShift(0)}`, undefined, {
          token: owner,
        });
        const month = await api(base, 'GET', `${R}/dashboard?${width30}`, undefined, { token: owner });
        assert(week.body.dashboard.revenueXof < month.body.dashboard.revenueXof, 'Période courte inférieure');

        const unknownSite = await api(base, 'GET', `${R}/dashboard?siteId=ste_nowhere`, undefined, { token: owner });
        assertStatus(unknownSite, 422, 'Site inconnu refusé');
        const inverted = await api(base, 'GET', `${R}/dashboard?from=2026-11-20&to=2026-11-01`, undefined, {
          token: owner,
        });
        assertStatus(inverted, 422, 'Période inversée refusée');
        const badDate = await api(base, 'GET', `${R}/dashboard?from=2026-13-01`, undefined, { token: owner });
        assertStatus(badDate, 422, 'Format de date refusé');
      },
    },
    {
      name: 'Rapport des ventes : journalier, mensuel et totaux',
      run: async () => {
        const daily = await api(base, 'GET', `${R}/sales?from=${dayShift(6)}&to=${dayShift(0)}`, undefined, {
          token: owner,
        });
        assertStatus(daily, 200, 'Ventes journalières');
        assertEqual(daily.body.rows.length, 7, 'Sept journées');
        const rowOrders = daily.body.rows.reduce((total: number, row: Array<string | number>) => total + Number(row[1]), 0);
        assertEqual(rowOrders, daily.body.totals.orders, 'Total des commandes cohérent');
        assertEqual(daily.body.columns[2], 'CA (XOF)', 'Colonne CA');

        const monthly = await api(base, 'GET', `${R}/sales?group=month&${width30}`, undefined, { token: owner });
        assert(monthly.body.rows.length >= 1, 'Groupement mensuel');
        assertEqual(monthly.body.group, 'month', 'Groupe mensuel');

        const series = await api(base, 'GET', `${R}/timeseries?${width30}`, undefined, { token: owner });
        assertEqual(series.body.granularity, 'day', 'Granularité journalière');
        assert(series.body.points.length >= 25, 'Série complète');
        assert(series.body.points.every((point: { revenueXof: number }) => point.revenueXof >= 0), 'Valeurs positives');
      },
    },
    {
      name: 'Heures de pointe, produits et occupation',
      run: async () => {
        const products = await api(base, 'GET', `${R}/products?${width30}`, undefined, { token: owner });
        assertStatus(products, 200, 'Classement produits');
        const totalShare = products.body.items.reduce((total: number, item: { sharePct: number }) => total + item.sharePct, 0);
        assert(Math.abs(totalShare - 100) <= 0.6, 'Parts cumulées à 100 %');
        assert(products.body.items[0].quantity > 0, 'Quantités vendues');

        const peak = await api(base, 'GET', `${R}/peak-hours?${width30}`, undefined, { token: owner });
        assertEqual(peak.body.buckets.length, 24, '24 heures');
        assert(peak.body.peak.length > 0, 'Créneaux de pointe identifiés');
        if (peak.body.peak.length > 1) {
          assert(peak.body.peak[0].orders >= peak.body.peak[1].orders, 'Pointe triée');
        }

        const occupancy = await api(base, 'GET', `${R}/occupancy?${width30}`, undefined, { token: owner });
        assert(occupancy.body.items.length > 0, 'Historique d’occupation');
        assert(occupancy.body.items[0].ratePct >= 0, 'Taux calculé par jour');
        const live = await api(base, 'GET', `${R}/occupancy/live`, undefined, { token: owner });
        assertEqual(live.body.seats, 78, 'Capacité du plan de salle');
        assertEqual(live.body.tables, 14, 'Nombre de tables');
      },
    },
    {
      name: 'TVA, paie, stock et avis',
      run: async () => {
        const taxes = await api(base, 'GET', `${R}/taxes?${width30}`, undefined, { token: owner });
        assertEqual(taxes.body.ratePct, 18, 'Taux de TVA togolais');
        assert(taxes.body.totals.taxXof > 0, 'TVA collectée');
        assert(taxes.body.totals.taxableBaseXof > taxes.body.totals.taxXof, 'Base imposable supérieure');

        const payroll = await api(base, 'GET', `${R}/payroll?from=2026-09-01&to=2026-11-30`, undefined, {
          token: owner,
        });
        assertEqual(payroll.body.items.length, 2, 'Deux paies historiques');
        assertEqual(payroll.body.totals.totalXof, 2570000, 'Masse salariale cumulée');

        const stock = await api(base, 'GET', `${R}/stock?${width30}`, undefined, { token: owner });
        assert(stock.body.items.length >= 4, 'Valorisations hebdomadaires');
        assert(stock.body.latest.stockValueXof > 0, 'Dernière valeur de stock');
        assert(stock.body.totals.wasteXof > 0, 'Pertes cumulées');

        const reviews = await api(base, 'GET', `${R}/reviews?${width30}`, undefined, { token: owner });
        const summary = reviews.body.summary;
        assert(summary.count >= 5, 'Avis publiés');
        assertEqual(Object.keys(summary.distribution).length, 5, 'Distribution 1 à 5');
        assert(summary.average >= 4, 'Bonne moyenne');
      },
    },
    {
      name: 'Exports CSV, Excel et PDF avec permission dédiée',
      run: async () => {
        const csvResponse = await fetch(`${base}${R}/export?report=dashboard&format=csv&${width30}`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        assertEqual(csvResponse.status, 200, 'Export CSV');
        const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
        assertEqual(csvBytes.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM UTF-8 pour Excel');
        const csvText = csvBytes.toString('utf8');
        assert(csvText.includes('Indicateur;Valeur'), 'En-tête CSV séparé par point-virgule');
        assert(csvText.includes('Chiffre d’affaires'), 'Indicateurs présents');

        const xlsx = await fetch(`${base}${R}/export?report=products&format=xlsx&${width30}`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        assertEqual(xlsx.status, 200, 'Export XLSX');
        assert(xlsx.headers.get('content-type')?.includes('spreadsheetml') ?? false, 'Type MIME Excel');
        assert(xlsx.headers.get('content-disposition')?.includes('.xlsx') ?? false, 'Nom de fichier Excel');
        const xlsxBytes = Buffer.from(await xlsx.arrayBuffer());
        assertEqual(xlsxBytes.subarray(0, 2).toString('utf8'), 'PK', 'Archive ZIP valide');
        assert(xlsxBytes.length > 1500, 'Classeur non vide');

        const pdf = await fetch(`${base}${R}/export?report=sales&format=pdf&${width30}`, {
          headers: { authorization: `Bearer ${owner}` },
        });
        assertEqual(pdf.status, 200, 'Export PDF');
        const pdfBytes = Buffer.from(await pdf.arrayBuffer());
        assertEqual(pdfBytes.subarray(0, 4).toString('utf8'), '%PDF', 'Signature PDF');
        assert(pdfBytes.length > 1200, 'Document PDF non vide');

        const denied = await api(base, 'GET', `${R}/export?report=sales&format=csv`, undefined, {
          token: accountant,
        });
        assertStatus(denied, 403, 'Export interdit sans permission');
        const viewOnly = await api(base, 'GET', `${R}/dashboard?${width30}`, undefined, { token: accountant });
        assertStatus(viewOnly, 200, 'Lecture autorisée au comptable');

        const badFormat = await api(base, 'GET', `${R}/export?report=sales&format=xls`, undefined, { token: owner });
        assertStatus(badFormat, 422, 'Format inconnu refusé');
        const badReport = await api(base, 'GET', `${R}/export?report=magique&format=csv`, undefined, {
          token: owner,
        });
        assertStatus(badReport, 422, 'Rapport inconnu refusé');
        assert(published.includes('ReportExported'), 'Événement d’export publié');
      },
    },
    {
      name: 'Événements : ventes, remboursements, échecs, paie et avis',
      run: async () => {
        const todayRange = `from=${dayShift(0)}&to=${dayShift(0)}`;
        const before = await api(base, "GET", `${R}/dashboard?${todayRange}&siteId=ste_plateau`, undefined, { token: owner });
        await handleReportingEvent(options, SAHEL, {
          type: 'OrderPaid',
          payload: { tenantId: SAHEL, orderId: 'ord_new_1', method: 'tmoney', totalXof: 7670, at: today },
        });
        await handleReportingEvent(options, SAHEL, {
          type: 'OrderPaid',
          payload: { tenantId: SAHEL, orderId: 'ord_new_1', method: 'tmoney', totalXof: 7670, at: today },
        });
        const after = await api(base, 'GET', `${R}/dashboard?${todayRange}&siteId=ste_plateau`, undefined, {
          token: owner,
        });
        const plateauBefore = store.sales.size;
        assertEqual(after.body.dashboard.orders, (before.body.dashboard.orders ?? 0) + 1, 'Une vente ajoutée, rejeu ignoré');
        assert(
          [...store.sales.values()].some(
            (sale) => sale.orderId === 'ord_new_1' && sale.lines.length === 2 && sale.tableCode === 'T7',
          ),
          'Lignes et table importées depuis les commandes',
        );

        await handleReportingEvent(options, SAHEL, {
          type: 'OrderPaid',
          payload: { tenantId: SAHEL, orderId: 'ord_missing', number: 'CMD-X', totalXof: 12000, at: today, method: 'especes' },
        });
        const fallback = [...store.sales.values()].find((sale) => sale.orderId === 'ord_missing');
        assert(fallback !== undefined && fallback.totalXof === 12000, 'Vente reconstituée depuis l’événement');
        assertEqual(store.sales.size, plateauBefore + 1, 'Deux ventes ajoutées au total');

        await handleReportingEvent(options, SAHEL, {
          type: 'RefundIssued',
          payload: { tenantId: SAHEL, refundId: 'rfd_evt_1', orderId: 'ord_new_1', amountXof: 1000, at: today },
        });
        await handleReportingEvent(options, SAHEL, {
          type: 'RefundIssued',
          payload: { tenantId: SAHEL, refundId: 'rfd_evt_1', orderId: 'ord_new_1', amountXof: 1000, at: today },
        });
        assertEqual(
          [...store.refunds.values()].filter((refund) => refund.refundId === 'rfd_evt_1').length,
          1,
          'Remboursement dédupliqué',
        );

        await handleReportingEvent(options, SAHEL, {
          type: 'PaymentFailed',
          payload: { tenantId: SAHEL, transactionId: 'txn_evt_1', orderId: 'ord_new_1', amountXof: 7670, reason: 'solde insuffisant', at: today },
        });
        const risks = await api(base, 'GET', `${R}/dashboard?${todayRange}`, undefined, { token: owner });
        assert(risks.body.dashboard.failedPayments >= 1, 'Échec de paiement compté');

        await handleReportingEvent(options, SAHEL, {
          type: 'ReservationCreated',
          payload: { tenantId: SAHEL, reservationId: 'res_evt_1', date: dayShift(0), partySize: 5, at: today },
        });
        const withReservation = await api(base, 'GET', `${R}/dashboard?${todayRange}`, undefined, { token: owner });
        assert(withReservation.body.dashboard.reservations.count >= 1, 'Réservation intégrée');

        await handleReportingEvent(options, SAHEL, {
          type: 'PayrollPaid',
          payload: { tenantId: SAHEL, runId: 'run_evt_1', period: '2026-11', headcount: 9, totalXof: 999000, at: today },
        });
        const payroll = await api(base, 'GET', `${R}/payroll?from=2026-11-01&to=2026-11-30`, undefined, {
          token: owner,
        });
        assert(
          payroll.body.items.some((item: { runId: string; totalXof: number }) => item.runId === 'run_evt_1' && item.totalXof === 999000),
          'Paie événementielle enregistrée',
        );

        await handleReportingEvent(options, SAHEL, {
          type: 'ReviewSubmitted',
          payload: { tenantId: SAHEL, reviewId: 'rev_evt_1', rating: 2, at: today },
        });
        const pending = await api(base, 'GET', `${R}/reviews?${todayRange}`, undefined, { token: owner });
        assert(pending.body.summary.pending >= 1, 'Avis en attente de modération');
        const countBefore = pending.body.summary.count;
        await handleReportingEvent(options, SAHEL, {
          type: 'ReviewModerated',
          payload: { tenantId: SAHEL, reviewId: 'rev_evt_1', rating: 2, status: 'approved', at: today },
        });
        const approved = await api(base, 'GET', `${R}/reviews?${todayRange}`, undefined, { token: owner });
        assertEqual(approved.body.summary.count, countBefore + 1, 'Avis approuvé intégré');
        assert(approved.body.summary.average < 4.5, 'Note basse prise en compte');

        await handleReportingEvent(options, SAHEL, {
          type: 'ReviewModerated',
          payload: { tenantId: SAHEL, reviewId: 'rev_evt_1', status: 'rejected', at: today },
        });
        const rejected = await api(base, 'GET', `${R}/reviews?${todayRange}`, undefined, { token: owner });
        assertEqual(rejected.body.summary.count, countBefore, 'Avis rejeté retiré des statistiques');
      },
    },
    {
      name: 'Isolation, RBAC et synthèse interne',
      run: async () => {
        const foreign = await api(base, 'GET', `${R}/dashboard`, undefined, { token: ownerBaobab });
        assertStatus(foreign, 403, 'Établissement croisé refusé');
        const foreignSites = await api(base, 'GET', `${R}/sites`, undefined, { token: ownerBaobab });
        assertStatus(foreignSites, 403, 'Sites croisés refusés');
        const foreignExport = await api(base, 'GET', `${R}/export?report=sales&format=csv`, undefined, {
          token: ownerBaobab,
        });
        assertStatus(foreignExport, 403, 'Export croisé refusé');

        const waiterDenied = await api(base, 'GET', `${R}/dashboard`, undefined, { token: waiter });
        assertStatus(waiterDenied, 403, 'Rôle sans permission refusé');

        const sites = await api(base, 'GET', `${R}/sites`, undefined, { token: owner });
        assertEqual(sites.body.items.length, 2, 'Sites de l’établissement uniquement');
        assert(
          [...store.sales.values()].every((sale) => sale.tenantId === SAHEL),
          'Aucune vente inter-établissement en base',
        );

        const internalDenied = await api(base, 'GET', `/internal/tenants/${SAHEL}/reports/summary`);
        assertStatus(internalDenied, 401, 'Clé interne exigée');
        const internal = await api(base, 'GET', `/internal/tenants/${SAHEL}/reports/summary`, undefined, {
          internalKey: INTERNAL_KEY,
        });
        assertStatus(internal, 200, 'Synthèse interne');
        assert(internal.body.revenueXof > 0, 'CA exposé à la plateforme');
        assertEqual(internal.body.sites, 2, 'Nombre de sites');

        const audit = await api(base, 'GET', `${R}/audit`, undefined, { token: owner });
        assertEqual(audit.body.integrity, true, 'Chaîne d’audit intègre');
        const actions = audit.body.items.map((entry: { action: string }) => entry.action);
        assert(actions.includes('report.exported'), 'Exports audités');
        assert(
          audit.body.items.every(
            (entry: { tenantId: string | null }) => entry.tenantId === SAHEL || entry.tenantId === null,
          ),
          'Audit cloisonné par établissement',
        );
      },
    },
  ];

  await runTests('REPORTING-SERVICE — indicateurs, rapports, filtres et exports', cases);
  await server.close();
}

await main();
