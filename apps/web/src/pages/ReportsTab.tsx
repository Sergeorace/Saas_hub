import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  SkeletonText,
  StatCard,
  cx,
  formatDate,
  formatXof,
  formatXofCompact,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  reportApi,
  type ProductRankRow,
  type ReportAuditEntry,
  type ReportDashboard,
  type ReportFormat,
  type ReportGranularity,
  type ReportName,
  type ReportSite,
  type ReportTimeseriesPoint,
  type ReviewStatus,
  type SalesReport,
} from '../lib/api';

type Section = 'dashboard' | 'sales' | 'products' | 'occupancy' | 'finance' | 'reviews' | 'audit';

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

interface OccupancyRow {
  id: string;
  date: string;
  seatsCapacity: number;
  covers: number;
  reservations: number;
  noShows: number;
  ratePct: number;
}

interface TaxRow {
  month: string;
  taxableBaseXof: number;
  taxXof: number;
}

interface PayrollRow {
  id: string;
  runId: string;
  period: string;
  headcount: number;
  totalXof: number;
  paidAt: string;
}

interface StockSnapshotRow {
  id: string;
  at: string;
  stockValueXof: number;
  wasteXof: number;
  lowStockCount: number;
}

interface ReportReviewRow {
  id: string;
  reviewId: string;
  rating: number;
  status: ReviewStatus;
  at: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return isoDate(new Date(Date.now() - days * 86_400_000));
}

const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function ReportsTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canView = permissions.includes('report:view');
  const canExport = permissions.includes('report:export');

  const enumLabel = (group: 'method' | 'channel', value: string) => {
    const key = `reports.${group}.${value}`;
    const label = t(key);
    return label === key ? value.replace(/_/g, ' ') : label;
  };

  const [section, setSection] = useState<Section>('dashboard');
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<ReportSite[]>([]);
  const [granularity, setGranularity] = useState<ReportGranularity>('day');

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);
  const [points, setPoints] = useState<ReportTimeseriesPoint[]>([]);
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [products, setProducts] = useState<ProductRankRow[]>([]);
  const [peak, setPeak] = useState<Array<{ hour: number; orders: number; revenueXof: number }>>([]);
  const [occupancy, setOccupancy] = useState<{
    summary: { days: number; covers: number; capacitySeats: number; ratePct: number; reservations: number; noShows: number };
    items: OccupancyRow[];
  } | null>(null);
  const [live, setLive] = useState<{ seats: number; tables: number } | null>(null);
  const [taxes, setTaxes] = useState<{ ratePct: number; rows: TaxRow[]; totals: { taxableBaseXof: number; taxXof: number } } | null>(null);
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([]);
  const [payrollTotals, setPayrollTotals] = useState<{ runs: number; totalXof: number } | null>(null);
  const [stockRows, setStockRows] = useState<StockSnapshotRow[]>([]);
  const [stockTotals, setStockTotals] = useState<{ wasteXof: number } | null>(null);
  const [reviewRows, setReviewRows] = useState<ReportReviewRow[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReportDashboard['reviews'] | null>(null);
  const [audit, setAudit] = useState<{ items: ReportAuditEntry[]; integrity: boolean } | null>(null);

  const filters = { from, to, ...(siteId ? { siteId } : {}) };

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const core = await reportApi.dashboard(tenantId, filters);
      setDashboard(core.dashboard);
      setSites(core.sites);

      if (section === 'dashboard') {
        const [series, peaks] = await Promise.all([
          reportApi.timeseries(tenantId, { ...filters, granularity: 'day' }),
          reportApi.peakHours(tenantId, filters),
        ]);
        setPoints(series.points);
        setPeak(peaks.peak);
      }
      if (section === 'sales') {
        setSales(await reportApi.sales(tenantId, { ...filters, group: granularity }));
      }
      if (section === 'products') {
        setProducts((await reportApi.products(tenantId, filters)).items);
        setPeak((await reportApi.peakHours(tenantId, filters)).peak);
      }
      if (section === 'occupancy') {
        const occ = await reportApi.occupancy(tenantId, filters);
        setOccupancy({ summary: occ.summary, items: occ.items as OccupancyRow[] });
        setLive(await reportApi.liveOccupancy(tenantId).then((value) => ({ seats: value.seats, tables: value.tables })).catch(() => null));
      }
      if (section === 'finance') {
        const [tax, pay, stock] = await Promise.all([
          reportApi.taxes(tenantId, filters),
          reportApi.payroll(tenantId, filters),
          reportApi.stock(tenantId, filters),
        ]);
        setTaxes({ ratePct: tax.ratePct, rows: tax.rows, totals: tax.totals });
        setPayrollRows(pay.items);
        setPayrollTotals(pay.totals);
        setStockRows(stock.items);
        setStockTotals(stock.totals);
      }
      if (section === 'reviews') {
        const reviews = await reportApi.reviews(tenantId, filters);
        setReviewRows(reviews.items);
        setReviewSummary(reviews.summary);
      }
      if (section === 'audit') {
        setAudit(await reportApi.audit(tenantId));
      }
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId, canView, section, from, to, siteId, granularity]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const applyPreset = (days: number) => {
    setFrom(daysAgo(days - 1));
    setTo(isoDate(new Date()));
  };

  const exportReport = async (format: ReportFormat) => {
    if (!canExport) {
      toast.push({ title: t('reports.exportForbidden'), tone: 'warning' });
      return;
    }
    setExporting(format);
    try {
      const reportMap: Record<Section, ReportName> = {
        dashboard: 'dashboard',
        sales: 'sales',
        products: 'products',
        occupancy: 'occupancy',
        finance: 'taxes',
        reviews: 'reviews',
        audit: 'dashboard',
      };
      const blob = await reportApi.exportBlob(tenantId, { report: reportMap[section], format, ...filters });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `resto-hub-${reportMap[section]}-${from}-${to}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.push({ title: t('reports.exported'), tone: 'success' });
    } catch (cause) {
      toast.push({ title: t('reports.exportError'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setExporting(null);
    }
  };

  if (!canView) {
    return <EmptyState icon="lock" title={t('reports.forbidden')} description={t('reports.filters')} />;
  }

  const maxRevenue = Math.max(1, ...points.map((point) => point.revenueXof));
  const cogsXof = dashboard?.cogsXof ?? null;
  const marginXof = dashboard?.grossMarginXof ?? null;
  const marginRatePct = dashboard?.marginRatePct ?? null;

  const salesColumns: Column<Array<string | number>>[] = (sales?.columns ?? []).map((header, index) => ({
    key: String(index),
    header,
    align: index === 0 ? 'left' : 'right',
    render: (row) => {
      const value = row[index];
      if (index === 0) return String(value ?? '');
      const isCount = /commande|ticket/i.test(header);
      if (isCount) return String(value ?? '');
      return typeof value === 'number' ? formatXof(value, locale) : String(value ?? '');
    },
  }));

  const occupancyColumns: Column<OccupancyRow>[] = [
    { key: 'date', header: t('reports.colDate'), render: (row) => formatDate(row.date, locale) },
    { key: 'capacity', header: t('reports.colCapacity'), align: 'right', render: (row) => row.seatsCapacity },
    { key: 'covers', header: t('reports.colCovers'), align: 'right', render: (row) => row.covers },
    { key: 'rate', header: t('reports.colRate'), align: 'right', render: (row) => `${row.ratePct} %` },
    { key: 'reservations', header: t('reports.colReservations'), align: 'right', render: (row) => row.reservations },
    { key: 'noShows', header: t('reports.colNoShows'), align: 'right', render: (row) => row.noShows },
  ];

  const taxColumns: Column<TaxRow>[] = [
    { key: 'month', header: t('reports.colMonth'), render: (row) => row.month },
    { key: 'base', header: t('reports.colBase'), align: 'right', render: (row) => formatXof(row.taxableBaseXof, locale) },
    { key: 'tax', header: t('reports.colTax'), align: 'right', render: (row) => formatXof(row.taxXof, locale) },
  ];

  const payrollColumns: Column<PayrollRow>[] = [
    { key: 'period', header: t('reports.colPeriod'), render: (row) => row.period },
    { key: 'headcount', header: t('reports.colHeadcount'), align: 'right', render: (row) => row.headcount },
    { key: 'net', header: t('reports.colNet'), align: 'right', render: (row) => formatXof(row.totalXof, locale) },
    { key: 'paid', header: t('reports.colDate'), render: (row) => (row.paidAt ? formatDate(row.paidAt, locale) : '—') },
  ];

  const stockColumns: Column<StockSnapshotRow>[] = [
    { key: 'at', header: t('reports.colDate'), render: (row) => formatDate(row.at, locale) },
    { key: 'value', header: t('reports.colStockValue'), align: 'right', render: (row) => formatXof(row.stockValueXof, locale) },
    { key: 'waste', header: t('reports.colWaste'), align: 'right', render: (row) => formatXof(row.wasteXof, locale) },
    { key: 'low', header: t('reports.colLow'), align: 'right', render: (row) => row.lowStockCount },
  ];

  const reviewColumns: Column<ReportReviewRow>[] = [
    { key: 'rating', header: t('reports.colRating'), render: (row) => `${'★'.repeat(row.rating)} (${row.rating})` },
    {
      key: 'status',
      header: t('reports.colStatus'),
      render: (row) => <Badge tone={REVIEW_TONE[row.status]} dot>{t(`reports.reviewStatus.${row.status}`)}</Badge>,
    },
    { key: 'at', header: t('reports.colDate'), render: (row) => formatDate(row.at, locale) },
  ];

  const auditColumns: Column<ReportAuditEntry>[] = [
    { key: 'at', header: t('reports.colAt'), render: (row) => formatDate(row.createdAt, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) },
    { key: 'actor', header: t('reports.colActor'), render: (row) => row.actorId },
    { key: 'action', header: t('reports.colAction'), render: (row) => <Badge tone="neutral">{row.action}</Badge> },
    { key: 'target', header: t('reports.colStatus'), render: (row) => `${row.targetType} · ${row.targetId}` },
  ];

  return (
    <div className="console-stack">
      <Card flat>
        <CardBody>
          <div className="console-filters" role="group" aria-label={t('reports.filters')}>
            <button type="button" className="console-filter" onClick={() => applyPreset(7)}>{t('reports.last7')}</button>
            <button type="button" className="console-filter" onClick={() => applyPreset(30)}>{t('reports.last30')}</button>
            <button type="button" className="console-filter" onClick={() => applyPreset(90)}>{t('reports.last90')}</button>
            <div className="console-2col" style={{ flex: 1, minWidth: 260 }}>
              <Input label={t('reports.from')} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <Input label={t('reports.to')} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <Select
              label={t('reports.site')}
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              options={[{ value: '', label: t('reports.allSites') }, ...sites.map((site) => ({ value: site.id, label: site.name }))]}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 12 }}>
            {!canExport && <Badge tone="neutral">{t('reports.exportForbidden')}</Badge>}
            <Button size="sm" variant="outline" iconLeft="download" disabled={!canExport} loading={exporting === 'csv'} onClick={() => void exportReport('csv')}>
              {t('reports.exportCsv')}
            </Button>
            <Button size="sm" variant="outline" iconLeft="download" disabled={!canExport} loading={exporting === 'xlsx'} onClick={() => void exportReport('xlsx')}>
              {t('reports.exportXlsx')}
            </Button>
            <Button size="sm" variant="outline" iconLeft="download" disabled={!canExport} loading={exporting === 'pdf'} onClick={() => void exportReport('pdf')}>
              {t('reports.exportPdf')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="console-toolbar">
        <SegmentedControl<Section>
          ariaLabel={t('reports.title')}
          value={section}
          onChange={setSection}
          options={[
            { value: 'dashboard', label: t('reports.tabDashboard') },
            { value: 'sales', label: t('reports.tabSales') },
            { value: 'products', label: t('reports.tabProducts') },
            { value: 'occupancy', label: t('reports.tabOccupancy') },
            { value: 'finance', label: t('reports.tabFinance') },
            { value: 'reviews', label: t('reports.tabReviews') },
            { value: 'audit', label: t('reports.tabAudit') },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {dashboard && (
            <Badge tone="neutral">{t('reports.generatedAt', { date: formatDate(dashboard.generatedAt, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</Badge>
          )}
          <Button variant="outline" size="sm" iconLeft="refresh" onClick={() => void load()}>
            {t('reports.refresh')}
          </Button>
        </div>
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}

      {loading && !dashboard ? (
        <Card>
          <CardBody>
            <SkeletonText lines={8} />
            <p className="console-muted">{t('reports.loading')}</p>
          </CardBody>
        </Card>
      ) : null}

      {section === 'dashboard' && dashboard && (
        <>
          <div className="console-stats">
            <StatCard label={t('reports.kpiRevenue')} value={formatXof(dashboard.revenueXof, locale)} icon="banknote" />
            <StatCard label={t('reports.kpiOrders')} value={dashboard.orders} icon="receipt" meta={t('reports.kpiAverageTicket') + ' · ' + formatXof(dashboard.averageTicketXof, locale)} />
            <StatCard label={t('reports.kpiMargin')} value={dashboard.grossMarginXof === null ? '—' : formatXof(dashboard.grossMarginXof, locale)} icon="chart" meta={dashboard.marginRatePct === null ? undefined : `${dashboard.marginRatePct} %`} />
            <StatCard label={t('reports.kpiOccupancy')} value={`${dashboard.occupancy.ratePct} %`} icon="users" meta={`${dashboard.occupancy.covers} ${t('reports.kpiCovers').toLowerCase()}`} />
          </div>

          <Card>
            <CardHeader title={t('reports.chartRevenue')} action={<Badge tone="accent">{formatXof(dashboard.revenueXof, locale)}</Badge>} />
            <CardBody>
              {points.length === 0 ? (
                <p className="console-muted">{t('reports.chartEmpty')}</p>
              ) : (
                <figure className="chart">
                  <div className="chart__plot" role="img" aria-label={`${t('reports.chartRevenue')} — ${formatXof(dashboard.revenueXof, locale)}`}>
                    {points.map((point, index) => (
                      <div className="chart__col" key={point.bucket}>
                        <span className="chart__value">{formatXofCompact(point.revenueXof, locale)}</span>
                        <span className="chart__bar-wrap">
                          <span
                            className={cx('chart__bar', index === points.length - 1 && 'chart__bar--today')}
                            style={{ height: `${Math.max(2, Math.round((point.revenueXof / maxRevenue) * 100))}%` }}
                            title={`${formatDate(point.bucket, locale)} · ${formatXof(point.revenueXof, locale)} · ${point.orders} ${t('reports.kpiOrders').toLowerCase()}`}
                          />
                        </span>
                        <span className="chart__day">{formatDate(point.bucket, locale, { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                  <figcaption className="chart__foot">
                    <span>{t('reports.totalRevenue')}</span>
                    <strong>{formatXof(dashboard.revenueXof, locale)}</strong>
                  </figcaption>
                </figure>
              )}
            </CardBody>
          </Card>

          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.topProductsTitle')} />
              <CardBody>
                {dashboard.topProducts.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {dashboard.topProducts.map((product) => (
                      <li key={product.productId}>
                        <div>
                          <strong>{product.productName}</strong>
                          <span>{product.quantity} × · {product.sharePct} %</span>
                        </div>
                        <span>{formatXof(product.revenueXof, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.peakHoursTitle')} />
              <CardBody>
                {peak.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {peak.map((bucket) => (
                      <li key={bucket.hour}>
                        <div>
                          <strong>{t('reports.peakHourLabel', { hour: String(bucket.hour).padStart(2, '0') })}</strong>
                          <span>{bucket.orders} {t('reports.kpiOrders').toLowerCase()}</span>
                        </div>
                        <span>{formatXof(bucket.revenueXof, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.paymentMixTitle')} />
              <CardBody>
                {dashboard.paymentMix.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {dashboard.paymentMix.map((entry) => (
                      <li key={entry.method}>
                        <div>
                          <strong>{enumLabel('method', entry.method)}</strong>
                          <span>{entry.count} · {entry.sharePct} %</span>
                        </div>
                        <span>{formatXof(entry.amountXof, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.channelMixTitle')} />
              <CardBody>
                {dashboard.channelMix.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {dashboard.channelMix.map((entry) => (
                      <li key={entry.channel}>
                        <div>
                          <strong>{enumLabel('channel', entry.channel)}</strong>
                          <span>{entry.count} · {entry.sharePct} %</span>
                        </div>
                        <span>{formatXof(entry.amountXof, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'sales' && (
        <Card>
          <CardHeader
            title={t('reports.salesTitle')}
            subtitle={t('reports.salesHint')}
            action={
              <SegmentedControl<ReportGranularity>
                ariaLabel={t('reports.salesTitle')}
                value={granularity}
                onChange={setGranularity}
                options={[
                  { value: 'day', label: t('reports.groupDay') },
                  { value: 'month', label: t('reports.groupMonth') },
                ]}
              />
            }
          />
          <CardBody>
            {!sales || sales.rows.length === 0 ? (
              <EmptyState icon="chart" title={t('reports.salesTitle')} description={t('reports.noSales')} />
            ) : (
              <>
                <DataTable columns={salesColumns} rows={sales.rows} getRowId={(row) => String(row[0])} caption={t('reports.salesTitle')} />
                <div className="console-kv">
                  <span>{t('reports.totalsTitle')}</span>
                  <span>
                    {t('reports.totalOrders')} {sales.totals.orders} · {t('reports.totalRevenue')} {formatXof(sales.totals.revenueXof, locale)} ·{' '}
                    {t('reports.totalTax')} {formatXof(sales.totals.taxXof, locale)} · {t('reports.totalRefunds')} {formatXof(sales.totals.refundsXof, locale)}
                  </span>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {section === 'products' && (
        <>
          <div className="console-stats">
            <StatCard label={t('reports.kpiCogs')} value={cogsXof === null ? '—' : formatXof(cogsXof, locale)} icon="chef" />
            <StatCard label={t('reports.kpiMargin')} value={marginXof === null ? '—' : formatXof(marginXof, locale)} icon="chart" meta={marginRatePct === null ? undefined : `${marginRatePct} %`} />
            <StatCard label={t('reports.kpiDiscounts')} value={formatXof(dashboard?.discountXof ?? 0, locale)} icon="gift" />
            <StatCard label={t('reports.kpiWaste')} value={formatXof(dashboard?.stock.wasteXof ?? 0, locale)} icon="trash" />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.productsTitle')} subtitle={t('reports.productsHint')} />
              <CardBody>
                {products.length === 0 ? (
                  <EmptyState icon="chart" title={t('reports.productsTitle')} description={t('reports.noData')} />
                ) : (
                  <DataTable
                    columns={[
                      { key: 'name', header: t('reports.colProduct'), render: (row: ProductRankRow) => row.productName },
                      { key: 'qty', header: t('reports.colQty'), align: 'right', render: (row: ProductRankRow) => row.quantity },
                      { key: 'revenue', header: t('reports.colRevenue'), align: 'right', render: (row: ProductRankRow) => formatXof(row.revenueXof, locale) },
                      { key: 'share', header: t('reports.colShare'), align: 'right', render: (row: ProductRankRow) => `${row.sharePct} %` },
                    ]}
                    rows={products}
                    getRowId={(row) => row.productId}
                    caption={t('reports.productsTitle')}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.peakHoursTitle')} />
              <CardBody>
                {peak.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {peak.map((bucket) => (
                      <li key={bucket.hour}>
                        <div>
                          <strong>{t('reports.peakHourLabel', { hour: String(bucket.hour).padStart(2, '0') })}</strong>
                          <span>{bucket.orders} {t('reports.kpiOrders').toLowerCase()}</span>
                        </div>
                        <span>{formatXof(bucket.revenueXof, locale)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'occupancy' && (
        <>
          <div className="console-stats">
            <StatCard label={t('reports.kpiOccupancy')} value={`${occupancy?.summary.ratePct ?? 0} %`} icon="users" />
            <StatCard label={t('reports.kpiCovers')} value={occupancy?.summary.covers ?? 0} icon="receipt" meta={`/ ${occupancy?.summary.capacitySeats ?? 0}`} />
            <StatCard label={t('reports.kpiReservations')} value={occupancy?.summary.reservations ?? 0} icon="calendar" meta={t('reports.kpiReservationCovers') + ' · ' + (dashboard?.reservations.covers ?? 0)} />
            <StatCard label={t('reports.kpiNoShows')} value={occupancy?.summary.noShows ?? 0} icon="alert" />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.occupancyTitle')} subtitle={t('reports.occupancyHint')} />
              <CardBody>
                {!occupancy || occupancy.items.length === 0 ? (
                  <EmptyState icon="users" title={t('reports.occupancyTitle')} description={t('reports.noData')} />
                ) : (
                  <DataTable columns={occupancyColumns} rows={occupancy.items} getRowId={(row) => row.id} caption={t('reports.occupancyTitle')} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.liveTitle')} />
              <CardBody>
                {live ? (
                  <>
                    <div className="console-kv"><span>{t('reports.liveSeats')}</span><strong>{live.seats}</strong></div>
                    <div className="console-kv"><span>{t('reports.liveTables')}</span><strong>{live.tables}</strong></div>
                  </>
                ) : (
                  <p className="console-muted">{t('reports.noData')}</p>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'finance' && (
        <>
          <div className="console-stats">
            <StatCard label={t('reports.kpiTax')} value={formatXof(taxes?.totals.taxXof ?? 0, locale)} icon="receipt" meta={`${taxes?.ratePct ?? 0} %`} />
            <StatCard label={t('reports.kpiPayroll')} value={formatXof(payrollTotals?.totalXof ?? 0, locale)} icon="wallet" meta={`${payrollTotals?.runs ?? 0} ${t('reports.payrollTitle').toLowerCase()}`} />
            <StatCard label={t('reports.kpiStockValue')} value={formatXof(dashboard?.stock.latestValueXof ?? 0, locale)} icon="box" />
            <StatCard label={t('reports.kpiLowStock')} value={dashboard?.stock.lowStockCount ?? 0} icon="alert" meta={`${t('reports.kpiWaste').toLowerCase()} · ${formatXof(stockTotals?.wasteXof ?? 0, locale)}`} />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.taxesTitle')} action={<Badge tone="info">{taxes?.ratePct ?? 0} %</Badge>} />
              <CardBody>
                {!taxes || taxes.rows.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <DataTable columns={taxColumns} rows={taxes.rows} getRowId={(row) => row.month} caption={t('reports.taxesTitle')} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.payrollTitle')} action={<Badge tone="neutral">{formatXof(payrollTotals?.totalXof ?? 0, locale)}</Badge>} />
              <CardBody>
                {payrollRows.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <DataTable columns={payrollColumns} rows={payrollRows} getRowId={(row) => row.id} caption={t('reports.payrollTitle')} />
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title={t('reports.stockTitle')} />
            <CardBody>
              {stockRows.length === 0 ? (
                <p className="console-muted">{t('reports.noData')}</p>
              ) : (
                <DataTable columns={stockColumns} rows={stockRows} getRowId={(row) => row.id} caption={t('reports.stockTitle')} />
              )}
            </CardBody>
          </Card>
        </>
      )}

      {section === 'reviews' && (
        <>
          <div className="console-stats">
            <StatCard label={t('reports.kpiReviewAverage')} value={`${(reviewSummary?.average ?? 0).toFixed(1)} / 5`} icon="sparkles" />
            <StatCard label={t('reports.kpiReviews')} value={reviewSummary?.count ?? 0} icon="users" />
            <StatCard label={t('reports.kpiReservations')} value={dashboard?.reservations.count ?? 0} icon="calendar" />
            <StatCard label={t('reports.kpiNoShows')} value={dashboard?.occupancy.noShows ?? 0} icon="alert" />
          </div>
          <div className="console-2col">
            <Card>
              <CardHeader title={t('reports.distributionTitle')} />
              <CardBody>
                {!reviewSummary ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <ul className="console-queue">
                    {[5, 4, 3, 2, 1].map((rating) => (
                      <li key={rating}>
                        <div>
                          <strong>{rating} ★</strong>
                          <span>{reviewSummary.distribution[String(rating)] ?? 0} {t('reports.kpiReviews').toLowerCase()}</span>
                        </div>
                        <Badge tone="neutral">
                          {reviewSummary.count ? Math.round(((reviewSummary.distribution[String(rating)] ?? 0) / reviewSummary.count) * 100) : 0} %
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('reports.reviewsTitle')} action={<Badge tone="accent">{t('reports.averageLabel')} {(reviewSummary?.average ?? 0).toFixed(1)}</Badge>} />
              <CardBody>
                {reviewRows.length === 0 ? (
                  <p className="console-muted">{t('reports.noData')}</p>
                ) : (
                  <DataTable columns={reviewColumns} rows={reviewRows} getRowId={(row) => row.id} caption={t('reports.reviewsTitle')} />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'audit' && (
        <Card>
          <CardHeader
            title={t('reports.auditTitle')}
            subtitle={t('reports.auditHint')}
            action={<Badge tone={audit?.integrity ? 'success' : 'danger'} dot>{audit?.integrity ? t('reports.auditIntegrityOk') : t('reports.auditIntegrityBroken')}</Badge>}
          />
          <CardBody>
            {!audit || audit.items.length === 0 ? (
              <EmptyState icon="shield" title={t('reports.auditTitle')} description={t('reports.auditEmpty')} />
            ) : (
              <DataTable columns={auditColumns} rows={audit.items} getRowId={(row) => row.id} caption={t('reports.auditTitle')} />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
