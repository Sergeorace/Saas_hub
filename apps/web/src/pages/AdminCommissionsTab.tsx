import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SegmentedControl,
  SkeletonText,
  StatCard,
  DataTable,
  formatDate,
  formatXof,
  formatXofCompact,
  useI18n,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import { errorMessage, platformAdminApi, type PlatformCommissionView, type CommissionGroupRow, type CommissionEntryView } from '../lib/api';

interface Props {
  locale: Locale;
}

type Range = '7' | '30' | '90';

export function AdminCommissionsTab({ locale }: Props) {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>('30');
  const [data, setData] = useState<PlatformCommissionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const methodLabel = (value: string) => {
    const key = `adminCommissions.method_${value}`;
    const label = t(key);
    return label === key ? value.replace(/_/g, ' ') : label;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await platformAdminApi.commissions(Number(range)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupColumnsFor = (labelKey: string): Array<Column<CommissionGroupRow>> => [
    {
      key: 'label',
      header: t(labelKey),
      render: (row) => (
        <div className="console-cell">
          <strong>{labelKey === 'adminCommissions.colMethod' ? methodLabel(row.key) : row.label}</strong>
          <span>{row.key}</span>
        </div>
      ),
    },
    {
      key: 'transactions',
      header: t('adminCommissions.colTransactions'),
      align: 'right',
      render: (row) => row.transactions,
    },
    {
      key: 'volume',
      header: t('adminCommissions.colAmount'),
      align: 'right',
      render: (row) => <strong>{formatXof(row.volumeXof, locale)}</strong>,
    },
    {
      key: 'commission',
      header: t('adminCommissions.colCommission'),
      align: 'right',
      render: (row) => <Badge tone="accent">{formatXof(row.commissionXof, locale)}</Badge>,
    },
    {
      key: 'net',
      header: t('adminCommissions.colNet'),
      align: 'right',
      render: (row) => formatXof(row.netXof, locale),
    },
  ];

  const groupColumns = groupColumnsFor('adminCommissions.colTenant');

  const transactionColumns: Array<Column<CommissionEntryView>> = [
    {
      key: 'reference',
      header: t('adminCommissions.colReference'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.reference}</strong>
          <span>{row.tenantId}</span>
        </div>
      ),
    },
    {
      key: 'method',
      header: t('adminCommissions.colMethod'),
      render: (row) => (
        <div className="console-cell">
          <span>{methodLabel(row.method)}</span>
          <span>{row.provider}</span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('adminCommissions.colAmount'),
      align: 'right',
      render: (row) => formatXof(row.amountXof, locale),
    },
    {
      key: 'commission',
      header: t('adminCommissions.colCommission'),
      align: 'right',
      render: (row) => formatXof(row.commissionXof, locale),
    },
    {
      key: 'at',
      header: t('adminCommissions.colDate'),
      align: 'right',
      render: (row) => <span className="console-muted">{formatDate(row.at, locale)}</span>,
    },
  ];

  const points = data?.groups.day ?? [];
  const maxCommission = Math.max(1, ...points.map((point) => point.commissionXof));

  return (
    <div className="console-stack">
      <Card>
        <CardHeader
          title={t('adminCommissions.title')}
          subtitle={t('adminCommissions.subtitle')}
          action={
            <div className="console-toolbar" style={{ margin: 0 }}>
              <SegmentedControl<Range>
                ariaLabel={t('adminCommissions.title')}
                value={range}
                onChange={setRange}
                options={[
                  { value: '7', label: t('adminCommissions.range7') },
                  { value: '30', label: t('adminCommissions.range30') },
                  { value: '90', label: t('adminCommissions.range90') },
                ]}
              />
              <Button size="sm" variant="outline" iconLeft="refresh" onClick={() => void load()} loading={loading}>
                {t('adminCommissions.refresh')}
              </Button>
            </div>
          }
        />
        <CardBody>
          {error ? (
            <div className="console-stack">
              <p className="auth-error" role="alert">{t('adminCommissions.errorTitle')} — {error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>{t('adminCommissions.refresh')}</Button>
            </div>
          ) : loading || !data ? (
            <SkeletonText lines={4} />
          ) : data.summary.transactions === 0 ? (
            <EmptyState icon="banknote" title={t('adminCommissions.emptyTitle')} description={t('adminCommissions.emptyBody')} />
          ) : (
            <div className="console-stats">
              <StatCard label={t('adminCommissions.kpiVolume')} value={formatXof(data.summary.volumeXof, locale)} icon="banknote" />
              <StatCard label={t('adminCommissions.kpiCommission')} value={formatXof(data.summary.commissionXof, locale)} icon="wallet" meta={`${data.summary.averageRatePct} %`} />
              <StatCard label={t('adminCommissions.kpiNet')} value={formatXof(data.summary.netXof, locale)} icon="trending-up" />
              <StatCard label={t('adminCommissions.kpiAverage')} value={formatXof(data.summary.averageBasketXof, locale)} icon="receipt" meta={`${data.summary.transactions} ${t('adminCommissions.colTransactions').toLowerCase()}`} />
            </div>
          )}
        </CardBody>
      </Card>

      {data && data.summary.transactions > 0 && (
        <>
          <Card>
            <CardHeader title={t('adminCommissions.chartTitle')} action={<Badge tone="accent">{formatXof(data.summary.commissionXof, locale)}</Badge>} />
            <CardBody>
              {points.length === 0 ? (
                <p className="console-muted">{t('adminCommissions.chartEmpty')}</p>
              ) : (
                <figure className="chart">
                  <div
                    className="chart__plot"
                    style={{ gridTemplateColumns: `repeat(${Math.min(points.length, 14)}, minmax(0, 1fr))` }}
                    role="img"
                    aria-label={`${t('adminCommissions.chartTitle')} — ${formatXof(data.summary.commissionXof, locale)}`}
                  >
                    {points.map((point, index) => (
                      <div className="chart__col" key={point.key}>
                        <span className="chart__value">{formatXofCompact(point.commissionXof, locale)}</span>
                        <span className="chart__bar-wrap">
                          <span
                            className={index === points.length - 1 ? 'chart__bar chart__bar--today' : 'chart__bar'}
                            style={{ height: `${Math.max(2, Math.round((point.commissionXof / maxCommission) * 100))}%` }}
                            title={`${formatDate(point.key, locale)} · ${formatXof(point.commissionXof, locale)}`}
                          />
                        </span>
                        <span className="chart__day">{formatDate(point.key, locale, { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                  <figcaption className="chart__foot">
                    <span>{t('adminCommissions.kpiCommission')}</span>
                    <strong>{formatXof(data.summary.commissionXof, locale)}</strong>
                  </figcaption>
                </figure>
              )}
              <p className="console-muted">{t('adminCommissions.hint')}</p>
            </CardBody>
          </Card>

          <div className="console-2col">
            <Card>
              <CardHeader title={t('adminCommissions.tenantTitle')} />
              <CardBody>
                <DataTable columns={groupColumns} rows={data.groups.tenant} getRowId={(row) => row.key} caption={t('adminCommissions.tenantTitle')} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('adminCommissions.providerTitle')} />
              <CardBody>
                <DataTable columns={groupColumnsFor('adminCommissions.colProvider')} rows={data.groups.provider} getRowId={(row) => row.key} caption={t('adminCommissions.providerTitle')} />
                <h3 className="reg-subtitle reg-subtitle--sm">{t('adminCommissions.methodTitle')}</h3>
                <DataTable
                  columns={groupColumnsFor('adminCommissions.colMethod')}
                  rows={data.groups.method}
                  getRowId={(row) => row.key}
                  caption={t('adminCommissions.methodTitle')}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t('adminCommissions.transactionsTitle')} subtitle={t('adminCommissions.transactionsSubtitle')} />
            <CardBody>
              <DataTable
                columns={transactionColumns}
                rows={data.transactions}
                getRowId={(row) => row.id}
                caption={t('adminCommissions.transactionsTitle')}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
