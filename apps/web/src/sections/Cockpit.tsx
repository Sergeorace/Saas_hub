import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Icon,
  StatCard,
  formatPercent,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
} from '@resto-hub/design-system';
import { auditTrail, kpis, orders, revenueSeries } from '../data/demo';
import type { OrderRow } from '../data/types';
import { RevenueChart } from '../components/RevenueChart';

const statusTone: Record<OrderRow['status'], BadgeTone> = {
  kitchen: 'warning',
  ready: 'info',
  served: 'primary',
  paid: 'success',
};

export function Cockpit() {
  const { t, tm, locale } = useI18n();
  const { push } = useToast();
  const orderStatuses = tm<Record<OrderRow['status'], string>>('cockpit.orderStatuses');
  const rbacChips = tm<string[]>('cockpit.rbacChips');

  const columns: Array<Column<OrderRow>> = [
    {
      key: 'id',
      header: t('cockpit.orderRef'),
      render: (row) => <span className="rh-table__mono">{row.id}</span>,
    },
    {
      key: 'table',
      header: t('cockpit.orderTable'),
      render: (row) => <span className="cockpit__table-pill">{row.table}</span>,
    },
    {
      key: 'items',
      header: t('cockpit.orderItems'),
      render: (row) =>
        `${row.items} ${row.items > 1 ? t('cockpit.itemPlural') : t('cockpit.itemSingular')}`,
    },
    {
      key: 'total',
      header: t('cockpit.orderTotal'),
      align: 'right',
      render: (row) => <strong>{formatXof(row.total, locale)}</strong>,
    },
    {
      key: 'status',
      header: t('cockpit.orderStatus'),
      render: (row) => (
        <Badge tone={statusTone[row.status]} dot>
          {orderStatuses[row.status]}
        </Badge>
      ),
    },
    {
      key: 'time',
      header: t('cockpit.orderTime'),
      align: 'right',
      render: (row) => <span className="rh-table__mono">{row.time}</span>,
    },
  ];

  return (
    <section className="section" aria-labelledby="cockpit-title">
      <div className="site-container">
        <header className="section__head">
          <div>
            <p className="rh-eyebrow">{t('cockpit.eyebrow')}</p>
            <h2 className="rh-display section__title" id="cockpit-title">
              {t('cockpit.title')}
            </h2>
          </div>
          <p className="section__lead">{t('cockpit.lead')}</p>
        </header>

        <div className="kpi-grid">
          <StatCard
            label={t('cockpit.kpiRevenue')}
            value={formatXof(kpis.revenue, locale)}
            icon="banknote"
            delta={{ value: formatPercent(kpis.revenueDelta, locale), direction: 'up' }}
            meta={t('cockpit.vsYesterday')}
          />
          <StatCard
            label={t('cockpit.kpiAverage')}
            value={formatXof(kpis.averageTicket, locale)}
            icon="receipt"
            delta={{ value: formatPercent(kpis.averageDelta, locale), direction: 'up' }}
            meta={t('cockpit.vsYesterday')}
          />
          <StatCard
            label={t('cockpit.kpiTickets')}
            value={kpis.tickets}
            icon="check-circle"
            delta={{ value: formatPercent(kpis.ticketsDelta, locale), direction: 'up' }}
            meta={t('cockpit.vsYesterday')}
          />
          <StatCard
            label={t('cockpit.kpiOccupancy')}
            value={formatPercent(kpis.occupancyRate, locale)}
            icon="users"
            delta={{ value: formatPercent(kpis.occupancyDelta, locale), direction: 'up' }}
            meta={t('cockpit.capacity')}
          />
        </div>

        <div className="cockpit__row">
          <Card>
            <CardHeader title={t('cockpit.chartTitle')} subtitle={t('cockpit.chartSub')} />
            <CardBody>
              <RevenueChart series={revenueSeries} />
            </CardBody>
          </Card>

          <Card className="payroll">
            <CardHeader
              title={t('cockpit.payrollTitle')}
              subtitle={t('cockpit.payrollSub')}
              action={<Badge tone="warning">2/2</Badge>}
            />
            <CardBody>
              <div className="payroll__amount">
                <strong>{t('cockpit.payrollAmount')}</strong>
                <span>{t('cockpit.payrollBatch')}</span>
              </div>
              <ol className="payroll__steps">
                <li className="is-done">
                  <span className="payroll__step-icon">
                    <Icon name="check" size="sm" />
                  </span>
                  <div>
                    <span>{t('cockpit.payrollStepPrepared')}</span>
                    <small>{t('cockpit.payrollPreparedMeta')}</small>
                  </div>
                </li>
                <li className="is-current">
                  <span className="payroll__step-icon">
                    <Icon name="key" size="sm" />
                  </span>
                  <div>
                    <span>{t('cockpit.payrollStepApproved')}</span>
                    <small>{t('cockpit.payrollApproveMeta')}</small>
                  </div>
                </li>
              </ol>
              <Button
                fullWidth
                iconLeft="shield"
                onClick={() =>
                  push({
                    tone: 'success',
                    title: t('cockpit.payrollToastTitle'),
                    description: t('cockpit.payrollToastDesc'),
                  })
                }
              >
                {t('cockpit.payrollAction')}
              </Button>
            </CardBody>
          </Card>
        </div>

        <div className="cockpit__row">
          <Card>
            <CardHeader title={t('cockpit.ordersTitle')} subtitle={t('cockpit.ordersSub')} />
            <DataTable
              columns={columns}
              rows={orders}
              getRowId={(row) => row.id}
              caption={t('cockpit.ordersCaption')}
            />
          </Card>

          <Card className="audit">
            <CardHeader
              title={t('cockpit.payrollAudit')}
              subtitle={t('cockpit.payrollAuditSub')}
              action={<Icon name="lock" className="audit__lock" />}
            />
            <CardBody>
              <ul className="audit__list">
                {auditTrail.map((entry) => (
                  <li key={entry.id}>
                    <span className="audit__action rh-kbd">{entry.action}</span>
                    <span className="audit__detail">{entry.detail}</span>
                    <span className="audit__meta">
                      {entry.who} · {entry.time}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="audit__rbac">
                <div className="audit__rbac-head">
                  <Icon name="shield" size="sm" />
                  <strong>{t('cockpit.payrollRbac')}</strong>
                </div>
                <p>{t('cockpit.payrollRbacSub')}</p>
                <div className="audit__chips">
                  {(rbacChips ?? []).map((chip) => (
                    <span className="rh-kbd" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}
