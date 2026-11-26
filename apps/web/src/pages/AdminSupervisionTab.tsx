import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Select,
  SkeletonText,
  StatCard,
  formatDate,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  platformAdminApi,
  type PlatformSupervision,
  type PlatformLogRow,
  type SupervisionServiceRow,
} from '../lib/api';
import { useSession } from '../lib/session';

interface Props {
  locale: Locale;
}

const SERVICE_TONE: Record<string, BadgeTone> = {
  up: 'success',
  down: 'danger',
  unknown: 'neutral',
};

const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

const ALERT_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  acknowledged: 'info',
  resolved: 'success',
};

const LEVEL_TONE: Record<string, BadgeTone> = {
  error: 'danger',
  warn: 'warning',
  info: 'info',
  debug: 'neutral',
};

export function AdminSupervisionTab({ locale }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const { hasPlatform } = useSession();
  const canOperate = hasPlatform('platform:operate');

  const [data, setData] = useState<PlatformSupervision | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState('all');
  const [alertPending, setAlertPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await platformAdminApi.supervision());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void platformAdminApi
        .supervision()
        .then(setData)
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const runCheck = async () => {
    setChecking(true);
    try {
      await platformAdminApi.checkSupervision();
      toast.push({ title: t('adminSupervision.checked') });
      await load();
    } catch (cause) {
      toast.push({
        title: t('adminSupervision.errorTitle'),
        description: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setChecking(false);
    }
  };

  const updateAlert = async (id: string, action: 'acknowledge' | 'resolve') => {
    setAlertPending(id);
    try {
      await platformAdminApi.updateAlert(id, action);
      toast.push({ title: t('adminSupervision.alertUpdated') });
      await load();
    } catch (cause) {
      toast.push({
        title: t('adminSupervision.errorTitle'),
        description: errorMessage(cause),
        tone: 'error',
      });
    } finally {
      setAlertPending(null);
    }
  };

  const serviceColumns: Array<Column<SupervisionServiceRow>> = [
    {
      key: 'service',
      header: t('adminSupervision.colService'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.url}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('adminSupervision.colStatus'),
      render: (row) => (
        <Badge tone={SERVICE_TONE[row.status] ?? 'neutral'} dot live={row.status === 'up'}>
          {t(`adminSupervision.status_${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'latency',
      header: t('adminSupervision.colLatency'),
      align: 'right',
      render: (row) => <span>{row.status === 'unknown' ? '—' : `${row.latencyMs} ms`}</span>,
    },
    {
      key: 'uptime',
      header: t('adminSupervision.colUptime'),
      align: 'right',
      render: (row) => <span>{row.checks === 0 ? '—' : `${row.uptimePct} %`}</span>,
    },
    {
      key: 'checks',
      header: t('adminSupervision.colChecks'),
      align: 'right',
      render: (row) => (
        <div className="console-cell" style={{ alignItems: 'flex-end' }}>
          <span>{row.checks}</span>
          {row.failures > 0 && <span>{row.failures} KO</span>}
        </div>
      ),
    },
    {
      key: 'lastCheck',
      header: t('adminSupervision.colLastCheck'),
      align: 'right',
      render: (row) => (
        <span className="console-muted">
          {row.lastCheckAt
            ? formatDate(row.lastCheckAt, locale, {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : t('adminSupervision.noChecks')}
        </span>
      ),
    },
  ];

  const logColumns: Array<Column<PlatformLogRow>> = [
    {
      key: 'level',
      header: t('adminSupervision.colLevel'),
      render: (row) => (
        <Badge tone={LEVEL_TONE[row.level] ?? 'neutral'}>
          {t(`adminSupervision.level_${row.level}`)}
        </Badge>
      ),
    },
    {
      key: 'message',
      header: t('adminSupervision.colMessage'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.message}</strong>
          <span>{row.service}</span>
        </div>
      ),
    },
    {
      key: 'at',
      header: t('adminSupervision.colAt'),
      align: 'right',
      render: (row) => (
        <span className="console-muted">
          {formatDate(row.at, locale, {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
  ];

  const logs = (data?.logs ?? []).filter((entry) =>
    level === 'all' ? true : entry.level === level,
  );
  const openAlerts = data?.alerts.filter((alert) => alert.status !== 'resolved') ?? [];

  return (
    <div className="console-stack">
      <Card>
        <CardHeader
          title={t('adminSupervision.title')}
          subtitle={t('adminSupervision.subtitle')}
          action={
            <div className="console-toolbar" style={{ margin: 0 }}>
              <Button
                size="sm"
                variant="outline"
                iconLeft="refresh"
                onClick={() => void load()}
                loading={loading}
              >
                {t('adminSupervision.refresh')}
              </Button>
              {canOperate && (
                <Button
                  size="sm"
                  iconLeft="play"
                  onClick={() => void runCheck()}
                  loading={checking}
                >
                  {checking ? t('adminSupervision.checking') : t('adminSupervision.check')}
                </Button>
              )}
            </div>
          }
        />
        <CardBody>
          {error ? (
            <div className="console-stack">
              <p className="auth-error" role="alert">
                {t('adminSupervision.errorTitle')} — {error}
              </p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('adminSupervision.refresh')}
              </Button>
            </div>
          ) : loading || !data ? (
            <SkeletonText lines={4} />
          ) : (
            <div className="console-stats">
              <StatCard
                label={t('adminSupervision.kpiServicesUp')}
                value={`${data.services.filter((service) => service.status === 'up').length}/${data.services.length}`}
                icon="layers"
                meta={
                  data.services.some((service) => service.status === 'unknown')
                    ? t('adminSupervision.status_unknown')
                    : undefined
                }
              />
              <StatCard
                label={t('adminSupervision.kpiAlerts')}
                value={openAlerts.length}
                icon="alert"
              />
              <StatCard
                label={t('adminSupervision.kpiEvents')}
                value={data.metrics.events24h}
                icon="zap"
              />
              <StatCard
                label={t('adminSupervision.kpiAudit')}
                value={data.audit.length}
                icon="shield"
                meta={
                  <Badge tone={data.audit.valid ? 'success' : 'danger'} dot>
                    {data.audit.valid
                      ? t('adminSupervision.chainOk')
                      : t('adminSupervision.chainBroken')}
                  </Badge>
                }
              />
            </div>
          )}
          <p className="console-muted">{t('adminSupervision.autoRefresh')}</p>
        </CardBody>
      </Card>

      {data && (
        <>
          <Card>
            <CardHeader
              title={t('adminSupervision.servicesTitle')}
              subtitle={t('adminSupervision.servicesSubtitle')}
            />
            <CardBody>
              <DataTable
                columns={serviceColumns}
                rows={data.services}
                getRowId={(row) => row.name}
                caption={t('adminSupervision.servicesTitle')}
              />
            </CardBody>
          </Card>

          <div className="console-2col">
            <Card>
              <CardHeader
                title={t('adminSupervision.alertsTitle')}
                subtitle={t('adminSupervision.alertsSubtitle')}
              />
              <CardBody>
                {data.alerts.length === 0 ? (
                  <EmptyState
                    icon="check-circle"
                    title={t('adminSupervision.alertsEmptyTitle')}
                    description={t('adminSupervision.alertsEmptyBody')}
                  />
                ) : (
                  <ul className="console-queue">
                    {data.alerts.map((alert) => (
                      <li key={alert.id}>
                        <div>
                          <strong>{alert.message}</strong>
                          <span>
                            {alert.service} ·{' '}
                            {formatDate(alert.createdAt, locale, {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <Badge tone={SEVERITY_TONE[alert.severity] ?? 'neutral'} dot>
                          {t(`adminSupervision.severity_${alert.severity}`)}
                        </Badge>
                        <Badge tone={ALERT_TONE[alert.status] ?? 'neutral'}>
                          {t(`adminSupervision.alertStatus_${alert.status}`)}
                        </Badge>
                        {alert.status !== 'resolved' && canOperate ? (
                          <div
                            className="console-toolbar"
                            style={{ margin: 0, gap: 'var(--space-2)' }}
                          >
                            {alert.status === 'open' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void updateAlert(alert.id, 'acknowledge')}
                                loading={alertPending === alert.id}
                              >
                                {t('adminSupervision.ack')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void updateAlert(alert.id, 'resolve')}
                              loading={alertPending === alert.id}
                            >
                              {t('adminSupervision.resolve')}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('adminSupervision.eventsTitle')} />
              <CardBody>
                {data.metrics.recentEvents.length === 0 ? (
                  <p className="console-muted">{t('adminSupervision.eventsEmpty')}</p>
                ) : (
                  <ul className="console-queue">
                    {data.metrics.recentEvents.map((event, index) => (
                      <li key={`${event.type}-${event.at}-${index}`}>
                        <div>
                          <strong>{event.type}</strong>
                          <span>
                            {formatDate(event.at, locale, {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <Badge tone="neutral">{data.metrics.eventsByType[event.type] ?? 0}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title={t('adminSupervision.logsTitle')}
              subtitle={t('adminSupervision.logsSubtitle')}
              action={
                <Select
                  aria-label={t('adminSupervision.allLevels')}
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  options={[
                    { value: 'all', label: t('adminSupervision.allLevels') },
                    { value: 'error', label: t('adminSupervision.level_error') },
                    { value: 'warn', label: t('adminSupervision.level_warn') },
                    { value: 'info', label: t('adminSupervision.level_info') },
                    { value: 'debug', label: t('adminSupervision.level_debug') },
                  ]}
                />
              }
            />
            <CardBody>
              {logs.length === 0 ? (
                <EmptyState
                  icon="monitor"
                  title={t('adminSupervision.logsEmptyTitle')}
                  description={t('adminSupervision.logsEmptyBody')}
                />
              ) : (
                <DataTable
                  columns={logColumns}
                  rows={logs}
                  getRowId={(row) => row.id}
                  caption={t('adminSupervision.logsTitle')}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
