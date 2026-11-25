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
  Modal,
  SegmentedControl,
  Sidebar,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatXof,
  useI18n,
  useTheme,
  type Column,
  type Locale,
  type NavGroup,
} from '@resto-hub/design-system';
import { useToast } from '@resto-hub/design-system';
import { MobileTabs } from '../components/MobileTabs';
import { PaymentsPlatformTab } from './PaymentsPlatformTab';
import { AdminCommissionsTab } from './AdminCommissionsTab';
import { AdminSupervisionTab } from './AdminSupervisionTab';
import { AdminSettingsTab } from './AdminSettingsTab';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import {
  errorMessage,
  tenantApi,
  type AdminOverview,
  type AdminTenantRow,
  type ApplicationDetail,
  type ApplicationListItem,
  type ApplicationStatus,
} from '../lib/api';

type Tab = 'overview' | 'applications' | 'tenants' | 'payments' | 'commissions' | 'supervision' | 'settings';

function statusTone(status: ApplicationStatus | string): 'neutral' | 'warning' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'submitted':
      return 'warning';
    case 'info_requested':
      return 'info';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', enterprise: 'Entreprise' };

export function AdminPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { status, user, hasPlatform, signOut } = useSession();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('submitted');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'request_documents'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<AdminTenantRow | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendPending, setSuspendPending] = useState(false);

  const allowed = hasPlatform('platform:establishments:review');

  const loadAll = useCallback(async (searchTerm: string) => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, appsResult, tenantsResult] = await Promise.all([
        tenantApi.overview(),
        tenantApi.adminApplications({
          status: statusFilter === 'all' ? undefined : statusFilter,
          q: searchTerm.trim() || undefined,
        }),
        tenantApi.adminTenants(),
      ]);
      setOverview(overviewResult);
      setApplications(appsResult.items);
      setCounts(appsResult.counts);
      setTenants(tenantsResult.items);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [allowed, statusFilter]);

  useEffect(() => {
    if (status !== 'authenticated' || !allowed) {
      setLoading(false);
      return;
    }
    void loadAll('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, allowed, statusFilter]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setReviewError(null);
    setReviewAction('approve');
    setReviewNote('');
    try {
      const result = await tenantApi.adminApplication(id);
      setDetail(result.application);
    } catch (cause) {
      toast.push({ title: t('admin.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setDetailLoading(false);
    }
  };

  const openDocument = async (applicationId: string, documentId: string) => {
    try {
      const blob = await tenantApi.adminDocument(applicationId, documentId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      toast.push({ title: t('admin.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const submitReview = async () => {
    if (!detail) return;
    setReviewError(null);
    if (reviewAction === 'reject' && reviewNote.trim().length < 3) {
      setReviewError(t('admin.rejectReasonRequired'));
      return;
    }
    if (reviewAction === 'request_documents' && reviewNote.trim().length < 3) {
      setReviewError(t('admin.requestNoteRequired'));
      return;
    }
    setReviewPending(true);
    try {
      const result = (await tenantApi.reviewApplication(detail.id, reviewAction, {
        ...(reviewAction === 'reject' ? { reason: reviewNote.trim() } : {}),
        note: reviewNote.trim() || undefined,
      })) as {
        application?: { reference?: string };
        credentials?: { email?: string; temporaryPassword?: string };
      };
      if (reviewAction === 'approve') {
        const credentials = result.credentials;
        toast.push({
          title: t('admin.approveSuccess'),
          description: credentials?.temporaryPassword
            ? t('admin.approveCredentials', {
                email: credentials.email ?? '',
                password: credentials.temporaryPassword,
              })
            : t('admin.approveExistingAccount', { email: credentials?.email ?? '' }),
        });
      } else if (reviewAction === 'reject') {
        toast.push({ title: t('admin.rejectSuccess') });
      } else {
        toast.push({ title: t('admin.requestSuccess') });
      }
      setDetail(null);
      await loadAll(query);
    } catch (cause) {
      setReviewError(errorMessage(cause));
    } finally {
      setReviewPending(false);
    }
  };

  const submitSuspend = async () => {
    if (!suspendTarget) return;
    if (suspendReason.trim().length < 3) return;
    setSuspendPending(true);
    try {
      await tenantApi.suspendTenant(suspendTarget.id, suspendReason.trim());
      toast.push({ title: t('admin.suspendSuccess'), description: suspendTarget.brandName });
      setSuspendTarget(null);
      setSuspendReason('');
      await loadAll(query);
    } catch (cause) {
      toast.push({ title: t('admin.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSuspendPending(false);
    }
  };

  const reactivate = async (tenant: AdminTenantRow) => {
    try {
      await tenantApi.reactivateTenant(tenant.id, t('admin.reactivateNote'));
      toast.push({ title: t('admin.reactivateSuccess'), description: tenant.brandName });
      await loadAll(query);
    } catch (cause) {
      toast.push({ title: t('admin.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  if (status === 'loading') {
    return (
      <div className="console-gate">
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="console-gate">
        <Card>
          <CardBody>
            <EmptyState
              icon="lock"
              title={t('admin.authTitle')}
              description={t('admin.authBody')}
              action={
                <Button onClick={() => navigate('/connexion')} iconRight="arrow-right">
                  {t('admin.authCta')}
                </Button>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="console-gate">
        <Card>
          <CardBody>
            <EmptyState
              icon="shield"
              title={t('admin.forbiddenTitle')}
              description={t('admin.forbiddenBody')}
              action={
                <Button variant="outline" onClick={() => navigate('/')}>
                  {t('admin.backSite')}
                </Button>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const navGroups: NavGroup[] = [
    {
      label: t('admin.navPlatform'),
      items: [
        { id: 'overview', label: t('admin.tabOverview'), icon: 'grid', active: tab === 'overview', onClick: () => setTab('overview') },
        {
          id: 'applications',
          label: t('admin.tabApplications'),
          icon: 'receipt',
          active: tab === 'applications',
          badge: counts.submitted ?? 0,
          onClick: () => setTab('applications'),
        },
        { id: 'tenants', label: t('admin.tabTenants'), icon: 'home', active: tab === 'tenants', onClick: () => setTab('tenants') },
        { id: 'payments', label: t('paymentsAdmin.nav'), icon: 'card', active: tab === 'payments', onClick: () => setTab('payments') },
      ],
    },
    {
      label: t('admin.navOps'),
      items: [
        { id: 'commissions', label: t('admin.tabCommissions'), icon: 'banknote', active: tab === 'commissions', onClick: () => setTab('commissions') },
        { id: 'supervision', label: t('admin.tabSupervision'), icon: 'monitor', active: tab === 'supervision', onClick: () => setTab('supervision') },
        { id: 'settings', label: t('admin.tabSettings'), icon: 'settings', active: tab === 'settings', onClick: () => setTab('settings') },
      ],
    },
    {
      label: t('admin.navAccount'),
      items: [
        { id: 'site', label: t('admin.backSite'), icon: 'arrow-left', onClick: () => navigate('/') },
        { id: 'logout', label: t('admin.logout'), icon: 'logout', onClick: () => void signOut().then(() => navigate('/connexion')) },
      ],
    },
  ];

  const columns: Array<Column<ApplicationListItem>> = [
    {
      key: 'reference',
      header: t('admin.colReference'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.reference}</strong>
          <span>{row.establishment.brandName}</span>
        </div>
      ),
    },
    {
      key: 'legal',
      header: t('admin.colLegal'),
      render: (row) => (
        <div className="console-cell">
          <span>{row.legalName}</span>
          <span>{row.city ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'manager',
      header: t('admin.colManager'),
      render: (row) => (
        <div className="console-cell">
          <span>{row.managerName}</span>
          <span>{row.managerEmail}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: t('admin.colPlan'),
      render: (row) => <Badge tone="neutral">{PLAN_LABEL[row.plan] ?? row.plan}</Badge>,
    },
    {
      key: 'status',
      header: t('admin.colStatus'),
      render: (row) => (
        <Badge tone={statusTone(row.status)} dot>
          {t(`admin.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: t('admin.colDate'),
      render: (row) => <span>{formatDate(row.submittedAt ?? row.createdAt, locale)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="soft" onClick={() => void openDetail(row.id)}>
          {t('admin.inspect')}
        </Button>
      ),
    },
  ];

  const tenantColumns: Array<Column<AdminTenantRow>> = [
    {
      key: 'tenant',
      header: t('admin.colTenant'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.brandName}</strong>
          <span>{row.subdomain}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: t('admin.colPlan'),
      render: (row) => (
        <div className="console-cell">
          <Badge tone="neutral">{PLAN_LABEL[row.plan] ?? row.plan}</Badge>
          <span>{row.subscriptionStatus ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'sites',
      header: t('admin.colSites'),
      align: 'right',
      render: (row) => <span>{row.sites}</span>,
    },
    {
      key: 'manager',
      header: t('admin.colManager'),
      render: (row) => <span>{row.managerEmail}</span>,
    },
    {
      key: 'status',
      header: t('admin.colStatus'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'danger'} dot>
          {row.status === 'active' ? t('admin.tenantActive') : t('admin.tenantSuspended')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.status === 'active' ? (
          <Button size="sm" variant="danger-soft" onClick={() => { setSuspendTarget(row); setSuspendReason(''); }}>
            {t('admin.suspend')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void reactivate(row)}>
            {t('admin.reactivate')}
          </Button>
        ),
    },
  ];

  const tabTitle =
    tab === 'overview' ? t('admin.overviewTitle')
      : tab === 'applications' ? t('admin.applicationsTitle')
        : tab === 'payments' ? t('paymentsAdmin.title')
          : tab === 'commissions' ? t('adminCommissions.title')
            : tab === 'supervision' ? t('adminSupervision.title')
              : tab === 'settings' ? t('adminSettings.title')
                : t('admin.tenantsTitle');

  const tabSubtitle =
    tab === 'applications' ? t('admin.subtitleApplications')
      : tab === 'tenants' ? t('admin.subtitleTenants')
        : tab === 'payments' ? t('paymentsAdmin.subtitle')
          : tab === 'commissions' ? t('adminCommissions.subtitle')
            : tab === 'supervision' ? t('adminSupervision.subtitle')
              : tab === 'settings' ? t('adminSettings.subtitle')
                : t('admin.subtitle');

  return (
    <div className="console-page">
      <Sidebar
        brand={
          <a href="#/" className="console-brand" aria-label="RESTO-HUB">
            <span className="console-brand__mark">RH</span>
            <span className="console-brand__text">
              RESTO-HUB
              <small>{t('admin.platformBadge')}</small>
            </span>
          </a>
        }
        groups={navGroups}
        footer={
          <div className="console-user">
            <span className="console-user__avatar">{(user?.name ?? '?').slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="console-user__name">{user?.name}</div>
              <div className="console-user__role">{t('admin.platformBadge')}</div>
            </div>
          </div>
        }
        navLabel={t('admin.navLabel')}
      />

      <div className="rh-main console-main">
        <header className="rh-topbar">
          <div>
            <div className="rh-topbar__title">{tabTitle}</div>
            <div className="rh-topbar__subtitle">{tabSubtitle}</div>
          </div>
          <div className="rh-topbar__actions console-topbar-actions">
            <SegmentedControl<Locale>
              ariaLabel={t('nav.language')}
              value={locale}
              onChange={setLocale}
              options={[
                { value: 'fr', label: 'FR', ariaLabel: 'Français' },
                { value: 'en', label: 'EN', ariaLabel: 'English' },
              ]}
            />
            <Button
              variant="ghost"
              iconOnly
              aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
              iconLeft={theme === 'light' ? 'moon' : 'sun'}
              onClick={toggleTheme}
            />
            <Button variant="ghost" iconOnly aria-label={t('admin.logout')} iconLeft="logout" onClick={() => void signOut().then(() => navigate('/connexion'))} />
          </div>
        </header>

        <MobileTabs
          label={t('admin.navLabel')}
          items={[
            { id: 'overview', label: t('admin.tabOverview'), icon: 'grid', active: tab === 'overview', onClick: () => setTab('overview') },
            { id: 'applications', label: t('admin.tabApplications'), icon: 'receipt', active: tab === 'applications', badge: counts.submitted ?? 0, onClick: () => setTab('applications') },
            { id: 'tenants', label: t('admin.tabTenants'), icon: 'home', active: tab === 'tenants', onClick: () => setTab('tenants') },
            { id: 'payments', label: t('paymentsAdmin.nav'), icon: 'card', active: tab === 'payments', onClick: () => setTab('payments') },
            { id: 'commissions', label: t('admin.tabCommissions'), icon: 'banknote', active: tab === 'commissions', onClick: () => setTab('commissions') },
            { id: 'supervision', label: t('admin.tabSupervision'), icon: 'monitor', active: tab === 'supervision', onClick: () => setTab('supervision') },
            { id: 'settings', label: t('admin.tabSettings'), icon: 'settings', active: tab === 'settings', onClick: () => setTab('settings') },
          ]}
        />

        <main className="rh-content">
          {error && (
            <Card className="console-alert">
              <CardBody>
                <p className="auth-error" role="alert">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void loadAll(query)}>
                  {t('admin.retry')}
                </Button>
              </CardBody>
            </Card>
          )}

          {tab === 'overview' && (
            <>
              <div className="console-stats">
                <StatCard
                  label={t('admin.statPending')}
                  value={loading || !overview ? '—' : overview.applications.pending + overview.applications.infoRequested}
                  icon="receipt"
                  meta={t('admin.statPendingMeta', { info: overview?.applications.infoRequested ?? 0 })}
                />
                <StatCard
                  label={t('admin.statTenants')}
                  value={loading || !overview ? '—' : overview.tenants.active}
                  icon="home"
                  meta={t('admin.statTenantsMeta', { suspended: overview?.tenants.suspended ?? 0 })}
                />
                <StatCard
                  label={t('admin.statMrr')}
                  value={loading || !overview ? '—' : formatXof(overview.billing.mrrXof, locale)}
                  icon="banknote"
                  meta={t('admin.statMrrMeta', { collected: formatXof(overview?.billing.collectedXof ?? 0, locale) })}
                />
                <StatCard
                  label={t('admin.statAudit')}
                  value={loading || !overview ? '—' : overview.audit.entries}
                  icon="shield"
                  meta={
                    overview ? (
                      <Badge tone={overview.audit.integrity ? 'success' : 'danger'} dot>
                        {overview.audit.integrity ? t('admin.auditOk') : t('admin.auditBroken')}
                      </Badge>
                    ) : undefined
                  }
                />
              </div>

              <div className="console-2col">
                <Card>
                  <CardHeader
                    title={t('admin.queueTitle')}
                    subtitle={t('admin.queueSubtitle')}
                    action={
                      <Button size="sm" variant="ghost" onClick={() => { setStatusFilter('submitted'); setTab('applications'); }}>
                        {t('admin.viewAll')}
                      </Button>
                    }
                  />
                  <CardBody>
                    {applications.filter((row) => row.status === 'submitted' || row.status === 'info_requested').length === 0 ? (
                      <EmptyState icon="check-circle" title={t('admin.queueEmptyTitle')} description={t('admin.queueEmptyBody')} />
                    ) : (
                      <ul className="console-queue">
                        {applications
                          .filter((row) => row.status === 'submitted' || row.status === 'info_requested')
                          .slice(0, 6)
                          .map((row) => (
                            <li key={row.id}>
                              <div>
                                <strong>{row.establishment.brandName}</strong>
                                <span>{row.reference} · {row.city ?? '—'}</span>
                              </div>
                              <Badge tone={statusTone(row.status)} dot>{t(`admin.status.${row.status}`)}</Badge>
                              <Button size="sm" variant="soft" onClick={() => void openDetail(row.id)}>
                                {t('admin.inspect')}
                              </Button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t('admin.billingTitle')} subtitle={t('admin.billingSubtitle')} />
                  <CardBody>
                    <dl className="console-kv">
                      <div>
                        <dt>{t('admin.paidInvoices')}</dt>
                        <dd>{overview?.billing.paidInvoices ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('admin.pendingInvoices')}</dt>
                        <dd>{overview?.billing.pendingInvoices ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('admin.overdueInvoices')}</dt>
                        <dd>{overview?.billing.overdueInvoices ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('admin.approvedApps')}</dt>
                        <dd>{overview?.applications.approved ?? '—'}</dd>
                      </div>
                    </dl>
                  </CardBody>
                </Card>
              </div>
            </>
          )}

          {tab === 'applications' && (
            <Card>
              <CardHeader
                title={t('admin.applicationsTitle')}
                subtitle={t('admin.applicationsSubtitle')}
                action={
                  <Button size="sm" variant="outline" iconLeft="refresh" onClick={() => void loadAll(query)} loading={loading}>
                    {t('admin.refresh')}
                  </Button>
                }
              />
              <CardBody>
                <div className="console-toolbar">
                  <div className="console-filters">
                    {(
                      [
                        ['submitted', t('admin.status.submitted')],
                        ['info_requested', t('admin.status.info_requested')],
                        ['approved', t('admin.status.approved')],
                        ['rejected', t('admin.status.rejected')],
                        ['draft', t('admin.status.draft')],
                        ['all', t('admin.filterAll')],
                      ] as Array<[typeof statusFilter, string]>
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={statusFilter === value ? 'console-filter is-active' : 'console-filter'}
                        onClick={() => setStatusFilter(value)}
                      >
                        {label}
                        {value !== 'all' && <span>{counts[value] ?? 0}</span>}
                      </button>
                    ))}
                  </div>
                  <form
                    className="console-search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loadAll(query);
                    }}
                  >
                    <Input
                      aria-label={t('admin.search')}
                      placeholder={t('admin.searchPlaceholder')}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <Button type="submit" size="sm" variant="outline" iconLeft="search">
                      {t('admin.search')}
                    </Button>
                  </form>
                </div>

                {loading ? (
                  <SkeletonText lines={6} />
                ) : applications.length === 0 ? (
                  <EmptyState icon="receipt" title={t('admin.appsEmptyTitle')} description={t('admin.appsEmptyBody')} />
                ) : (
                  <DataTable
                    columns={columns}
                    rows={applications}
                    getRowId={(row) => row.id}
                    caption={t('admin.applicationsTitle')}
                  />
                )}
              </CardBody>
            </Card>
          )}

          {tab === 'tenants' && (
            <Card>
              <CardHeader
                title={t('admin.tenantsTitle')}
                subtitle={t('admin.tenantsSubtitle')}
                action={
                  <Button size="sm" variant="outline" iconLeft="refresh" onClick={() => void loadAll(query)} loading={loading}>
                    {t('admin.refresh')}
                  </Button>
                }
              />
              <CardBody>
                {loading ? (
                  <SkeletonText lines={6} />
                ) : tenants.length === 0 ? (
                  <EmptyState icon="home" title={t('admin.tenantsEmptyTitle')} description={t('admin.tenantsEmptyBody')} />
                ) : (
                  <DataTable
                    columns={tenantColumns}
                    rows={tenants}
                    getRowId={(row) => row.id}
                    caption={t('admin.tenantsTitle')}
                  />
                )}
              </CardBody>
            </Card>
          )}
          {tab === 'payments' && <PaymentsPlatformTab locale={locale} />}
          {tab === 'commissions' && <AdminCommissionsTab locale={locale} />}
          {tab === 'supervision' && <AdminSupervisionTab locale={locale} />}
          {tab === 'settings' && <AdminSettingsTab locale={locale} />}
        </main>
      </div>

      <Modal
        open={Boolean(detail) || detailLoading}
        onClose={() => { setDetail(null); setDetailLoading(false); }}
        title={detail ? `${detail.reference} — ${detail.establishment.brandName}` : t('admin.loading')}
        description={detail ? t(`admin.status.${detail.status}`) : undefined}
        size="lg"
        footer={
          detail && ['submitted', 'info_requested'].includes(detail.status) ? (
            <>
              <Button variant="ghost" onClick={() => setDetail(null)}>{t('common.cancel')}</Button>
              <Button onClick={() => void submitReview()} loading={reviewPending}>
                {reviewAction === 'approve'
                  ? t('admin.confirmApprove')
                  : reviewAction === 'reject'
                    ? t('admin.confirmReject')
                    : t('admin.confirmRequest')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setDetail(null)}>{t('common.close')}</Button>
          )
        }
      >
        {detailLoading || !detail ? (
          <SkeletonText lines={8} />
        ) : (
          <div className="console-detail">
            <div className="console-detail__badges">
              <Badge tone={statusTone(detail.status)} dot>{t(`admin.status.${detail.status}`)}</Badge>
              <Badge tone="neutral">{PLAN_LABEL[detail.plan] ?? detail.plan}</Badge>
              <Badge tone="neutral">{detail.currency}</Badge>
              <Badge tone="neutral">{detail.languages.map((entry) => entry.toUpperCase()).join(' · ')}</Badge>
            </div>
            <dl className="reg-recap">
              <div>
                <dt>{t('admin.legalName')}</dt>
                <dd>{String(detail.establishmentFull.legalName ?? '—')}</dd>
              </div>
              <div>
                <dt>NIF / RCCM</dt>
                <dd>{String(detail.establishmentFull.nif ?? '—')} · {String(detail.establishmentFull.rccm ?? '—')}</dd>
              </div>
              <div>
                <dt>{t('admin.address')}</dt>
                <dd>
                  {(() => {
                    const address = detail.establishmentFull.address as Record<string, string> | undefined;
                    return address ? [address.street, address.district, address.city].filter(Boolean).join(', ') : '—';
                  })()}
                </dd>
              </div>
              <div>
                <dt>{t('admin.contact')}</dt>
                <dd>
                  {(() => {
                    const contact = detail.establishmentFull.contact as Record<string, string> | undefined;
                    return contact ? `${contact.phone ?? '—'} · ${contact.email ?? '—'}` : '—';
                  })()}
                </dd>
              </div>
              <div>
                <dt>{t('admin.manager')}</dt>
                <dd>
                  {detail.managerFull.name ?? '—'} · {detail.managerFull.email ?? '—'} · {detail.managerFull.phone ?? '—'}
                </dd>
              </div>
              <div>
                <dt>{t('admin.submittedAt')}</dt>
                <dd>{detail.submittedAt ? formatDate(detail.submittedAt, locale) : '—'}</dd>
              </div>
            </dl>

            {(() => {
              const logoUrl =
                typeof detail.establishmentFull.logoUrl === 'string' ? detail.establishmentFull.logoUrl : '';
              const photos = Array.isArray(detail.establishmentFull.photos)
                ? (detail.establishmentFull.photos as string[])
                : [];
              if (!logoUrl && photos.length === 0) return null;
              return (
                <div className="console-gallery">
                  <h3 className="reg-subtitle reg-subtitle--sm">{t('admin.visuals')}</h3>
                  <div className="console-gallery__grid">
                    {logoUrl && (
                      <figure className="console-gallery__item console-gallery__item--logo">
                        <img src={logoUrl} alt={t('admin.logoAlt')} loading="lazy" />
                        <figcaption>{t('admin.logo')}</figcaption>
                      </figure>
                    )}
                    {photos.map((photo, index) => (
                      <figure className="console-gallery__item" key={`${photo}-${index}`}>
                        <img src={photo} alt={t('admin.photoAlt', { index: index + 1 })} loading="lazy" />
                        <figcaption>{t('admin.photoAlt', { index: index + 1 })}</figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="console-docs">
              <h3 className="reg-subtitle reg-subtitle--sm">{t('admin.documents')}</h3>
              {detail.documents.length === 0 ? (
                <p className="reg-note">{t('admin.noDocuments')}</p>
              ) : (
                <ul>
                  {detail.documents.map((doc) => (
                    <li key={doc.id}>
                      <div>
                        <strong>{t(`register.doc.${doc.type}`)}</strong>
                        <span>{doc.fileName} · {Math.round(doc.sizeBytes / 1024)} Ko</span>
                      </div>
                      <Button size="sm" variant="outline" iconLeft="download" onClick={() => void openDocument(detail.id, doc.id)}>
                        {t('admin.openDocument')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {detail.review.notes.length > 0 && (
              <div className="reg-timeline">
                <h3 className="reg-subtitle reg-subtitle--sm">{t('admin.history')}</h3>
                <ul>
                  {detail.review.notes.map((note, index) => (
                    <li key={`${note.at}-${index}`}>
                      <strong>{t(`register.reviewAction.${note.action}`)}</strong>
                      <span>{formatDate(note.at, locale)}</span>
                      {(note.reason || note.note) && <p>{note.reason ?? note.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {['submitted', 'info_requested'].includes(detail.status) && (
              <div className="console-review">
                <h3 className="reg-subtitle reg-subtitle--sm">{t('admin.reviewTitle')}</h3>
                <div className="console-review__actions">
                  {(
                    [
                      ['approve', t('admin.actionApprove'), 'check-circle'],
                      ['request_documents', t('admin.actionRequest'), 'edit'],
                      ['reject', t('admin.actionReject'), 'x-circle'],
                    ] as Array<['approve' | 'reject' | 'request_documents', string, 'check-circle' | 'edit' | 'x-circle']>
                  ).map(([value, label, icon]) => (
                    <button
                      key={value}
                      type="button"
                      className={reviewAction === value ? `console-review__btn is-active is-${value}` : 'console-review__btn'}
                      onClick={() => { setReviewAction(value); setReviewError(null); }}
                    >
                      <span className={`console-review__icon is-${value}`} aria-hidden="true">{icon === 'check-circle' ? '✓' : icon === 'x-circle' ? '✕' : '✎'}</span>
                      {label}
                    </button>
                  ))}
                </div>
                <Textarea
                  label={
                    reviewAction === 'reject'
                      ? t('admin.reasonLabel')
                      : reviewAction === 'request_documents'
                        ? t('admin.requestLabel')
                        : t('admin.noteLabel')
                  }
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  hint={
                    reviewAction === 'reject'
                      ? t('admin.reasonHint')
                      : reviewAction === 'request_documents'
                        ? t('admin.requestHint')
                        : t('admin.noteHint')
                  }
                  rows={3}
                  error={reviewError ?? undefined}
                />
                {reviewAction === 'approve' && (
                  <p className="reg-note">{t('admin.approveHint')}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        title={t('admin.suspendTitle', { name: suspendTarget?.brandName ?? '' })}
        description={t('admin.suspendBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuspendTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => void submitSuspend()} loading={suspendPending} disabled={suspendReason.trim().length < 3}>
              {t('admin.suspendConfirm')}
            </Button>
          </>
        }
      >
        <Textarea
          label={t('admin.suspendReason')}
          value={suspendReason}
          onChange={(event) => setSuspendReason(event.target.value)}
          hint={t('admin.suspendReasonHint')}
          rows={3}
        />
        <p className="reg-note">{t('admin.suspendNote')}</p>
      </Modal>
    </div>
  );
}
