import { useEffect, useState } from 'react';
import {
  Avatar,
  Badge,
  BottomNav,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Icon,
  Input,
  Logo,
  Modal,
  Select,
  Sidebar,
  Skeleton,
  SkeletonText,
  Switch,
  TABLE_STATUS_META,
  TABLE_STATUS_ORDER,
  TableStatusBadge,
  Tabs,
  cx,
  formatXof,
  panelDomId,
  tabDomId,
  useI18n,
  useToast,
  type Column,
} from '@resto-hub/design-system';
import { orders, tables } from '../data/demo';
import type { OrderRow } from '../data/types';
import { FloorPreview } from '../components/FloorPreview';

const statusTone = {
  kitchen: 'warning',
  ready: 'info',
  served: 'primary',
  paid: 'success',
} as const;

const toastDefs = [
  { tone: 'success', labelKey: 'design.toasts.success' },
  { tone: 'warning', labelKey: 'design.toasts.warning' },
  { tone: 'error', labelKey: 'design.toasts.error' },
  { tone: 'info', labelKey: 'design.toasts.info' },
] as const;

export function DesignGallery() {
  const { t, tm, locale } = useI18n();
  const { push } = useToast();
  const [tenant, setTenant] = useState('default');
  const [tab, setTab] = useState('components');
  const [modalOpen, setModalOpen] = useState(false);
  const [floorTable, setFloorTable] = useState('T02');

  const tenants = tm<Array<{ id: string; name: string }>>('design.tenants') ?? [];
  const palette = tm<Array<{ label: string; token: string }>>('design.palette') ?? [];
  const navLabels = tm<Record<string, string>>('design.navItems');
  const bottomLabels = tm<Record<string, string>>('design.bottomItems');
  const fields = tm<Record<string, string>>('design.demoFields');
  const buttonLabels = tm<Record<string, string>>('design.buttons');
  const a11yItems = tm<string[]>('design.a11yItems') ?? [];

  const tabs = [
    { id: 'components', label: t('design.tabs.components'), icon: 'grid' as const },
    { id: 'data', label: t('design.tabs.data'), icon: 'layers' as const },
    { id: 'feedback', label: t('design.tabs.feedback'), icon: 'bell' as const },
  ];
  const tabsGroup = `tabs-${tabs.map((item) => item.id).join('-')}`;

  useEffect(() => {
    const root = document.documentElement;
    if (tenant === 'default') root.removeAttribute('data-tenant');
    else root.setAttribute('data-tenant', tenant);
    return () => root.removeAttribute('data-tenant');
  }, [tenant]);

  const columns: Array<Column<OrderRow>> = [
    {
      key: 'id',
      header: t('cockpit.orderRef'),
      render: (row) => <span className="rh-table__mono">{row.id}</span>,
    },
    {
      key: 'table',
      header: t('cockpit.orderTable'),
      render: (row) => row.table,
    },
    {
      key: 'total',
      header: t('cockpit.orderTotal'),
      align: 'right',
      render: (row) => formatXof(row.total, locale),
    },
    {
      key: 'status',
      header: t('cockpit.orderStatus'),
      render: (row) => (
        <Badge tone={statusTone[row.status]} dot>
          {tm<Record<string, string>>('cockpit.orderStatuses')[row.status]}
        </Badge>
      ),
    },
  ];

  return (
    <section className="section" id="design" aria-labelledby="design-title">
      <div className="site-container">
        <header className="section__head">
          <div>
            <p className="rh-eyebrow">{t('design.eyebrow')}</p>
            <h2 className="rh-display section__title" id="design-title">
              {t('design.title')}
            </h2>
          </div>
          <p className="section__lead">{t('design.lead')}</p>
        </header>

        <div className="tenant-bar">
          <div>
            <strong>{t('design.tenantTitle')}</strong>
            <p>{t('design.tenantSub')}</p>
          </div>
          <div className="tenant-switch" role="group" aria-label={t('design.tenantTitle')}>
            {tenants.map((option) => (
              <button
                key={option.id}
                type="button"
                className={cx('tenant-chip', tenant === option.id && 'is-active')}
                aria-pressed={tenant === option.id}
                onClick={() => setTenant(option.id)}
              >
                <span
                  className={cx('tenant-chip__swatch', `tenant-chip__swatch--${option.id}`)}
                  aria-hidden="true"
                />
                {option.name}
              </button>
            ))}
          </div>
        </div>

        <div className="gallery">
          <Tabs
            items={tabs}
            value={tab}
            onChange={setTab}
            ariaLabel={t('design.eyebrow')}
            variant="line"
          />

          <div
            role="tabpanel"
            id={panelDomId(tabsGroup, tab)}
            aria-labelledby={tabDomId(tabsGroup, tab)}
            className="gallery__panel"
          >
            {tab === 'components' && (
              <div className="gallery-grid">
                <Card>
                  <CardHeader title={t('design.paletteTitle')} subtitle={t('design.paletteSub')} />
                  <CardBody>
                    <div className="swatches">
                      {palette.map((swatch) => (
                        <div className="swatch" key={swatch.token}>
                          <span
                            className="swatch__chip"
                            style={{ background: `var(${swatch.token})` }}
                            aria-hidden="true"
                          />
                          <strong>{swatch.label}</strong>
                          <code>{swatch.token}</code>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.typeTitle')} subtitle={t('design.typeSub')} />
                  <CardBody>
                    <div className="typescale">
                      <p className="typescale__display">{t('design.typeDisplaySample')}</p>
                      <span className="typescale__meta">Fraunces · 600 · 2.5rem</span>
                      <p className="typescale__body">{t('design.typeBodySample')}</p>
                      <span className="typescale__meta">Inter · 400 · 1rem</span>
                      <div className="typescale__row">
                        <span>XS</span>
                        <span>SM</span>
                        <span>Base</span>
                        <span>LG</span>
                        <span>XL</span>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.buttonsTitle')} />
                  <CardBody>
                    <div className="gallery__buttons">
                      <Button iconLeft="check">{buttonLabels.primary}</Button>
                      <Button variant="secondary" iconLeft="plus">
                        {buttonLabels.secondary}
                      </Button>
                      <Button variant="outline">{buttonLabels.outline}</Button>
                      <Button variant="ghost">{buttonLabels.ghost}</Button>
                      <Button variant="danger" iconLeft="refresh">
                        {buttonLabels.danger}
                      </Button>
                      <Button loading>{buttonLabels.loading}</Button>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.fieldsTitle')} />
                  <CardBody>
                    <div className="gallery__fields">
                      <Input
                        label={fields.name}
                        hint={fields.hint}
                        placeholder={fields.namePlaceholder}
                      />
                      <Input
                        label={fields.search}
                        leadingIcon="search"
                        placeholder={fields.search}
                      />
                      <Select
                        label={fields.filter}
                        options={[
                          { value: 'all', label: fields.allStatutes },
                          ...TABLE_STATUS_ORDER.map((status) => ({
                            value: status,
                            label:
                              TABLE_STATUS_META[status][locale === 'fr' ? 'labelFr' : 'labelEn'],
                          })),
                        ]}
                      />
                      <div className="gallery__toggles">
                        <Switch label={fields.notif} defaultChecked />
                        <Checkbox label={fields.terms} />
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card className="gallery__wide">
                  <CardHeader title={t('design.badgesTitle')} subtitle={t('design.statusSub')} />
                  <CardBody>
                    <div className="badge-row">
                      <Badge tone="neutral">Neutre</Badge>
                      <Badge tone="primary">Primaire</Badge>
                      <Badge tone="accent" icon="sparkles">
                        {t('design.badgePremium')}
                      </Badge>
                      {palette
                        .filter((item) =>
                          [
                            'Succès',
                            'Alerte',
                            'Erreur',
                            'Info',
                            'Success',
                            'Warning',
                            'Danger',
                            'Info',
                          ].includes(item.label),
                        )
                        .map((item) => (
                          <Badge
                            key={item.label}
                            tone={
                              item.label === 'Succès' || item.label === 'Success'
                                ? 'success'
                                : item.label === 'Alerte' || item.label === 'Warning'
                                  ? 'warning'
                                  : item.label === 'Erreur' || item.label === 'Danger'
                                    ? 'danger'
                                    : 'info'
                            }
                          >
                            {item.label}
                          </Badge>
                        ))}
                      <Badge tone="success" live>
                        {t('design.badgeLive')}
                      </Badge>
                    </div>
                    <div className="status-row">
                      {TABLE_STATUS_ORDER.map((status) => (
                        <TableStatusBadge
                          key={status}
                          status={status}
                          label={TABLE_STATUS_META[status][locale === 'fr' ? 'labelFr' : 'labelEn']}
                        />
                      ))}
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.navTitle')} subtitle={t('design.navSub')} />
                  <CardBody>
                    <div className="nav-demos">
                      <div className="nav-demo">
                        <span className="gallery__caption">{t('design.sidebarLabel')}</span>
                        <div className="demo-sidebar">
                          <Sidebar
                            brand={<Logo withWordmark size={24} />}
                            tenant={{ name: t('design.tenantName'), meta: t('design.roleName') }}
                            groups={[
                              {
                                label: t('design.sidebarLabel'),
                                items: [
                                  { id: 'dashboard', label: navLabels.dashboard, icon: 'home' },
                                  {
                                    id: 'floor',
                                    label: navLabels.floor,
                                    icon: 'grid',
                                    active: true,
                                  },
                                  {
                                    id: 'orders',
                                    label: navLabels.orders,
                                    icon: 'receipt',
                                    badge: 4,
                                  },
                                  { id: 'menu', label: navLabels.menu, icon: 'utensils' },
                                  { id: 'staff', label: navLabels.staff, icon: 'users' },
                                  { id: 'reports', label: navLabels.reports, icon: 'chart' },
                                  { id: 'settings', label: navLabels.settings, icon: 'settings' },
                                ],
                              },
                            ]}
                            footer={
                              <div className="rh-sidebar__user">
                                <Avatar name="Akouvi D." />
                                <div>
                                  <div className="rh-sidebar__user-name">Akouvi D.</div>
                                  <div className="rh-sidebar__user-role">
                                    {t('design.roleName')}
                                  </div>
                                </div>
                              </div>
                            }
                          />
                        </div>
                      </div>

                      <div className="nav-demo">
                        <span className="gallery__caption">{t('design.bottomLabel')}</span>
                        <div className="phone-demo phone-demo--compact">
                          <div className="phone-demo__frame">
                            <div className="phone-demo__notch" aria-hidden="true" />
                            <div className="phone-demo__minihead">
                              <Logo withWordmark size={20} />
                              <Avatar name="Awa K." />
                            </div>
                            <div className="phone-demo__minibody">
                              <FloorPreview
                                tables={tables.slice(0, 6)}
                                selectedId={floorTable}
                                onSelect={setFloorTable}
                              />
                            </div>
                            <div className="nav-demo__bottom">
                              <BottomNav
                                ariaLabel={t('design.bottomLabel')}
                                items={[
                                  {
                                    id: 'floor',
                                    label: bottomLabels.floor,
                                    icon: 'grid',
                                    active: true,
                                  },
                                  { id: 'orders', label: bottomLabels.orders, icon: 'receipt' },
                                  { id: 'kds', label: bottomLabels.kds, icon: 'chef' },
                                  { id: 'stats', label: bottomLabels.stats, icon: 'chart' },
                                ]}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.a11yTitle')} />
                  <CardBody>
                    <ul className="a11y-list">
                      {a11yItems.map((item) => (
                        <li key={item}>
                          <Icon name="check-circle" size="sm" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              </div>
            )}

            {tab === 'data' && (
              <div className="gallery-grid">
                <Card className="gallery__wide">
                  <CardHeader title={t('cockpit.ordersTitle')} subtitle={t('cockpit.ordersSub')} />
                  <DataTable
                    columns={columns}
                    rows={orders.slice(0, 4)}
                    getRowId={(row) => row.id}
                    caption={t('cockpit.ordersCaption')}
                  />
                </Card>

                <Card>
                  <CardHeader
                    title={t('design.skeletonTitle')}
                    subtitle={t('design.skeletonSub')}
                  />
                  <CardBody>
                    <div className="skeleton-demo">
                      <div className="skeleton-demo__row">
                        <Skeleton width={40} height={40} circle />
                        <div style={{ flex: 1 }}>
                          <SkeletonText lines={2} />
                        </div>
                      </div>
                      <Skeleton height={10} />
                      <Skeleton width="80%" height={10} />
                      <div className="skeleton-demo__stats">
                        <Skeleton height={72} />
                        <Skeleton height={72} />
                        <Skeleton height={72} />
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.emptyTitle')} />
                  <CardBody>
                    <EmptyState
                      icon="receipt"
                      title={t('design.emptyTitle')}
                      description={t('design.emptyDesc')}
                      action={
                        <Button size="sm" variant="outline" iconLeft="grid">
                          {t('design.emptyAction')}
                        </Button>
                      }
                    />
                  </CardBody>
                </Card>
              </div>
            )}

            {tab === 'feedback' && (
              <div className="gallery-grid">
                <Card>
                  <CardHeader title={t('design.toastTitle')} subtitle={t('design.toastSub')} />
                  <CardBody>
                    <div className="gallery__buttons">
                      {toastDefs.map((toast) => (
                        <Button
                          key={toast.tone}
                          variant="outline"
                          onClick={() =>
                            push({
                              tone: toast.tone,
                              title: t(`design.toasts.${toast.tone}Title`),
                              description: t(`design.toasts.${toast.tone}Desc`),
                            })
                          }
                        >
                          {t(toast.labelKey)}
                        </Button>
                      ))}
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title={t('design.modal.title')} subtitle={t('design.modal.desc')} />
                  <CardBody>
                    <Button variant="soft" iconLeft="calendar" onClick={() => setModalOpen(true)}>
                      {t('design.modalTrigger')}
                    </Button>
                  </CardBody>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('design.modal.title')}
        description={t('design.modal.desc')}
        closeLabel={t('meta.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('design.modal.cancel')}
            </Button>
            <Button type="submit" form="reservation-demo" iconLeft="check">
              {t('design.modal.submit')}
            </Button>
          </>
        }
      >
        <form
          id="reservation-demo"
          className="gallery__form"
          onSubmit={(event) => {
            event.preventDefault();
            setModalOpen(false);
            push({
              tone: 'success',
              title: t('design.modal.successTitle'),
              description: t('design.modal.successDesc'),
            });
          }}
        >
          <Input
            label={t('design.modal.name')}
            placeholder={t('design.modal.namePlaceholder')}
            required
          />
          <div className="gallery__form-row">
            <Select
              label={t('design.modal.covers')}
              defaultValue="6"
              options={['2', '4', '6', '8'].map((value) => ({ value, label: value }))}
            />
            <Input label={t('design.modal.time')} type="time" defaultValue="20:30" />
          </div>
          <Checkbox label={fields.terms} defaultChecked />
        </form>
      </Modal>
    </section>
  );
}
