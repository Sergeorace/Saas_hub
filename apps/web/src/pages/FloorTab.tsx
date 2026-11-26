import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  Select,
  SkeletonText,
  TableStatusBadge,
  useI18n,
  useToast,
  type Locale,
  type TableStatus,
} from '@resto-hub/design-system';
import {
  errorMessage,
  floorApi,
  type FloorSnapshot,
  type FloorStatus,
  type FloorTable,
  type TableType,
  type ZoneKind,
} from '../lib/api';

const STATUS_ORDER: FloorStatus[] = ['libre', 'reservee', 'occupee', 'addition', 'nettoyage', 'hors_service'];

const STATUS_TO_DESIGN: Record<FloorStatus, TableStatus> = {
  libre: 'free',
  reservee: 'reserved',
  occupee: 'occupied',
  addition: 'bill',
  nettoyage: 'cleaning',
  hors_service: 'out',
};

const TRANSITIONS: Record<FloorStatus, FloorStatus[]> = {
  libre: ['reservee', 'occupee', 'hors_service'],
  reservee: ['libre', 'occupee', 'hors_service'],
  occupee: ['addition', 'libre', 'hors_service'],
  addition: ['nettoyage', 'occupee', 'hors_service'],
  nettoyage: ['libre', 'hors_service'],
  hors_service: ['libre'],
};

const ZONE_KINDS: ZoneKind[] = ['salle', 'terrasse', 'vip', 'bar', 'etage'];
const TABLE_TYPES: TableType[] = ['table', 'comptoir', 'canape', 'loge'];

interface Props {
  tenantId: string;
  canManage: boolean;
  canStatus: boolean;
  locale: Locale;
}

export function FloorTab({ tenantId, canManage, canStatus }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsCode, setSettingsCode] = useState('');
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ name: '', kind: 'salle' as ZoneKind, code: '' });
  const [tableOpen, setTableOpen] = useState(false);
  const [tableForm, setTableForm] = useState({ number: '', capacity: '4', type: 'table' as TableType });
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const qrUrlRef = useRef<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setError(null);
    try {
      const result = await floorApi.snapshot(tenantId);
      setSnapshot(result);
      setSettingsCode((current) => current || result.settings?.establishmentCode || '');
      setActiveZone((current) => (current && result.zones.some((zone) => zone.id === current) ? current : result.zones[0]?.id ?? ''));
      setError(null);
    } catch (cause) {
      if (!silent) setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    setSnapshot(null);
    setActiveZone('');
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(
    () => () => {
      if (qrUrlRef.current) URL.revokeObjectURL(qrUrlRef.current);
    },
    [],
  );

  const tables = snapshot?.tables ?? [];
  const selected = tables.find((table) => table.id === selectedId) ?? null;
  const zone = snapshot?.zones.find((entry) => entry.id === activeZone) ?? null;
  const zoneTables = tables.filter((table) => table.zoneId === activeZone);
  const primaries = zoneTables.filter((table) => !table.mergedIntoId);
  const summary = snapshot?.summary;

  const replaceSnapshot = (next: FloorSnapshot) => {
    setSnapshot(next);
    setActiveZone((current) => (next.zones.some((entry) => entry.id === current) ? current : next.zones[0]?.id ?? ''));
  };

  const applyTable = (table: FloorTable) => {
    setSnapshot((current) =>
      current
        ? { ...current, tables: current.tables.map((entry) => (entry.id === table.id ? table : entry)) }
        : current,
    );
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (cause) {
      toast.push({ title: t('workspace.errorTitle'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = () =>
    run('settings', async () => {
      const result = await floorApi.updateSettings(tenantId, settingsCode.trim().toUpperCase());
      replaceSnapshot(result);
      setSettingsCode(result.settings?.establishmentCode ?? settingsCode.toUpperCase());
      toast.push({ title: t('floor.settingsSaved') });
    });

  const changeStatus = (table: FloorTable, status: FloorStatus) =>
    run(`status-${table.id}`, async () => {
      const result = await floorApi.setStatus(tenantId, table.id, { status });
      applyTable(result.table);
      toast.push({ title: t('floor.statusUpdated'), description: `${table.code} · ${t(`floor.statusLabel.${status}`)}` });
    });

  const createZone = () =>
    run('zone', async () => {
      const result = await floorApi.createZone(tenantId, {
        name: zoneForm.name.trim(),
        kind: zoneForm.kind,
        code: zoneForm.code.trim().toUpperCase() || undefined,
      });
      setZoneOpen(false);
      setZoneForm({ name: '', kind: 'salle', code: '' });
      await load(true);
      setActiveZone(result.zone.id);
      toast.push({ title: t('floor.zoneCreated') });
    });

  const deleteZone = (id: string) =>
    run(`zone-del-${id}`, async () => {
      await floorApi.deleteZone(tenantId, id);
      toast.push({ title: t('floor.zoneDeleted') });
      await load(true);
    });

  const createTable = () =>
    run('table', async () => {
      const number = tableForm.number ? Number(tableForm.number) : undefined;
      const result = await floorApi.createTable(tenantId, {
        zoneId: activeZone,
        number,
        capacity: Math.max(1, Number(tableForm.capacity) || 1),
        type: tableForm.type,
      });
      setTableOpen(false);
      setTableForm({ number: '', capacity: '4', type: 'table' });
      setSnapshot((current) => (current ? { ...current, tables: [...current.tables, result.table] } : current));
      setSelectedId(result.table.id);
      toast.push({ title: t('floor.tableCreated'), description: result.table.code });
      void load(true);
    });

  const deleteTable = (table: FloorTable) => {
    if (!window.confirm(t('floor.deleteConfirm', { code: table.code }))) return;
    void run(`del-${table.id}`, async () => {
      await floorApi.deleteTable(tenantId, table.id);
      setSelectedId(null);
      toast.push({ title: t('floor.tableDeleted') });
      await load(true);
    });
  };

  const toggleMergeSelection = (table: FloorTable) => {
    if (table.mergedIntoId) return;
    setMergeIds((current) =>
      current.includes(table.id) ? current.filter((id) => id !== table.id) : [...current, table.id].slice(0, 6),
    );
  };

  const confirmMerge = () =>
    run('merge', async () => {
      if (mergeIds.length < 2) return;
      await floorApi.merge(tenantId, mergeIds, mergeIds[0]);
      setMergeIds([]);
      setMergeMode(false);
      toast.push({ title: t('floor.mergeDone') });
      await load(true);
    });

  const splitTable = (table: FloorTable) =>
    run(`split-${table.id}`, async () => {
      await floorApi.split(tenantId, table.id);
      toast.push({ title: t('floor.splitDone') });
      await load(true);
    });

  const transfer = (table: FloorTable) =>
    run(`transfer-${table.id}`, async () => {
      if (!transferTarget) return;
      const result = await floorApi.transfer(tenantId, table.id, transferTarget);
      applyTable(result.source);
      applyTable(result.target);
      setTransferTarget('');
      toast.push({ title: t('floor.transferDone') });
      await load(true);
    });

  const moveTable = (table: FloorTable, dx: number, dy: number) =>
    run(`move-${table.id}`, async () => {
      const x = Math.min(96, Math.max(0, Math.round(table.x + dx)));
      const y = Math.min(94, Math.max(0, Math.round(table.y + dy)));
      const result = await floorApi.updateTable(tenantId, table.id, { x, y });
      applyTable(result.table);
    });

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!canManage) return;
    const id = event.dataTransfer.getData('text/plain');
    const table = tables.find((entry) => entry.id === id);
    if (!table) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
    const clampedX = Math.min(96, Math.max(0, x));
    const clampedY = Math.min(94, Math.max(0, y));
    applyTable({ ...table, x: clampedX, y: clampedY });
    void run(`drop-${table.id}`, async () => {
      const result = await floorApi.updateTable(tenantId, table.id, { x: clampedX, y: clampedY });
      applyTable(result.table);
    });
  };

  const openQr = (table: FloorTable) =>
    run(`qr-${table.id}`, async () => {
      const blob = await floorApi.qrBlob(tenantId, table.id, 'png');
      if (qrUrlRef.current) URL.revokeObjectURL(qrUrlRef.current);
      const url = URL.createObjectURL(blob);
      qrUrlRef.current = url;
      setQrUrl(url);
      setQrOpen(true);
    });

  const downloadSheet = () =>
    run('pdf', async () => {
      const blob = await floorApi.qrSheetBlob(tenantId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `qr-${snapshot?.settings?.establishmentCode ?? tenantId}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.push({ title: t('floor.pdfReady') });
    });

  const targetsForTransfer = useMemo(
    () =>
      selected
        ? tables.filter(
            (table) =>
              table.id !== selected.id &&
              !table.mergedIntoId &&
              !table.orderId &&
              (table.status === 'libre' || table.status === 'reservee'),
          )
        : [],
    [tables, selected],
  );

  if (loading) {
    return <Card><CardBody><SkeletonText lines={8} /></CardBody></Card>;
  }

  if (error || !snapshot) {
    return (
      <Card className="console-alert">
        <CardBody>
          <p className="auth-error" role="alert">{error ?? t('floor.error')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>{t('workspace.retry')}</Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="console-stack">
      <div className="console-stats">
        <Card className="ws-sub-card">
          <CardBody>
            <span className="console-muted">{t('floor.occupancy')}</span>
            <strong className="ws-sub-card__value">{summary?.occupancyRate ?? 0}%</strong>
            <span>{t('floor.seated')} : {summary?.seatsOccupied ?? 0} / {summary?.seatsTotal ?? 0}</span>
          </CardBody>
        </Card>
        <Card className="ws-sub-card">
          <CardBody>
            <span className="console-muted">{t('floor.tablesCount')}</span>
            <strong className="ws-sub-card__value">{summary?.tables ?? 0}</strong>
            <span>{t('floor.serviceable')} : {summary?.serviceable ?? 0}</span>
          </CardBody>
        </Card>
        <Card className="ws-sub-card">
          <CardBody>
            <span className="console-muted">{t('floor.cleaning')}</span>
            <strong className="ws-sub-card__value">{summary?.byStatus.nettoyage ?? 0}</strong>
            <Badge tone="warning" dot>{t('floor.statusLabel.nettoyage')}</Badge>
          </CardBody>
        </Card>
        <Card className="ws-sub-card">
          <CardBody>
            <span className="console-muted">{t('floor.outOfService')}</span>
            <strong className="ws-sub-card__value">{summary?.byStatus.hors_service ?? 0}</strong>
            <Badge tone="danger" dot>{t('floor.statusLabel.hors_service')}</Badge>
          </CardBody>
        </Card>
        <Card className="ws-sub-card">
          <CardBody>
            <span className="console-muted">{t('floor.settings')}</span>
            <strong className="ws-sub-card__value">{snapshot.settings?.establishmentCode ?? '—'}</strong>
            <Badge tone="success" live>{t('floor.live')}</Badge>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <div className="floor-settings">
            <Input
              label={t('floor.settings')}
              hint={t('floor.settingsHint')}
              value={settingsCode}
              disabled={!canManage}
              onChange={(event) => setSettingsCode(event.target.value.toUpperCase())}
              maxLength={12}
            />
            <Button variant="outline" loading={busy === 'settings'} disabled={!canManage} onClick={() => void saveSettings()} iconLeft="check">
              {t('floor.save')}
            </Button>
            <div className="floor-legend" aria-label={t('floor.legend')}>
              {STATUS_ORDER.map((status) => (
                <span key={status} className="floor-legend__item">
                  <span className={`floor-dot floor-dot--${status}`} aria-hidden="true" />
                  {t(`floor.statusLabel.${status}`)}
                </span>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="floor-layout">
        <Card className="floor-plan-card">
          <CardHeader
            title={zone ? `${zone.name} · ${zone.code}` : t('floor.zones')}
            subtitle={t('floor.dragHint')}
            action={
              <div className="console-roles">
                <Button size="sm" variant="ghost" iconLeft="refresh" onClick={() => void load(true)}>
                  {t('floor.refresh')}
                </Button>
                {canManage && (
                  <>
                    <Button size="sm" variant="outline" iconLeft="plus" onClick={() => setZoneOpen(true)}>
                      {t('floor.newZone')}
                    </Button>
                    <Button size="sm" variant="ghost" iconLeft="layers" disabled={!activeZone} onClick={() => setTableOpen(true)}>
                      {t('floor.newTable')}
                    </Button>
                  </>
                )}
                <Button size="sm" variant="soft" iconLeft="download" loading={busy === 'pdf'} onClick={() => void downloadSheet()}>
                  {t('floor.downloadPdf')}
                </Button>
              </div>
            }
          />
          <CardBody>
            <div className="floor-zone-tabs" role="tablist" aria-label={t('floor.zones')}>
              {snapshot.zones.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === activeZone}
                  className={entry.id === activeZone ? 'floor-zone-tab is-active' : 'floor-zone-tab'}
                  onClick={() => {
                    setActiveZone(entry.id);
                    setSelectedId(null);
                    setMergeIds([]);
                  }}
                >
                  {entry.name}
                  <span>{tables.filter((table) => table.zoneId === entry.id && !table.mergedIntoId).length}</span>
                </button>
              ))}
            </div>

            {mergeMode && (
              <div className="floor-banner" role="status">
                <span>{t('floor.mergeMode')} · {t('floor.mergeSelection', { count: mergeIds.length })}</span>
                <div className="console-roles">
                  <Button size="sm" variant="ghost" onClick={() => { setMergeMode(false); setMergeIds([]); }}>
                    {t('catalog.cancel')}
                  </Button>
                  <Button size="sm" loading={busy === 'merge'} disabled={mergeIds.length < 2} onClick={() => void confirmMerge()}>
                    {t('floor.merge')}
                  </Button>
                </div>
              </div>
            )}

            {snapshot.zones.length === 0 ? (
              <EmptyState
                icon="grid"
                title={t('floor.noZoneTitle')}
                description={t('floor.noZoneBody')}
                action={canManage ? <Button onClick={() => setZoneOpen(true)} iconLeft="plus">{t('floor.newZone')}</Button> : undefined}
              />
            ) : primaries.length === 0 ? (
              <EmptyState
                icon="grid"
                title={t('floor.noTableTitle')}
                description={t('floor.noTableBody')}
                action={canManage ? <Button onClick={() => setTableOpen(true)} iconLeft="plus">{t('floor.newTable')}</Button> : undefined}
              />
            ) : (
              <div
                className="floor-canvas"
                onDragOver={(event) => {
                  if (canManage) event.preventDefault();
                }}
                onDrop={onDrop}
              >
                <div className="floor-canvas__grid" aria-hidden="true" />
                {zoneTables.map((table) => {
                  const primary = table.mergedIntoId
                    ? tables.find((entry) => entry.id === table.mergedIntoId)
                    : undefined;
                  const isMergedChild = Boolean(table.mergedIntoId);
                  const isSelected = table.id === selectedId || (isMergedChild && selectedId === table.mergedIntoId);
                  const mergeSelected = mergeIds.includes(table.id);
                  return (
                    <div
                      key={table.id}
                      className={[
                        'floor-table',
                        `floor-table--${table.status}`,
                        isSelected && 'is-selected',
                        isMergedChild && 'is-merged-child',
                        mergeSelected && 'is-merge-selected',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ left: `${table.x}%`, top: `${table.y}%` }}
                      draggable={canManage && !isMergedChild}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', table.id)}
                      onClick={() => {
                        if (isMergedChild) {
                          setSelectedId(table.mergedIntoId ?? null);
                          return;
                        }
                        if (mergeMode) {
                          toggleMergeSelection(table);
                          return;
                        }
                        setSelectedId(table.id);
                        setTransferTarget('');
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${table.code} — ${t(`floor.statusLabel.${table.status}`)}`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(table.id);
                        }
                      }}
                    >
                      <span className="floor-table__code">{table.code}</span>
                      <span className="floor-table__meta">
                        {table.effectiveCapacity} pl.
                        {table.mergedIds.length > 0 && <span className="floor-table__merge" aria-label={t('floor.mergedWith', { codes: table.mergedCodes.join(', ') })}>⊕{table.mergedIds.length}</span>}
                      </span>
                      {table.orderId && <span className="floor-table__order" aria-label={t('floor.openOrder')}>•</span>}
                      <span className="floor-table__status">{t(`floor.statusLabel.${table.status}`)}</span>
                      {isMergedChild && primary && <span className="floor-table__child-note">{primary.code}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="floor-zone-foot">
              {zone && (
                <span className="console-muted">
                  {zone.name} · {zone.kind} · {t('floor.tablesCount')} : {zoneTables.filter((table) => !table.mergedIntoId).length}
                </span>
              )}
              {canManage && zone && (
                <Button size="sm" variant="ghost" iconLeft="trash" onClick={() => void deleteZone(zone.id)}>
                  {t('floor.deleteZone')}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <aside className="console-stack">
          {selected ? (
            <Card>
              <CardHeader
                title={selected.code}
                subtitle={`${selected.zoneName} · ${t(`floor.tableTypeLabel.${selected.type}`)}`}
                action={<TableStatusBadge status={STATUS_TO_DESIGN[selected.status]} label={t(`floor.statusLabel.${selected.status}`)} />}
              />
              <CardBody>
                <dl className="console-kv">
                  <div><dt>{t('floor.capacity')}</dt><dd>{selected.capacity} · {selected.effectiveCapacity} {t('floor.seats').toLowerCase()}</dd></div>
                  <div><dt>{t('floor.order')}</dt><dd>{selected.orderId ?? '—'}</dd></div>
                  <div><dt>{t('floor.reservation')}</dt><dd>{selected.reservationId ?? '—'}</dd></div>
                  {selected.mergedIntoCode && (
                    <div><dt>{t('floor.merge')}</dt><dd>{t('floor.mergedInto', { code: selected.mergedIntoCode })}</dd></div>
                  )}
                  {selected.mergedCodes.length > 0 && (
                    <div><dt>{t('floor.merge')}</dt><dd>{t('floor.mergedWith', { codes: selected.mergedCodes.join(', ') })}</dd></div>
                  )}
                </dl>

                {canStatus && !selected.mergedIntoId && (
                  <div className="floor-actions">
                    <span className="console-muted">{t('floor.transitions')}</span>
                    <div className="floor-actions__grid">
                      {TRANSITIONS[selected.status].map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant="outline"
                          loading={busy === `status-${selected.id}`}
                          onClick={() => void changeStatus(selected, status)}
                        >
                          {t(`floor.statusLabel.${status}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {canManage && (
                  <div className="floor-actions">
                    <span className="console-muted">{t('floor.merge')} / {t('floor.split')}</span>
                    <div className="console-roles">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft="layers"
                        onClick={() => {
                          setMergeMode(true);
                          setMergeIds(selected.mergedIntoId ? [] : [selected.id]);
                        }}
                      >
                        {t('floor.merge')}
                      </Button>
                      {selected.mergedIds.length > 0 && (
                        <Button size="sm" variant="ghost" iconLeft="minus" loading={busy === `split-${selected.id}`} onClick={() => void splitTable(selected)}>
                          {t('floor.split')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" iconLeft="qr" loading={busy === `qr-${selected.id}`} onClick={() => void openQr(selected)}>
                        {t('floor.qr')}
                      </Button>
                    </div>
                  </div>
                )}

                {selected.orderId && canManage && !selected.mergedIntoId && (
                  <div className="floor-actions">
                    <span className="console-muted">{t('floor.transfer')}</span>
                    {targetsForTransfer.length === 0 ? (
                      <p className="reg-note">{t('floor.transferNone')}</p>
                    ) : (
                      <div className="console-roles">
                        <Select
                          aria-label={t('floor.transferTo')}
                          value={transferTarget}
                          onChange={(event) => setTransferTarget(event.target.value)}
                          options={[
                            { value: '', label: t('floor.transferTo') },
                            ...targetsForTransfer.map((table) => ({ value: table.id, label: `${table.code} · ${t(`floor.statusLabel.${table.status}`)}` })),
                          ]}
                        />
                        <Button size="sm" loading={busy === `transfer-${selected.id}`} disabled={!transferTarget} onClick={() => void transfer(selected)}>
                          {t('floor.transfer')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {canManage && !selected.mergedIntoId && (
                  <div className="floor-actions">
                    <span className="console-muted">{t('floor.dragHint')}</span>
                    <div className="floor-nudge" role="group" aria-label={t('floor.dragHint')}>
                      <Button size="sm" variant="ghost" iconOnly aria-label="Gauche" iconLeft="arrow-left" onClick={() => void moveTable(selected, -4, 0)} />
                      <Button size="sm" variant="ghost" iconOnly aria-label="Haut" iconLeft="arrow-up" onClick={() => void moveTable(selected, 0, -4)} />
                      <Button size="sm" variant="ghost" iconOnly aria-label="Bas" iconLeft="arrow-down" onClick={() => void moveTable(selected, 0, 4)} />
                      <Button size="sm" variant="ghost" iconOnly aria-label="Droite" iconLeft="arrow-right" onClick={() => void moveTable(selected, 4, 0)} />
                    </div>
                  </div>
                )}

                {canManage && (
                  <div className="floor-actions">
                    <Button variant="ghost" size="sm" iconLeft="trash" onClick={() => deleteTable(selected)}>
                      {t('floor.deleteTable')}
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <EmptyState icon="grid" title={t('floor.selectTable')} description={t('floor.dragHint')} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody>
              <p className="reg-note">{t('floor.eventNote')}</p>
            </CardBody>
          </Card>
        </aside>
      </div>

      <Modal
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
        title={t('floor.newZone')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setZoneOpen(false)}>{t('catalog.cancel')}</Button>
            <Button loading={busy === 'zone'} onClick={() => void createZone()} disabled={zoneForm.name.trim().length < 2}>
              {t('catalog.create')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <Input
            label={t('floor.zoneName')}
            value={zoneForm.name}
            onChange={(event) => setZoneForm({ ...zoneForm, name: event.target.value })}
            placeholder="Terrasse"
          />
          <Select
            label={t('floor.zoneKind')}
            value={zoneForm.kind}
            onChange={(event) => setZoneForm({ ...zoneForm, kind: event.target.value as ZoneKind })}
            options={ZONE_KINDS.map((kind) => ({ value: kind, label: t(`floor.kind.${kind}`) }))}
          />
          <Input
            label={t('floor.zoneCode')}
            value={zoneForm.code}
            onChange={(event) => setZoneForm({ ...zoneForm, code: event.target.value.toUpperCase() })}
            maxLength={4}
            placeholder="TER"
            hint="2 à 4 caractères A-Z/0-9"
          />
        </div>
      </Modal>

      <Modal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        title={t('floor.newTable')}
        description={zone ? `${zone.name} · ${snapshot.settings?.establishmentCode ?? ''}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTableOpen(false)}>{t('catalog.cancel')}</Button>
            <Button loading={busy === 'table'} onClick={() => void createTable()}>
              {t('catalog.create')}
            </Button>
          </>
        }
      >
        <div className="console-stack">
          <div className="reg-grid reg-grid--2">
            <Input
              label={t('floor.tableNumber')}
              type="number"
              min={1}
              max={999}
              placeholder="Auto"
              value={tableForm.number}
              onChange={(event) => setTableForm({ ...tableForm, number: event.target.value })}
            />
            <Input
              label={t('floor.capacity')}
              type="number"
              min={1}
              max={50}
              value={tableForm.capacity}
              onChange={(event) => setTableForm({ ...tableForm, capacity: event.target.value })}
            />
          </div>
          <Select
            label={t('floor.tableType')}
            value={tableForm.type}
            onChange={(event) => setTableForm({ ...tableForm, type: event.target.value as TableType })}
            options={TABLE_TYPES.map((type) => ({ value: type, label: t(`floor.tableTypeLabel.${type}`) }))}
          />
        </div>
      </Modal>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={t('floor.qr')}
        description={selected ? `${selected.code} · ${selected.zoneName}` : undefined}
        footer={<Button variant="ghost" onClick={() => setQrOpen(false)}>{t('catalog.cancel')}</Button>}
      >
        <div className="floor-qr">
          {qrUrl && <img src={qrUrl} alt={`QR ${selected?.code ?? ''}`} width={260} height={260} />}
          <p className="console-muted">{t('floor.qrHint')}</p>
          {selected && <code>{selected.code}</code>}
        </div>
      </Modal>
    </div>
  );
}
