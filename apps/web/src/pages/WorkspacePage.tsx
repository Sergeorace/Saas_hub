import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
  Sidebar,
  SkeletonText,
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
import { CatalogTab } from './CatalogTab';
import { FloorTab } from './FloorTab';
import { OrdersTab } from './OrdersTab';
import { KdsTab } from './KdsTab';
import { PosTab } from './PosTab';
import { PaymentsTab } from './PaymentsTab';
import { StaffTab } from './StaffTab';
import { PayrollTab } from './PayrollTab';
import { StocksTab } from './StocksTab';
import { MarketingTab } from './MarketingTab';
import { ReportsTab } from './ReportsTab';
import { navigate, useRoute } from '../lib/router';
import { useSession } from '../lib/session';
import {
  errorMessage,
  tenantApi,
  type EstablishmentHours,
  type Invoice,
  type Onboarding,
  type Plan,
  type Site,
  type Subscription,
  type TeamMember,
  type Tenant,
  type TenantSummary,
} from '../lib/api';

type Tab =
  | 'onboarding'
  | 'branding'
  | 'sites'
  | 'catalog'
  | 'floor'
  | 'orders'
  | 'kds'
  | 'pos'
  | 'payments'
  | 'staff'
  | 'payroll'
  | 'stocks'
  | 'marketing'
  | 'reports'
  | 'subscription'
  | 'team';

const DAYS = [
  { key: 'lun', fr: 'Lundi', en: 'Monday' },
  { key: 'mar', fr: 'Mardi', en: 'Tuesday' },
  { key: 'mer', fr: 'Mercredi', en: 'Wednesday' },
  { key: 'jeu', fr: 'Jeudi', en: 'Thursday' },
  { key: 'ven', fr: 'Vendredi', en: 'Friday' },
  { key: 'sam', fr: 'Samedi', en: 'Saturday' },
  { key: 'dim', fr: 'Dimanche', en: 'Sunday' },
];

const SUBSCRIPTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  suspended: 'danger',
  canceled: 'neutral',
};

const INVOICE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  overdue: 'danger',
  void: 'neutral',
};

export function WorkspacePage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { status, user, claims, signOut } = useSession();
  const route = useRoute();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('onboarding');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [brandForm, setBrandForm] = useState<{
    brandName: string;
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    languages: string[];
    currency: string;
    hours: EstablishmentHours[];
  } | null>(null);
  const [brandPending, setBrandPending] = useState(false);

  const [siteForm, setSiteForm] = useState({ name: '', address: '', phone: '' });
  const [sitePending, setSitePending] = useState(false);

  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<string | null>(null);

  const myTenants = useCallback(async () => {
    const result = await tenantApi.myTenants();
    setTenants(result.items);
    const requested = route.params.get('tenant');
    const allowed = Object.keys(claims?.tenantPermissions ?? {});
    const candidate =
      result.items.find((item) => item.id === requested) ??
      result.items.find((item) => allowed.includes(item.id)) ??
      result.items[0];
    setCurrentId(candidate?.id ?? null);
    return candidate?.id ?? null;
  }, [route.params, claims]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    (async () => {
      try {
        const id = await myTenants();
        if (cancelled || !id) {
          setLoading(false);
          return;
        }
        await loadTenant(id);
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, myTenants]);

  const loadTenant = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [detail, onboardingResult, subscriptionResult, teamResult] = await Promise.all([
        tenantApi.tenant(id),
        tenantApi.onboarding(id),
        tenantApi.subscription(id),
        tenantApi.team(id).catch(() => ({ items: [] })),
      ]);
      setTenant(detail.tenant);
      setPlan(detail.plan);
      setSites(detail.sites);
      setSubscription(subscriptionResult.subscription ?? detail.subscription ?? null);
      setInvoices(subscriptionResult.invoices);
      setPlans(subscriptionResult.plans);
      setOnboarding(onboardingResult);
      setTeam(Array.isArray(teamResult) ? teamResult : (teamResult.items ?? []));
      setBrandForm({
        brandName: detail.tenant.brandName,
        logoUrl: detail.tenant.settings.logoUrl ?? '',
        primaryColor: detail.tenant.settings.primaryColor,
        secondaryColor: detail.tenant.settings.secondaryColor,
        languages: detail.tenant.settings.languages ?? ['fr'],
        currency: detail.tenant.settings.currency ?? 'XOF',
        hours: detail.tenant.settings.hours?.length
          ? detail.tenant.settings.hours
          : DAYS.map((day) => ({ day: day.key, open: '11:00', close: '23:00', closed: day.key === 'dim' })),
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const refreshOnboarding = async (id: string) => {
    const result = await tenantApi.onboarding(id);
    setOnboarding(result);
  };

  const saveBranding = async () => {
    if (!tenant || !brandForm) return;
    setBrandPending(true);
    try {
      const result = await tenantApi.updateBranding(tenant.id, {
        brandName: brandForm.brandName,
        logoUrl: brandForm.logoUrl || undefined,
        primaryColor: brandForm.primaryColor,
        secondaryColor: brandForm.secondaryColor,
        languages: brandForm.languages,
        currency: brandForm.currency,
        hours: brandForm.hours,
      });
      setTenant((current) => (current ? { ...current, brandName: result.tenant.brandName, settings: result.tenant.settings } : current));
      toast.push({ title: t('workspace.brandingSaved') });
      await refreshOnboarding(tenant.id);
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setBrandPending(false);
    }
  };

  const addSite = async () => {
    if (!tenant) return;
    if (siteForm.name.trim().length < 2 || siteForm.address.trim().length < 3) {
      toast.push({ title: t('workspace.siteInvalid'), tone: 'error' });
      return;
    }
    setSitePending(true);
    try {
      const result = await tenantApi.createSite(tenant.id, {
        name: siteForm.name.trim(),
        address: siteForm.address.trim(),
        phone: siteForm.phone.trim() || undefined,
      });
      setSites((current) => [...current, result.site]);
      setSiteForm({ name: '', address: '', phone: '' });
      toast.push({ title: t('workspace.siteAdded') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setSitePending(false);
    }
  };

  const removeSite = async (site: Site) => {
    if (!tenant) return;
    try {
      await tenantApi.deleteSite(tenant.id, site.id);
      setSites((current) => current.filter((entry) => entry.id !== site.id));
      toast.push({ title: t('workspace.siteDeleted') });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const checkout = async (code: string) => {
    if (!tenant) return;
    setCheckoutPlan(code);
    try {
      const result = await tenantApi.checkout(tenant.id, code as Plan['code']);
      setInvoices((current) => [result.invoice, ...current]);
      toast.push({ title: t('workspace.invoiceCreated'), description: result.invoice.number });
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setCheckoutPlan(null);
    }
  };

  const payDemo = async (invoice: Invoice) => {
    if (!tenant) return;
    setPayingInvoice(invoice.id);
    try {
      const result = await tenantApi.payInvoiceDemo(tenant.id, invoice.id);
      setInvoices((current) => current.map((entry) => (entry.id === invoice.id ? result.invoice : entry)));
      setSubscription((current) => (current ? { ...current, status: 'active' } : current));
      toast.push({ title: t('workspace.invoicePaid'), description: result.invoice.number });
      await refreshOnboarding(tenant.id);
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPayingInvoice(null);
    }
  };

  const subdomain = tenant?.subdomain ?? '';
  const copySubdomain = () => {
    if (!subdomain) return;
    void navigator.clipboard?.writeText(`https://${subdomain}`);
    toast.push({ title: t('workspace.subdomainCopied') });
  };

  const previewStyle = useMemo<CSSProperties>(() => {
    const primary = brandForm?.primaryColor ?? '#C2410C';
    const secondary = brandForm?.secondaryColor ?? '#0C6750';
    return {
      '--preview-primary': primary,
      '--preview-secondary': secondary,
    } as CSSProperties;
  }, [brandForm?.primaryColor, brandForm?.secondaryColor]);

  const invoiceColumns: Array<Column<Invoice>> = [
    { key: 'number', header: t('workspace.colInvoice'), render: (row) => <strong>{row.number}</strong> },
    { key: 'period', header: t('workspace.colPeriod'), render: (row) => <span>{formatDate(row.periodStart, locale)} — {formatDate(row.periodEnd, locale)}</span> },
    { key: 'amount', header: t('workspace.colAmount'), align: 'right', render: (row) => formatXof(row.amountXof, locale) },
    {
      key: 'status',
      header: t('workspace.colStatus'),
      render: (row) => <Badge tone={INVOICE_TONE[row.status] ?? 'neutral'} dot>{t(`workspace.invoiceStatus.${row.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.status === 'pending' || row.status === 'overdue' ? (
          <Button size="sm" variant="soft" loading={payingInvoice === row.id} onClick={() => void payDemo(row)}>
            {t('workspace.payDemo')}
          </Button>
        ) : row.status === 'paid' ? (
          <span className="console-muted">{row.paidAt ? formatDate(row.paidAt, locale) : '—'}</span>
        ) : null,
    },
  ];

  const teamColumns: Array<Column<TeamMember>> = [
    { key: 'name', header: t('workspace.colMember'), render: (row) => (
      <div className="console-cell">
        <strong>{row.name}</strong>
        <span>{row.email ?? row.phone ?? '—'}</span>
      </div>
    ) },
    { key: 'roles', header: t('workspace.colRoles'), render: (row) => (
      <div className="console-roles">
        {(row.roles ?? []).map((role) => <Badge key={role} tone="neutral">{t(`workspace.role.${role}`) === `workspace.role.${role}` ? role : t(`workspace.role.${role}`)}</Badge>)}
      </div>
    ) },
    { key: 'mfa', header: 'MFA', render: (row) => (
      <Badge tone={row.mfaEnabled ? 'success' : 'warning'} dot>{row.mfaEnabled ? t('workspace.mfaOn') : t('workspace.mfaOff')}</Badge>
    ) },
  ];

  if (status === 'loading') {
    return (
      <div className="console-gate"><SkeletonText lines={4} /></div>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="console-gate">
        <Card>
          <CardBody>
            <EmptyState
              icon="lock"
              title={t('workspace.authTitle')}
              description={t('workspace.authBody')}
              action={<Button onClick={() => navigate('/connexion')} iconRight="arrow-right">{t('workspace.authCta')}</Button>}
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!loading && tenants.length === 0) {
    return (
      <div className="console-gate">
        <Card>
          <CardBody>
            <EmptyState
              icon="home"
              title={t('workspace.noTenantTitle')}
              description={t('workspace.noTenantBody')}
              action={
                <div className="console-gate__actions">
                  <Button onClick={() => navigate('/inscription')}>{t('workspace.noTenantCta')}</Button>
                  <Button variant="outline" onClick={() => navigate('/admin')}>{t('workspace.noTenantAdmin')}</Button>
                </div>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const permissions = (tenant && claims?.tenantPermissions[tenant.id]) || [];
  const canSeeOrders = permissions.includes('order:view');
  const canSeeRegister =
    permissions.includes('payment:view') ||
    permissions.includes('pos:operate') ||
    permissions.includes('pos:close');
  const canSeeStaff = permissions.includes('staff:view');
  const canSeePayroll = permissions.includes('payroll:view');
  const canSeeStocks = permissions.includes('inventory:view');
  const canSeeMarketing = permissions.includes('loyalty:view');
  const canSeeReports = permissions.includes('report:view');
  const actorId = user?.id ?? 'unknown';

  const navGroups: NavGroup[] = [
    {
      label: t('workspace.navConfigure'),
      items: [
        { id: 'onboarding', label: t('workspace.tabOnboarding'), icon: 'check-circle', active: tab === 'onboarding', onClick: () => setTab('onboarding') },
        { id: 'branding', label: t('workspace.tabBranding'), icon: 'sparkles', active: tab === 'branding', onClick: () => setTab('branding') },
        { id: 'sites', label: t('workspace.tabSites'), icon: 'home', active: tab === 'sites', badge: sites.length, onClick: () => setTab('sites') },
      ],
    },
    {
      label: t('workspace.navOperations'),
      items: [
        { id: 'catalog', label: t('workspace.tabCatalog'), icon: 'utensils', active: tab === 'catalog', onClick: () => setTab('catalog') },
        { id: 'floor', label: t('workspace.tabFloor'), icon: 'grid', active: tab === 'floor', onClick: () => setTab('floor') },
        ...(canSeeOrders
          ? [
              { id: 'orders', label: t('orders.nav'), icon: 'receipt' as const, active: tab === 'orders', onClick: () => setTab('orders') },
              { id: 'kds', label: t('kds.nav'), icon: 'chef' as const, active: tab === 'kds', onClick: () => setTab('kds') },
            ]
          : []),
        ...(canSeeRegister
          ? [
              { id: 'pos', label: t('pos.nav'), icon: 'banknote' as const, active: tab === 'pos', onClick: () => setTab('pos') },
              { id: 'payments', label: t('payments.nav'), icon: 'card' as const, active: tab === 'payments', onClick: () => setTab('payments') },
            ]
          : []),
      ],
    },
    {
      label: t('workspace.navBusiness'),
      items: [
        { id: 'subscription', label: t('workspace.tabSubscription'), icon: 'wallet', active: tab === 'subscription', onClick: () => setTab('subscription') },
        { id: 'team', label: t('workspace.tabTeam'), icon: 'users', active: tab === 'team', onClick: () => setTab('team') },
        ...(canSeeStaff
          ? [{ id: 'staff', label: t('staff.title'), icon: 'users' as const, active: tab === 'staff', onClick: () => setTab('staff') }]
          : []),
        ...(canSeePayroll
          ? [{ id: 'payroll', label: t('payroll.title'), icon: 'banknote' as const, active: tab === 'payroll', onClick: () => setTab('payroll') }]
          : []),
        ...(canSeeStocks
          ? [{ id: 'stocks', label: t('stocks.nav'), icon: 'box' as const, active: tab === 'stocks', onClick: () => setTab('stocks') }]
          : []),
        ...(canSeeMarketing
          ? [{ id: 'marketing', label: t('marketing.nav'), icon: 'gift' as const, active: tab === 'marketing', onClick: () => setTab('marketing') }]
          : []),
        ...(canSeeReports
          ? [{ id: 'reports', label: t('reports.nav'), icon: 'chart' as const, active: tab === 'reports', onClick: () => setTab('reports') }]
          : []),
      ],
    },
    {
      label: t('workspace.navAccount'),
      items: [
        { id: 'site', label: t('workspace.backSite'), icon: 'arrow-left', onClick: () => navigate('/') },
        { id: 'logout', label: t('workspace.logout'), icon: 'logout', onClick: () => void signOut().then(() => navigate('/connexion')) },
      ],
    },
  ];

  const tabTitle =
    tab === 'onboarding' ? t('workspace.onboardingTitle')
      : tab === 'branding' ? t('workspace.brandingTitle')
        : tab === 'sites' ? t('workspace.sitesTitle')
          : tab === 'catalog' ? t('catalog.title')
            : tab === 'floor' ? t('floor.title')
              : tab === 'orders' ? t('orders.title')
                : tab === 'kds' ? t('kds.title')
                  : tab === 'pos' ? t('pos.title')
                    : tab === 'payments' ? t('payments.title')
                      : tab === 'staff' ? t('staff.title')
                        : tab === 'payroll' ? t('payroll.title')
                          : tab === 'stocks' ? t('stocks.title')
                            : tab === 'marketing' ? t('marketing.title')
                              : tab === 'reports' ? t('reports.title')
                                : tab === 'subscription' ? t('workspace.subscriptionTitle')
                                  : t('workspace.teamTitle');

  return (
    <div className="console-page">
      <Sidebar
        brand={
          <a href="#/" className="console-brand" aria-label="RESTO-HUB">
            <span className="console-brand__mark" style={{ background: tenant?.settings.primaryColor }}>RH</span>
            <span className="console-brand__text">
              RESTO-HUB
              <small>{tenant?.brandName ?? t('workspace.titleFallback')}</small>
            </span>
          </a>
        }
        tenant={tenant ? { name: tenant.brandName, meta: tenant.subdomain } : undefined}
        groups={navGroups}
        footer={
          <div className="console-user">
            <span className="console-user__avatar">{(user?.name ?? '?').slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="console-user__name">{user?.name}</div>
              <div className="console-user__role">{t('workspace.role.owner')}</div>
            </div>
          </div>
        }
        navLabel={t('workspace.navLabel')}
      />

      <div className="rh-main console-main">
        <header className="rh-topbar">
          <div>
            <div className="rh-topbar__title">{tabTitle}</div>
            <div className="rh-topbar__subtitle">{tenant ? `${tenant.brandName} · ${tenant.subdomain}` : t('workspace.subtitle')}</div>
          </div>
          <div className="rh-topbar__actions console-topbar-actions">
            {tenants.length > 1 && (
              <select
                className="rh-select console-tenant-switch"
                aria-label={t('workspace.switchTenant')}
                value={currentId ?? ''}
                onChange={(event) => {
                  setCurrentId(event.target.value);
                  void loadTenant(event.target.value);
                }}
              >
                {tenants.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.brandName}</option>
                ))}
              </select>
            )}
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
            <Button variant="ghost" iconOnly aria-label={t('workspace.logout')} iconLeft="logout" onClick={() => void signOut().then(() => navigate('/connexion'))} />
          </div>
        </header>

        <MobileTabs
          label={t('workspace.navLabel')}
          items={[
            { id: 'onboarding', label: t('workspace.tabOnboarding'), icon: 'check-circle', active: tab === 'onboarding', onClick: () => setTab('onboarding') },
            { id: 'branding', label: t('workspace.tabBranding'), icon: 'sparkles', active: tab === 'branding', onClick: () => setTab('branding') },
            { id: 'sites', label: t('workspace.tabSites'), icon: 'home', active: tab === 'sites', badge: sites.length, onClick: () => setTab('sites') },
            { id: 'catalog', label: t('workspace.tabCatalog'), icon: 'utensils', active: tab === 'catalog', onClick: () => setTab('catalog') },
            { id: 'floor', label: t('workspace.tabFloor'), icon: 'grid', active: tab === 'floor', onClick: () => setTab('floor') },
            ...(canSeeOrders
              ? [
                  { id: 'orders', label: t('orders.nav'), icon: 'receipt' as const, active: tab === 'orders', onClick: () => setTab('orders') },
                  { id: 'kds', label: t('kds.nav'), icon: 'chef' as const, active: tab === 'kds', onClick: () => setTab('kds') },
                ]
              : []),
            ...(canSeeRegister
              ? [
                  { id: 'pos', label: t('pos.nav'), icon: 'banknote' as const, active: tab === 'pos', onClick: () => setTab('pos') },
                  { id: 'payments', label: t('payments.nav'), icon: 'card' as const, active: tab === 'payments', onClick: () => setTab('payments') },
                ]
              : []),
            { id: 'subscription', label: t('workspace.tabSubscription'), icon: 'wallet', active: tab === 'subscription', onClick: () => setTab('subscription') },
            { id: 'team', label: t('workspace.tabTeam'), icon: 'users', active: tab === 'team', onClick: () => setTab('team') },
            ...(canSeeStaff
              ? [{ id: 'staff', label: t('staff.title'), icon: 'users' as const, active: tab === 'staff', onClick: () => setTab('staff') }]
              : []),
            ...(canSeePayroll
              ? [{ id: 'payroll', label: t('payroll.title'), icon: 'banknote' as const, active: tab === 'payroll', onClick: () => setTab('payroll') }]
              : []),
            ...(canSeeStocks
              ? [{ id: 'stocks', label: t('stocks.nav'), icon: 'box' as const, active: tab === 'stocks', onClick: () => setTab('stocks') }]
              : []),
            ...(canSeeMarketing
              ? [{ id: 'marketing', label: t('marketing.nav'), icon: 'gift' as const, active: tab === 'marketing', onClick: () => setTab('marketing') }]
              : []),
            ...(canSeeReports
              ? [{ id: 'reports', label: t('reports.nav'), icon: 'chart' as const, active: tab === 'reports', onClick: () => setTab('reports') }]
              : []),
          ]}
        />

        <main className="rh-content">
          {error && (
            <Card className="console-alert">
              <CardBody>
                <p className="auth-error" role="alert">{error}</p>
                <Button size="sm" variant="outline" onClick={() => currentId && void loadTenant(currentId)}>{t('workspace.retry')}</Button>
              </CardBody>
            </Card>
          )}

          {loading || !tenant || !brandForm ? (
            <Card><CardBody><SkeletonText lines={8} /></CardBody></Card>
          ) : (
            <>
              {tab === 'onboarding' && onboarding && (
                <div className="console-2col console-2col--wide">
                  <Card>
                    <CardHeader
                      title={t('workspace.onboardingTitle')}
                      subtitle={t('workspace.onboardingSubtitle')}
                      action={<Badge tone={onboarding.progress === 100 ? 'success' : 'warning'}>{onboarding.progress}%</Badge>}
                    />
                    <CardBody>
                      <div className="ws-progress" role="progressbar" aria-valuenow={onboarding.progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('workspace.progressLabel')}>
                        <span style={{ width: `${onboarding.progress}%` }} />
                      </div>
                      <p className="console-muted">
                        {t('workspace.progressDetail', { completed: onboarding.completed, total: onboarding.total })}
                      </p>
                      <ul className="ws-checklist">
                        {onboarding.items.map((item) => (
                          <li key={item.key} className={item.done ? 'is-done' : undefined}>
                            <span className="ws-checklist__icon" aria-hidden="true">{item.done ? '✓' : '○'}</span>
                            <div className="ws-checklist__body">
                              <strong>{item.label}</strong>
                              <span>{item.description}</span>
                              {item.detail && <em>{item.detail}</em>}
                            </div>
                            {!item.done && ['branding', 'hours', 'payments', 'subscription'].includes(item.key) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setTab(item.key === 'subscription' ? 'subscription' : item.key === 'payments' ? 'payments' : 'branding')}
                              >
                                {t('workspace.configure')}
                              </Button>
                            )}
                            {!item.done && item.key === 'team' && (
                              <Button size="sm" variant="outline" onClick={() => setTab('team')}>{t('workspace.configure')}</Button>
                            )}
                            {item.key === 'catalog' && (
                              <Button size="sm" variant="outline" onClick={() => setTab('catalog')}>{t('workspace.configure')}</Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>

                  <div className="console-stack">
                    <Card>
                      <CardHeader title={t('workspace.spaceTitle')} subtitle={t('workspace.spaceSubtitle')} />
                      <CardBody>
                        <dl className="console-kv">
                          <div><dt>{t('workspace.slug')}</dt><dd><code>{tenant.slug}</code></dd></div>
                          <div><dt>{t('workspace.subdomain')}</dt><dd><code>{tenant.subdomain}</code></dd></div>
                          <div><dt>{t('workspace.plan')}</dt><dd>{plan?.name ?? tenant.plan}</dd></div>
                          <div><dt>{t('workspace.status')}</dt><dd><Badge tone={tenant.status === 'active' ? 'success' : 'danger'} dot>{tenant.status === 'active' ? t('workspace.tenantActive') : t('workspace.tenantSuspended')}</Badge></dd></div>
                        </dl>
                        <Button variant="outline" size="sm" iconLeft="qr" onClick={copySubdomain}>
                          {t('workspace.copySpace')}
                        </Button>
                      </CardBody>
                    </Card>
                    <Card>
                      <CardHeader title={t('workspace.nextStepsTitle')} />
                      <CardBody>
                        <ul className="ws-next">
                          <li><button type="button" onClick={() => setTab('branding')}>{t('workspace.nextBranding')}</button></li>
                          <li><button type="button" onClick={() => setTab('sites')}>{t('workspace.nextSite')}</button></li>
                          <li><button type="button" onClick={() => setTab('team')}>{t('workspace.nextTeam')}</button></li>
                          <li><button type="button" onClick={() => setTab('subscription')}>{t('workspace.nextBilling')}</button></li>
                        </ul>
                      </CardBody>
                    </Card>
                  </div>
                </div>
              )}

              {tab === 'branding' && (
                <div className="console-2col console-2col--wide">
                  <Card>
                    <CardHeader title={t('workspace.brandingTitle')} subtitle={t('workspace.brandingSubtitle')} />
                    <CardBody>
                      <div className="reg-grid">
                        <Input
                          label={t('workspace.brandName')}
                          value={brandForm.brandName}
                          onChange={(event) => setBrandForm({ ...brandForm, brandName: event.target.value })}
                        />
                        <Input
                          label={t('workspace.logoUrl')}
                          value={brandForm.logoUrl}
                          onChange={(event) => setBrandForm({ ...brandForm, logoUrl: event.target.value })}
                          placeholder="https://…/logo.png"
                          hint={t('workspace.logoHint')}
                        />
                      </div>
                      <div className="reg-grid reg-grid--2">
                        <label className="ws-color">
                          <span>{t('workspace.primaryColor')}</span>
                          <div>
                            <input
                              type="color"
                              value={brandForm.primaryColor}
                              onChange={(event) => setBrandForm({ ...brandForm, primaryColor: event.target.value.toUpperCase() })}
                              aria-label={t('workspace.primaryColor')}
                            />
                            <code>{brandForm.primaryColor}</code>
                          </div>
                        </label>
                        <label className="ws-color">
                          <span>{t('workspace.secondaryColor')}</span>
                          <div>
                            <input
                              type="color"
                              value={brandForm.secondaryColor}
                              onChange={(event) => setBrandForm({ ...brandForm, secondaryColor: event.target.value.toUpperCase() })}
                              aria-label={t('workspace.secondaryColor')}
                            />
                            <code>{brandForm.secondaryColor}</code>
                          </div>
                        </label>
                      </div>
                      <div className="reg-grid reg-grid--2">
                        <div className="reg-choice">
                          <span className="reg-choice__label">{t('workspace.languages')}</span>
                          <label className="ws-inline">
                            <input
                              type="checkbox"
                              checked={brandForm.languages.includes('fr')}
                              onChange={(event) =>
                                setBrandForm({
                                  ...brandForm,
                                  languages: event.target.checked
                                    ? [...new Set([...brandForm.languages, 'fr'])]
                                    : brandForm.languages.filter((entry) => entry !== 'fr'),
                                })
                              }
                            />
                            Français
                          </label>
                          <label className="ws-inline">
                            <input
                              type="checkbox"
                              checked={brandForm.languages.includes('en')}
                              onChange={(event) =>
                                setBrandForm({
                                  ...brandForm,
                                  languages: event.target.checked
                                    ? [...new Set([...brandForm.languages, 'en'])]
                                    : brandForm.languages.filter((entry) => entry !== 'en'),
                                })
                              }
                            />
                            English
                          </label>
                        </div>
                        <label className="ws-color">
                          <span>{t('workspace.currency')}</span>
                          <select
                            className="rh-select"
                            value={brandForm.currency}
                            onChange={(event) => setBrandForm({ ...brandForm, currency: event.target.value })}
                          >
                            <option value="XOF">XOF — Franc CFA</option>
                            <option value="EUR">EUR — Euro</option>
                            <option value="USD">USD — Dollar</option>
                          </select>
                        </label>
                      </div>

                      <h3 className="reg-subtitle reg-subtitle--sm">{t('workspace.hours')}</h3>
                      <div className="reg-hours">
                        {DAYS.map((day, index) => {
                          const slot = brandForm.hours[index] ?? { day: day.key, open: '11:00', close: '23:00', closed: false };
                          return (
                            <div className={slot.closed ? 'reg-hours__row is-closed' : 'reg-hours__row'} key={day.key}>
                              <span className="reg-hours__day">{locale === 'en' ? day.en : day.fr}</span>
                              <input
                                type="time"
                                aria-label={`${day.fr} — ${t('register.open')}`}
                                value={slot.open}
                                disabled={slot.closed}
                                onChange={(event) =>
                                  setBrandForm({
                                    ...brandForm,
                                    hours: DAYS.map((entry, i) => (i === index ? { ...slot, open: event.target.value } : brandForm.hours[i] ?? { day: entry.key, open: '11:00', close: '23:00' })),
                                  })
                                }
                              />
                              <span aria-hidden="true">–</span>
                              <input
                                type="time"
                                aria-label={`${day.fr} — ${t('register.close')}`}
                                value={slot.close}
                                disabled={slot.closed}
                                onChange={(event) =>
                                  setBrandForm({
                                    ...brandForm,
                                    hours: DAYS.map((entry, i) => (i === index ? { ...slot, close: event.target.value } : brandForm.hours[i] ?? { day: entry.key, open: '11:00', close: '23:00' })),
                                  })
                                }
                              />
                              <label className="reg-hours__closed">
                                <input
                                  type="checkbox"
                                  checked={Boolean(slot.closed)}
                                  onChange={(event) =>
                                    setBrandForm({
                                      ...brandForm,
                                      hours: DAYS.map((entry, i) => (i === index ? { ...slot, closed: event.target.checked } : brandForm.hours[i] ?? { day: entry.key, open: '11:00', close: '23:00' })),
                                    })
                                  }
                                />
                                {t('register.closed')}
                              </label>
                            </div>
                          );
                        })}
                      </div>

                      <div className="reg-actions">
                        <Button onClick={() => void saveBranding()} loading={brandPending} iconLeft="check">
                          {t('workspace.save')}
                        </Button>
                      </div>
                    </CardBody>
                  </Card>

                  <aside className="console-stack">
                    <Card>
                      <CardHeader title={t('workspace.previewTitle')} subtitle={t('workspace.previewSubtitle')} />
                      <CardBody>
                        <div className="ws-preview" style={previewStyle}>
                          <div className="ws-preview__top">
                            <span className="ws-preview__logo">
                              {brandForm.logoUrl ? <img src={brandForm.logoUrl} alt="" /> : brandForm.brandName.slice(0, 2).toUpperCase()}
                            </span>
                            <div>
                              <strong>{brandForm.brandName || tenant.brandName}</strong>
                              <span>{t('workspace.previewClient')}</span>
                            </div>
                          </div>
                          <div className="ws-preview__hero">
                            <span>{t('workspace.previewTag')}</span>
                            <h4>{t('workspace.previewHeading')}</h4>
                            <div className="ws-preview__buttons">
                              <span className="ws-preview__btn">{t('workspace.previewMenu')}</span>
                              <span className="ws-preview__btn is-ghost">{t('workspace.previewOrder')}</span>
                            </div>
                          </div>
                          <div className="ws-preview__row">
                            <span className="ws-preview__dot" />
                            {t('workspace.previewTable')}
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                    <Card>
                      <CardBody>
                        <p className="console-muted">{t('workspace.brandingNote')}</p>
                      </CardBody>
                    </Card>
                  </aside>
                </div>
              )}

              {tab === 'sites' && (
                <div className="console-2col console-2col--wide">
                  <Card>
                    <CardHeader
                      title={t('workspace.sitesTitle')}
                      subtitle={plan ? t('workspace.sitesSubtitle', { used: sites.length, max: plan.maxSites ?? '∞' }) : undefined}
                    />
                    <CardBody>
                      <ul className="ws-sites">
                        {sites.map((site) => (
                          <li key={site.id}>
                            <div>
                              <strong>{site.name}</strong>
                              <span>{site.address}</span>
                              {site.phone && <span>{site.phone}</span>}
                            </div>
                            <div className="console-roles">
                              {site.isPrimary && <Badge tone="primary">{t('workspace.primarySite')}</Badge>}
                              <Badge tone={site.status === 'active' ? 'success' : 'neutral'} dot>
                                {site.status === 'active' ? t('workspace.siteActive') : t('workspace.siteClosed')}
                              </Badge>
                              {!site.isPrimary && (
                                <Button size="sm" variant="ghost" iconLeft="trash" onClick={() => void removeSite(site)}>
                                  {t('workspace.delete')}
                                </Button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title={t('workspace.addSiteTitle')} subtitle={t('workspace.addSiteSubtitle')} />
                    <CardBody>
                      <div className="console-stack">
                        <Input
                          label={t('workspace.siteName')}
                          value={siteForm.name}
                          onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })}
                          placeholder="Le Baobab — Kégué"
                        />
                        <Input
                          label={t('workspace.siteAddress')}
                          value={siteForm.address}
                          onChange={(event) => setSiteForm({ ...siteForm, address: event.target.value })}
                          placeholder="Rue de la paix, Kégué, Lomé"
                        />
                        <Input
                          label={t('workspace.sitePhone')}
                          value={siteForm.phone}
                          onChange={(event) => setSiteForm({ ...siteForm, phone: event.target.value })}
                          placeholder="+228 90 00 00 00"
                        />
                        <Button onClick={() => void addSite()} loading={sitePending} iconLeft="plus" disabled={Boolean(plan && plan.maxSites !== null && sites.length >= plan.maxSites)}>
                          {t('workspace.addSite')}
                        </Button>
                        {plan && plan.maxSites !== null && sites.length >= plan.maxSites && (
                          <p className="reg-note">{t('workspace.siteLimit', { max: plan.maxSites })}</p>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                </div>
              )}

              {tab === 'catalog' && (
                <CatalogTab tenantId={tenant.id} locale={locale} />
              )}

              {tab === 'floor' && (
                <FloorTab
                  tenantId={tenant.id}
                  locale={locale}
                  canManage={permissions.includes('floor:manage')}
                  canStatus={permissions.includes('floor:status') || permissions.includes('floor:manage')}
                />
              )}

              {tab === 'orders' && (
                <OrdersTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'kds' && (
                <KdsTab
                  tenantId={tenant.id}
                  locale={locale}
                  canUpdate={permissions.includes('order:update')}
                />
              )}

              {tab === 'pos' && (
                <PosTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'payments' && canSeeRegister && (
                <PaymentsTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'staff' && canSeeStaff && (
                <StaffTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'payroll' && canSeePayroll && (
                <PayrollTab tenantId={tenant.id} locale={locale} permissions={permissions} actorId={actorId} />
              )}

              {tab === 'stocks' && canSeeStocks && (
                <StocksTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'marketing' && canSeeMarketing && (
                <MarketingTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'reports' && canSeeReports && (
                <ReportsTab tenantId={tenant.id} locale={locale} permissions={permissions} />
              )}

              {tab === 'subscription' && (
                <>
                  <div className="console-stats">
                    <Card className="ws-sub-card">
                      <CardBody>
                        <span className="console-muted">{t('workspace.currentPlan')}</span>
                        <strong className="ws-sub-card__value">{plan?.name ?? tenant.plan}</strong>
                        <span>{plan ? `${formatXof(plan.priceXof, locale)} ${t('register.perMonth')}` : '—'}</span>
                      </CardBody>
                    </Card>
                    <Card className="ws-sub-card">
                      <CardBody>
                        <span className="console-muted">{t('workspace.subscriptionStatus')}</span>
                        <Badge tone={SUBSCRIPTION_TONE[subscription?.status ?? ''] ?? 'neutral'} dot>
                          {t(`workspace.subStatus.${subscription?.status ?? 'canceled'}`)}
                        </Badge>
                        {subscription?.trialEndsAt && subscription.status === 'trialing' && (
                          <span>{t('workspace.trialEnds', { date: formatDate(subscription.trialEndsAt, locale) })}</span>
                        )}
                      </CardBody>
                    </Card>
                    <Card className="ws-sub-card">
                      <CardBody>
                        <span className="console-muted">{t('workspace.nextRenewal')}</span>
                        <strong className="ws-sub-card__value">{subscription ? formatDate(subscription.currentPeriodEnd, locale) : '—'}</strong>
                        <span>{t('workspace.paymentMethods')}</span>
                      </CardBody>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader title={t('workspace.plansTitle')} subtitle={t('workspace.plansSubtitle')} />
                    <CardBody>
                      <div className="ws-plans">
                        {plans.map((entry) => (
                          <div key={entry.code} className={entry.code === tenant.plan ? 'ws-plan is-current' : 'ws-plan'}>
                            <div className="ws-plan__head">
                              <strong>{entry.name}</strong>
                              {entry.code === tenant.plan && <Badge tone="success">{t('workspace.currentBadge')}</Badge>}
                              {entry.highlight && entry.code !== tenant.plan && <Badge tone="accent">{t('register.recommended')}</Badge>}
                            </div>
                            <span className="ws-plan__price">{formatXof(entry.priceXof, locale)}<small>{t('register.perMonth')}</small></span>
                            <span className="console-muted">
                              {entry.maxSites === null || entry.maxEmployees === null
                                ? t('workspace.planUnlimited')
                                : t('workspace.planLimits', { sites: entry.maxSites, employees: entry.maxEmployees })}
                            </span>
                            <Button
                              variant={entry.code === tenant.plan ? 'ghost' : 'outline'}
                              size="sm"
                              disabled={entry.code === tenant.plan}
                              loading={checkoutPlan === entry.code}
                              onClick={() => void checkout(entry.code)}
                            >
                              {entry.code === tenant.plan ? t('workspace.currentBadge') : t('workspace.choose')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader
                      title={t('workspace.invoicesTitle')}
                      subtitle={t('workspace.invoicesSubtitle')}
                      action={<Badge tone="info" icon="wallet">{t('workspace.demoBilling')}</Badge>}
                    />
                    <CardBody>
                      {invoices.length === 0 ? (
                        <EmptyState icon="receipt" title={t('workspace.invoicesEmptyTitle')} description={t('workspace.invoicesEmptyBody')} />
                      ) : (
                        <DataTable columns={invoiceColumns} rows={invoices} getRowId={(row) => row.id} caption={t('workspace.invoicesTitle')} />
                      )}
                    </CardBody>
                  </Card>
                </>
              )}

              {tab === 'team' && (
                <Card>
                  <CardHeader
                    title={t('workspace.teamTitle')}
                    subtitle={t('workspace.teamSubtitle')}
                    action={<Badge tone="neutral">{team.length}</Badge>}
                  />
                  <CardBody>
                    {team.length === 0 ? (
                      <EmptyState icon="users" title={t('workspace.teamEmptyTitle')} description={t('workspace.teamEmptyBody')} />
                    ) : (
                      <DataTable columns={teamColumns} rows={team} getRowId={(row) => row.userId} caption={t('workspace.teamTitle')} />
                    )}
                    <p className="reg-note">{t('workspace.teamNote')}</p>
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
