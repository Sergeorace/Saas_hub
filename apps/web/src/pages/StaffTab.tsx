import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Select,
  SkeletonText,
  StatCard,
  Textarea,
  formatDate,
  formatTime,
  formatXof,
  useI18n,
  useToast,
  type BadgeTone,
  type Column,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  staffApi,
  type StaffAttendance,
  type StaffAuditEntry,
  type StaffContractType,
  type StaffEmployee,
  type StaffGeofence,
  type StaffLeave,
  type StaffLeaveType,
  type StaffPerformanceRecord,
  type StaffShift,
  type StaffShiftStation,
  type StaffStatus,
  type StaffSummary,
  type StaffSwap,
} from '../lib/api';

type Section = 'team' | 'planning' | 'attendance' | 'performance' | 'audit';

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

const STATUS_TONE: Record<StaffStatus, BadgeTone> = {
  invite: 'info',
  actif: 'success',
  suspendu: 'warning',
  sorti: 'neutral',
};

const SHIFT_TONE: Record<string, BadgeTone> = {
  planifie: 'neutral',
  publie: 'info',
  termine: 'success',
  annule: 'danger',
};

const LEAVE_TONE: Record<string, BadgeTone> = {
  en_attente: 'warning',
  approuve: 'success',
  refuse: 'danger',
};

const ROLES = [
  'waiter',
  'cook',
  'bartender',
  'cashier',
  'floor_manager',
  'driver',
  'accountant',
] as const;
const CONTRACTS: StaffContractType[] = ['cdi', 'cdd', 'stage', 'extra'];
const STATIONS: StaffShiftStation[] = ['salle', 'cuisine', 'bar', 'caisse', 'livraison'];
const LEAVE_TYPES: StaffLeaveType[] = ['conges_payes', 'maladie', 'sans_solde'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMinutes(shift: StaffShift): number {
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 },
    );
  });
}

const EMPTY_EMPLOYEE = {
  name: '',
  phone: '',
  email: '',
  jobTitle: '',
  roleCode: 'waiter',
  contractType: 'cdi' as StaffContractType,
  hireDate: todayIso(),
  baseSalaryXof: '140000',
  paymentMethod: 'mobile_money' as StaffEmployee['paymentMethod'],
  paymentDestination: '',
};

export function StaffTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canView = permissions.includes('staff:view');
  const canManage = permissions.includes('staff:manage');

  const [section, setSection] = useState<Section>('team');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StaffSummary | null>(null);
  const [employees, setEmployees] = useState<StaffEmployee[]>([]);
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [swaps, setSwaps] = useState<StaffSwap[]>([]);
  const [leaves, setLeaves] = useState<StaffLeave[]>([]);
  const [attendance, setAttendance] = useState<StaffAttendance[]>([]);
  const [performance, setPerformance] = useState<{
    items: StaffPerformanceRecord[];
    totals: { salesXof: number; orders: number; tablesServed: number; tipsXof: number };
  } | null>(null);
  const [geofence, setGeofence] = useState<StaffGeofence | null>(null);
  const [audit, setAudit] = useState<{ entries: StaffAuditEntry[]; integrity: boolean } | null>(
    null,
  );
  const [attendanceDate, setAttendanceDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StaffStatus>('all');

  const [detail, setDetail] = useState<{
    employee: StaffEmployee;
    performance: { salesXof: number; orders: number; tablesServed: number; tipsXof: number };
    attendance: StaffAttendance[];
    shifts: StaffShift[];
  } | null>(null);
  const [docForm, setDocForm] = useState({ name: '', type: 'contrat' });

  const [employeeModal, setEmployeeModal] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(EMPTY_EMPLOYEE);
  const [pending, setPending] = useState(false);

  const [inviteModal, setInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    name: '',
    phone: '',
    email: '',
    jobTitle: '',
    roleCode: 'waiter',
  });
  const [invitation, setInvitation] = useState<{
    token: string;
    channel: string;
    link: string;
    expiresAt: string;
  } | null>(null);
  const [invitePin, setInvitePin] = useState('');

  const [shiftModal, setShiftModal] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    employeeId: '',
    date: todayIso(),
    start: '11:00',
    end: '17:00',
    station: 'salle' as StaffShiftStation,
    publishNow: true,
  });

  const [swapModal, setSwapModal] = useState<StaffShift | null>(null);
  const [swapTarget, setSwapTarget] = useState('');

  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    employeeId: '',
    type: 'conges_payes' as StaffLeaveType,
    from: todayIso(),
    to: todayIso(),
    reason: '',
  });

  const [absenceModal, setAbsenceModal] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({ employeeId: '', date: todayIso(), reason: '' });

  const [clockModal, setClockModal] = useState(false);
  const [clockPin, setClockPin] = useState('');
  const [clockGeo, setClockGeo] = useState(false);

  const [geoForm, setGeoForm] = useState({ lat: '6.1725', lng: '1.2314', radiusM: '150' });

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const [sum, emp, sh, sw, lv, att, perf, settings, log] = await Promise.all([
        staffApi.summary(tenantId),
        staffApi.employees(tenantId),
        staffApi.shifts(tenantId, { from: plusDays(-1), to: plusDays(21) }),
        staffApi.swaps(tenantId),
        staffApi.leaves(tenantId),
        staffApi.attendance(tenantId, attendanceDate),
        staffApi.performance(tenantId),
        staffApi.settings(tenantId),
        staffApi.audit(tenantId),
      ]);
      setSummary(sum);
      setEmployees(emp.items);
      setShifts(sh.items);
      setSwaps(sw.items);
      setLeaves(lv.items);
      setAttendance(att.items);
      setPerformance(perf);
      setGeofence(settings.geofence);
      setAudit({ entries: log.entries, integrity: log.integrity });
      if (settings.geofence) {
        setGeoForm({
          lat: String(settings.geofence.lat),
          lng: String(settings.geofence.lng),
          radiusM: String(settings.geofence.radiusM),
        });
      }
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId, attendanceDate, canView]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees
      .filter((employee) => statusFilter === 'all' || employee.status === statusFilter)
      .filter(
        (employee) =>
          !query ||
          `${employee.name} ${employee.jobTitle} ${employee.email ?? ''} ${employee.phone}`
            .toLowerCase()
            .includes(query),
      );
  }, [employees, search, statusFilter]);

  const openDetail = async (id: string) => {
    try {
      const result = await staffApi.employee(tenantId, id);
      setDetail(result);
      setDocForm({ name: '', type: 'contrat' });
    } catch (cause) {
      toast.push({ title: t('staff.error'), description: errorMessage(cause), tone: 'error' });
    }
  };

  const run = async (task: () => Promise<void>, success: string) => {
    setPending(true);
    try {
      await task();
      toast.push({ title: success, tone: 'success' });
      await reload();
    } catch (cause) {
      toast.push({ title: t('staff.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const createEmployee = () =>
    run(async () => {
      await staffApi.createEmployee(tenantId, {
        name: employeeForm.name,
        phone: employeeForm.phone,
        email: employeeForm.email || undefined,
        jobTitle: employeeForm.jobTitle,
        roleCode: employeeForm.roleCode,
        contractType: employeeForm.contractType,
        hireDate: employeeForm.hireDate,
        baseSalaryXof: Number(employeeForm.baseSalaryXof) || 0,
        paymentMethod: employeeForm.paymentMethod,
        paymentDestination: employeeForm.paymentDestination || undefined,
      });
      setEmployeeModal(false);
      setEmployeeForm(EMPTY_EMPLOYEE);
    }, t('staff.created'));

  const sendInvite = () =>
    run(async () => {
      const result = await staffApi.invite(tenantId, {
        name: inviteForm.name,
        phone: inviteForm.phone,
        email: inviteForm.email || undefined,
        jobTitle: inviteForm.jobTitle,
        roleCode: inviteForm.roleCode,
      });
      setInvitation({
        token: result.invitation.token,
        channel: result.invitation.channel,
        link: result.invitation.link,
        expiresAt: result.invitation.expiresAt,
      });
      setInvitePin('');
      toast.push({
        title: t('staff.inviteSent', {
          channel:
            result.invitation.channel === 'email' ? t('staff.channelEmail') : t('staff.channelSms'),
        }),
        tone: 'success',
      });
    }, t('staff.inviteSend'));

  const acceptInvite = () =>
    run(async () => {
      if (!invitation) return;
      await staffApi.acceptInvitation(
        tenantId,
        invitation.token,
        invitePin ? { pin: invitePin } : {},
      );
      setInvitation(null);
      setInviteModal(false);
    }, t('staff.accepted'));

  const createShift = () =>
    run(async () => {
      await staffApi.createShift(tenantId, {
        employeeId: shiftForm.employeeId,
        date: shiftForm.date,
        start: shiftForm.start,
        end: shiftForm.end,
        station: shiftForm.station,
        status: shiftForm.publishNow ? 'publie' : 'planifie',
      });
      setShiftModal(false);
    }, t('staff.shiftCreated'));

  const publishShift = (shift: StaffShift) =>
    run(async () => {
      await staffApi.updateShift(tenantId, shift.id, { status: 'publie' });
    }, t('staff.shiftUpdated'));

  const requestSwap = () =>
    run(async () => {
      if (!swapModal) return;
      await staffApi.requestSwap(tenantId, swapModal.id, swapTarget);
      setSwapModal(null);
      setSwapTarget('');
    }, t('staff.swapSent'));

  const decideSwap = (swap: StaffSwap, decision: 'approuve' | 'refuse') =>
    run(
      async () => {
        await staffApi.decideSwap(tenantId, swap.id, decision);
      },
      t('staff.swapDecided', {
        decision:
          decision === 'approuve'
            ? t('staff.approve').toLowerCase()
            : t('staff.refuse').toLowerCase(),
      }),
    );

  const submitLeave = () =>
    run(async () => {
      await staffApi.requestLeave(tenantId, {
        employeeId: leaveForm.employeeId,
        type: leaveForm.type,
        from: leaveForm.from,
        to: leaveForm.to,
        reason: leaveForm.reason || undefined,
      });
      setLeaveModal(false);
      setLeaveForm({ ...leaveForm, reason: '' });
    }, t('staff.leaveSubmitted'));

  const decideLeave = (leave: StaffLeave, decision: 'approuve' | 'refuse') =>
    run(async () => {
      await staffApi.decideLeave(tenantId, leave.id, decision);
    }, t('staff.leaveSubmitted'));

  const submitAbsence = () =>
    run(async () => {
      await staffApi.recordAbsence(tenantId, {
        employeeId: absenceForm.employeeId,
        date: absenceForm.date,
        reason: absenceForm.reason || undefined,
      });
      setAbsenceModal(false);
      setAbsenceForm({ ...absenceForm, reason: '' });
    }, t('staff.absenceSaved'));

  const clockIn = async () => {
    setPending(true);
    try {
      const needsGeo = clockGeo || Boolean(geofence);
      const position = needsGeo ? await currentPosition() : null;
      if (needsGeo && !position) {
        toast.push({ title: t('staff.locationUnavailable'), tone: 'warning' });
        return;
      }
      await staffApi.clockIn(tenantId, {
        pin: clockPin,
        ...(position ? { lat: position.lat, lng: position.lng } : {}),
      });
      toast.push({ title: t('staff.clockedIn'), tone: 'success' });
      setClockModal(false);
      setClockPin('');
      setClockGeo(false);
      await reload();
    } catch (cause) {
      toast.push({ title: t('staff.error'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const clockOut = (record: StaffAttendance) =>
    run(
      async () => {
        await staffApi.clockOut(tenantId, record.id);
      },
      t('staff.clockedOut', { minutes: record.minutesWorked }),
    );

  const saveGeofence = (enable: boolean) =>
    run(async () => {
      await staffApi.saveSettings(
        tenantId,
        enable
          ? { lat: Number(geoForm.lat), lng: Number(geoForm.lng), radiusM: Number(geoForm.radiusM) }
          : null,
      );
    }, t('staff.geofenceSaved'));

  const addDocument = () =>
    run(async () => {
      if (!detail) return;
      const result = await staffApi.addDocument(tenantId, detail.employee.id, docForm);
      setDetail({ ...detail, employee: result.employee });
      setDocForm({ name: '', type: 'contrat' });
    }, t('staff.docSaved'));

  if (!canView) {
    return (
      <EmptyState icon="lock" title={t('staff.forbidden')} description={t('staff.readOnly')} />
    );
  }

  if (loading && !summary) {
    return (
      <Card>
        <CardBody>
          <SkeletonText lines={8} />
          <p className="console-muted">{t('staff.loading')}</p>
        </CardBody>
      </Card>
    );
  }

  const employeeName = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id;
  const quickShift = (date: string, start: string, end: string, employee?: StaffEmployee) => {
    setShiftForm({
      employeeId: employee?.id ?? employees[0]?.id ?? '',
      date,
      start,
      end,
      station: (employee?.roleCode === 'cook'
        ? 'cuisine'
        : employee?.roleCode === 'bartender'
          ? 'bar'
          : 'salle') as StaffShiftStation,
      publishNow: true,
    });
    setShiftModal(true);
  };

  const employeeColumns: Column<StaffEmployee>[] = [
    {
      key: 'name',
      header: t('staff.colName'),
      render: (row) => (
        <div className="console-cell">
          <strong>{row.name}</strong>
          <span>{row.jobTitle}</span>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('staff.colRole'),
      render: (row) => (
        <Badge tone="neutral">
          {t(`staff.role.${row.roleCode}`) === `staff.role.${row.roleCode}`
            ? row.roleCode
            : t(`staff.role.${row.roleCode}`)}
        </Badge>
      ),
    },
    {
      key: 'contract',
      header: t('staff.colContract'),
      render: (row) => t(`staff.contract.${row.contractType}`),
    },
    {
      key: 'status',
      header: t('staff.colStatus'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {t(`staff.status.${row.status}`)}
        </Badge>
      ),
    },
    { key: 'phone', header: t('staff.colPhone'), render: (row) => row.phone },
    {
      key: 'salary',
      header: t('staff.colSalary'),
      align: 'right',
      render: (row) => formatXof(row.baseSalaryXof, locale),
    },
    {
      key: 'hire',
      header: t('staff.colHireDate'),
      render: (row) => formatDate(row.hireDate, locale),
    },
    {
      key: 'action',
      header: t('staff.colAction'),
      render: (row) => (
        <Button size="sm" variant="ghost" onClick={() => void openDetail(row.id)}>
          {t('staff.view')}
        </Button>
      ),
    },
  ];

  const shiftColumns: Column<StaffShift>[] = [
    { key: 'date', header: t('staff.shiftDate'), render: (row) => formatDate(row.date, locale) },
    { key: 'employee', header: t('staff.shiftEmployee'), render: (row) => row.employeeName },
    {
      key: 'range',
      header: `${t('staff.shiftStart')} – ${t('staff.shiftEnd')}`,
      render: (row) => `${row.start} – ${row.end}`,
    },
    {
      key: 'station',
      header: t('staff.shiftStation'),
      render: (row) => t(`staff.station.${row.station}`),
    },
    {
      key: 'status',
      header: t('staff.colStatus'),
      render: (row) => (
        <Badge tone={SHIFT_TONE[row.status] ?? 'neutral'} dot>
          {t(`staff.shiftStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('staff.colAction'),
      render: (row) =>
        canManage ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {row.status === 'planifie' && (
              <Button size="sm" variant="outline" onClick={() => void publishShift(row)}>
                {t('staff.publish')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSwapModal(row);
                setSwapTarget('');
              }}
            >
              {t('staff.swap')}
            </Button>
          </div>
        ) : (
          <span className="console-muted">—</span>
        ),
    },
  ];

  const leaveColumns: Column<StaffLeave>[] = [
    { key: 'employee', header: t('staff.leaveEmployee'), render: (row) => row.employeeName },
    {
      key: 'type',
      header: t('staff.leaveTypeField'),
      render: (row) => t(`staff.leaveType.${row.type}`),
    },
    {
      key: 'period',
      header: `${t('staff.leaveFrom')} – ${t('staff.leaveTo')}`,
      render: (row) =>
        `${formatDate(row.from, locale)} → ${formatDate(row.to, locale)} · ${t('staff.leaveDays', { count: row.days })}`,
    },
    {
      key: 'status',
      header: t('staff.colStatus'),
      render: (row) => (
        <Badge tone={LEAVE_TONE[row.status] ?? 'neutral'} dot>
          {t(`staff.leaveStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('staff.colAction'),
      render: (row) =>
        canManage && row.status === 'en_attente' && row.type !== 'absence' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={() => void decideLeave(row, 'approuve')}>
              {t('staff.approve')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void decideLeave(row, 'refuse')}>
              {t('staff.refuse')}
            </Button>
          </div>
        ) : (
          <span className="console-muted">—</span>
        ),
    },
  ];

  const attendanceColumns: Column<StaffAttendance>[] = [
    {
      key: 'employee',
      header: t('staff.colName'),
      render: (row) => row.employeeName ?? employeeName(row.employeeId),
    },
    { key: 'in', header: t('staff.clockIn'), render: (row) => formatTime(row.clockIn, locale) },
    {
      key: 'out',
      header: t('staff.clockOut'),
      render: (row) =>
        row.clockOut ? (
          formatTime(row.clockOut, locale)
        ) : (
          <Badge tone="success" dot>
            {t('staff.openShift')}
          </Badge>
        ),
    },
    { key: 'minutes', header: t('staff.duration'), render: (row) => `${row.minutesWorked} min` },
    {
      key: 'method',
      header: t('staff.method'),
      render: (row) =>
        t(`staff.method${row.method === 'pin' ? 'Pin' : row.method === 'qr' ? 'Qr' : 'Manual'}`),
    },
    {
      key: 'action',
      header: t('staff.colAction'),
      render: (row) =>
        canManage && !row.clockOut ? (
          <Button size="sm" variant="outline" onClick={() => void clockOut(row)}>
            {t('staff.clockOut')}
          </Button>
        ) : (
          <span className="console-muted">{row.location ? 'GPS' : '—'}</span>
        ),
    },
  ];

  const performanceColumns: Column<StaffPerformanceRecord>[] = [
    { key: 'employee', header: t('staff.colName'), render: (row) => row.employeeName },
    {
      key: 'sales',
      header: t('staff.sales'),
      align: 'right',
      render: (row) => formatXof(row.salesXof, locale),
    },
    { key: 'orders', header: t('staff.orders'), align: 'right', render: (row) => row.orders },
    { key: 'tables', header: t('staff.tables'), align: 'right', render: (row) => row.tablesServed },
    {
      key: 'tips',
      header: t('staff.tips'),
      align: 'right',
      render: (row) => formatXof(row.tipsXof, locale),
    },
    {
      key: 'avg',
      header: t('staff.averageTicket'),
      align: 'right',
      render: (row) => formatXof(row.averageTicketXof, locale),
    },
  ];

  const auditColumns: Column<StaffAuditEntry>[] = [
    {
      key: 'at',
      header: t('staff.colAt'),
      render: (row) =>
        formatDate(row.createdAt, locale, {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    { key: 'actor', header: t('staff.colActor'), render: (row) => row.actorId },
    {
      key: 'action',
      header: t('staff.colAction'),
      render: (row) => <Badge tone="neutral">{row.action}</Badge>,
    },
    {
      key: 'target',
      header: t('staff.colTarget'),
      render: (row) => `${row.targetType} · ${row.targetId}`,
    },
  ];

  return (
    <div className="console-stack">
      <div className="console-toolbar">
        <SegmentedControl<Section>
          ariaLabel={t('staff.title')}
          value={section}
          onChange={setSection}
          options={[
            { value: 'team', label: t('staff.sectionTeam') },
            { value: 'planning', label: t('staff.sectionPlanning') },
            { value: 'attendance', label: t('staff.sectionAttendance') },
            { value: 'performance', label: t('staff.sectionPerformance') },
            { value: 'audit', label: t('staff.sectionAudit') },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!canManage && <Badge tone="neutral">{t('staff.readOnly')}</Badge>}
          <Button variant="outline" size="sm" iconLeft="refresh" onClick={() => void reload()}>
            {t('staff.refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {section === 'team' && (
        <>
          <div className="console-stats">
            <StatCard
              label={t('staff.statActive')}
              value={summary?.employees.active ?? 0}
              icon="users"
            />
            <StatCard
              label={t('staff.statInvited')}
              value={summary?.employees.invited ?? 0}
              icon="smartphone"
              meta={t('staff.pinDemo')}
            />
            <StatCard
              label={t('staff.statShiftsToday')}
              value={summary?.today.shifts ?? 0}
              icon="calendar"
              meta={t('staff.statPresent', {
                count: summary?.today.present ?? 0,
                open: summary?.today.stillClockedIn ?? 0,
              })}
            />
            <StatCard
              label={t('staff.statTips')}
              value={formatXof(summary?.tipsXof ?? 0, locale)}
              icon="wallet"
              meta={formatXof(summary?.salesXof ?? 0, locale)}
            />
          </div>

          <Card>
            <CardHeader
              title={t('staff.sectionTeam')}
              subtitle={t('staff.subtitle')}
              action={
                canManage ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      variant="outline"
                      iconLeft="smartphone"
                      onClick={() => {
                        setInvitation(null);
                        setInviteModal(true);
                      }}
                    >
                      {t('staff.invite')}
                    </Button>
                    <Button size="sm" iconLeft="plus" onClick={() => setEmployeeModal(true)}>
                      {t('staff.addEmployee')}
                    </Button>
                  </div>
                ) : undefined
              }
            />
            <CardBody>
              <div className="console-toolbar">
                <div className="console-search" style={{ minWidth: 260 }}>
                  <Input
                    label={t('staff.search')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    leadingIcon="search"
                  />
                </div>
                <div className="console-filters">
                  {(['all', 'actif', 'invite', 'suspendu', 'sorti'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        statusFilter === value ? 'console-filter is-active' : 'console-filter'
                      }
                      aria-pressed={statusFilter === value}
                      onClick={() => setStatusFilter(value)}
                    >
                      {value === 'all' ? t('staff.all') : t(`staff.status.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
              {filtered.length === 0 ? (
                <EmptyState
                  icon="users"
                  title={t('staff.sectionTeam')}
                  description={t('staff.search')}
                />
              ) : (
                <DataTable
                  columns={employeeColumns}
                  rows={filtered}
                  getRowId={(row) => row.id}
                  caption={t('staff.sectionTeam')}
                />
              )}
              <div className="console-2col" style={{ marginTop: 'var(--space-5)' }}>
                <Card>
                  <CardHeader
                    title={t('staff.swapsTitle')}
                    action={
                      <Badge
                        tone={
                          swaps.filter((swap) => swap.status === 'en_attente').length
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {swaps.filter((swap) => swap.status === 'en_attente').length}
                      </Badge>
                    }
                  />
                  <CardBody>
                    {swaps.length === 0 ? (
                      <p className="console-muted">{t('staff.swapsEmpty')}</p>
                    ) : (
                      <ul className="console-queue">
                        {swaps.slice(0, 6).map((swap) => (
                          <li key={swap.id}>
                            <div>
                              <strong>
                                {swap.fromEmployeeName} → {swap.toEmployeeName}
                              </strong>
                              <span>
                                {swap.shift
                                  ? `${formatDate(swap.shift.date, locale)} · ${swap.shift.start}–${swap.shift.end}`
                                  : '—'}
                              </span>
                            </div>
                            {swap.status === 'en_attente' && canManage ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <Button size="sm" onClick={() => void decideSwap(swap, 'approuve')}>
                                  {t('staff.approve')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void decideSwap(swap, 'refuse')}
                                >
                                  {t('staff.refuse')}
                                </Button>
                              </div>
                            ) : (
                              <Badge tone={LEAVE_TONE[swap.status] ?? 'neutral'}>
                                {t(`staff.swapStatus.${swap.status}`)}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader
                    title={t('staff.leavesTitle')}
                    action={
                      canManage ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" onClick={() => setAbsenceModal(true)}>
                            {t('staff.recordAbsence')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setLeaveModal(true)}>
                            {t('staff.requestLeave')}
                          </Button>
                        </div>
                      ) : undefined
                    }
                  />
                  <CardBody>
                    {leaves.filter((leave) => leave.type !== 'absence').length === 0 ? (
                      <p className="console-muted">{t('staff.leavesEmpty')}</p>
                    ) : (
                      <DataTable
                        columns={leaveColumns}
                        rows={leaves.filter((leave) => leave.type !== 'absence').slice(0, 8)}
                        getRowId={(row) => row.id}
                        caption={t('staff.leavesTitle')}
                      />
                    )}
                  </CardBody>
                </Card>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {section === 'planning' && (
        <>
          <div className="console-toolbar">
            <div>
              <h2 style={{ margin: 0 }}>{t('staff.planningTitle')}</h2>
              <p className="console-muted" style={{ margin: 0 }}>
                {t('staff.planningHint')}
              </p>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => quickShift(todayIso(), '11:00', '17:00')}
                >
                  {`${t('staff.shiftDate')} · ${formatDate(todayIso(), locale)}`}
                </Button>
                <Button
                  size="sm"
                  iconLeft="plus"
                  onClick={() => {
                    setShiftForm({ ...shiftForm, employeeId: employees[0]?.id ?? '' });
                    setShiftModal(true);
                  }}
                >
                  {t('staff.addShift')}
                </Button>
              </div>
            )}
          </div>
          <Card>
            <CardHeader
              title={t('staff.planningTitle')}
              subtitle={`${formatDate(plusDays(-1), locale)} → ${formatDate(plusDays(21), locale)}`}
            />
            <CardBody>
              <DataTable
                columns={shiftColumns}
                rows={shifts}
                getRowId={(row) => row.id}
                caption={t('staff.planningTitle')}
              />
            </CardBody>
          </Card>
        </>
      )}

      {section === 'attendance' && (
        <>
          <div className="console-toolbar">
            <div>
              <h2 style={{ margin: 0 }}>{t('staff.attendanceTitle')}</h2>
              <p className="console-muted" style={{ margin: 0 }}>
                {t('staff.clockHint')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Input
                label={t('staff.attendanceDate')}
                type="date"
                value={attendanceDate}
                onChange={(event) => setAttendanceDate(event.target.value)}
              />
              {canManage && (
                <Button size="sm" iconLeft="clock" onClick={() => setClockModal(true)}>
                  {t('staff.clockIn')}
                </Button>
              )}
            </div>
          </div>

          <div className="console-2col">
            <Card>
              <CardHeader
                title={t('staff.attendanceTitle')}
                action={
                  <Badge tone="info">
                    {attendance.filter((record) => !record.clockOut).length} {t('staff.openShift')}
                  </Badge>
                }
              />
              <CardBody>
                {attendance.length === 0 ? (
                  <EmptyState
                    icon="clock"
                    title={t('staff.attendanceEmpty')}
                    description={t('staff.clockHint')}
                  />
                ) : (
                  <DataTable
                    columns={attendanceColumns}
                    rows={attendance}
                    getRowId={(row) => row.id}
                    caption={t('staff.attendanceTitle')}
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('staff.geofenceTitle')} subtitle={t('staff.geofenceHint')} />
              <CardBody>
                <p className="console-muted">
                  {geofence
                    ? t('staff.geofenceEnabled', { radius: geofence.radiusM })
                    : t('staff.geofenceDisabled')}
                </p>
                <div className="console-stack">
                  <Input
                    label={t('staff.geofenceLat')}
                    value={geoForm.lat}
                    onChange={(event) => setGeoForm({ ...geoForm, lat: event.target.value })}
                  />
                  <Input
                    label={t('staff.geofenceLng')}
                    value={geoForm.lng}
                    onChange={(event) => setGeoForm({ ...geoForm, lng: event.target.value })}
                  />
                  <Input
                    label={t('staff.geofenceRadius')}
                    type="number"
                    min={20}
                    max={5000}
                    value={geoForm.radiusM}
                    hint="20 – 5 000 m"
                    onChange={(event) => setGeoForm({ ...geoForm, radiusM: event.target.value })}
                  />
                  {canManage && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button size="sm" loading={pending} onClick={() => void saveGeofence(true)}>
                        {t('staff.saveGeofence')}
                      </Button>
                      {geofence && (
                        <Button size="sm" variant="ghost" onClick={() => void saveGeofence(false)}>
                          {t('staff.disableGeofence')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {section === 'performance' && (
        <>
          <div className="console-stats">
            <StatCard
              label={t('staff.sales')}
              value={formatXof(performance?.totals.salesXof ?? 0, locale)}
              icon="chart"
            />
            <StatCard
              label={t('staff.orders')}
              value={performance?.totals.orders ?? 0}
              icon="receipt"
            />
            <StatCard
              label={t('staff.tables')}
              value={performance?.totals.tablesServed ?? 0}
              icon="grid"
            />
            <StatCard
              label={t('staff.tips')}
              value={formatXof(performance?.totals.tipsXof ?? 0, locale)}
              icon="wallet"
            />
          </div>
          <Card>
            <CardHeader
              title={t('staff.performanceHeading')}
              subtitle={t('staff.performanceHint')}
            />
            <CardBody>
              {!performance || performance.items.length === 0 ? (
                <EmptyState
                  icon="chart"
                  title={t('staff.performanceEmpty')}
                  description={t('staff.performanceHint')}
                />
              ) : (
                <DataTable
                  columns={performanceColumns}
                  rows={performance.items}
                  getRowId={(row) => row.employeeId}
                  caption={t('staff.performanceHeading')}
                />
              )}
            </CardBody>
          </Card>
        </>
      )}

      {section === 'audit' && (
        <Card>
          <CardHeader
            title={t('staff.auditTitle')}
            subtitle={t('staff.auditHint')}
            action={
              <Badge tone={audit?.integrity ? 'success' : 'danger'} dot>
                {audit?.integrity ? t('staff.auditIntegrityOk') : t('staff.auditIntegrityBroken')}
              </Badge>
            }
          />
          <CardBody>
            {!audit || audit.entries.length === 0 ? (
              <EmptyState
                icon="shield"
                title={t('staff.auditEmpty')}
                description={t('staff.auditHint')}
              />
            ) : (
              <DataTable
                columns={auditColumns}
                rows={audit.entries}
                getRowId={(row) => row.id}
                caption={t('staff.auditTitle')}
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------ Modales ------------------------------ */}
      <Modal
        open={employeeModal}
        onClose={() => setEmployeeModal(false)}
        title={t('staff.addEmployee')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEmployeeModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void createEmployee()}>
              {t('staff.create')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('staff.formName')}
            required
            value={employeeForm.name}
            onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })}
          />
          <Input
            label={t('staff.formPhone')}
            required
            placeholder="+228 90 00 00 00"
            value={employeeForm.phone}
            onChange={(event) => setEmployeeForm({ ...employeeForm, phone: event.target.value })}
          />
          <Input
            label={t('staff.formEmail')}
            type="email"
            value={employeeForm.email}
            onChange={(event) => setEmployeeForm({ ...employeeForm, email: event.target.value })}
          />
          <Input
            label={t('staff.formJobTitle')}
            required
            value={employeeForm.jobTitle}
            onChange={(event) => setEmployeeForm({ ...employeeForm, jobTitle: event.target.value })}
          />
          <Select
            label={t('staff.formRole')}
            value={employeeForm.roleCode}
            onChange={(event) => setEmployeeForm({ ...employeeForm, roleCode: event.target.value })}
            options={ROLES.map((role) => ({ value: role, label: t(`staff.role.${role}`) }))}
          />
          <Select
            label={t('staff.formContract')}
            value={employeeForm.contractType}
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                contractType: event.target.value as StaffContractType,
              })
            }
            options={CONTRACTS.map((contract) => ({
              value: contract,
              label: t(`staff.contract.${contract}`),
            }))}
          />
          <Input
            label={t('staff.formHireDate')}
            type="date"
            value={employeeForm.hireDate}
            onChange={(event) => setEmployeeForm({ ...employeeForm, hireDate: event.target.value })}
          />
          <Input
            label={t('staff.formSalary')}
            type="number"
            min={0}
            value={employeeForm.baseSalaryXof}
            onChange={(event) =>
              setEmployeeForm({ ...employeeForm, baseSalaryXof: event.target.value })
            }
          />
          <Select
            label={t('staff.formPaymentMethod')}
            value={employeeForm.paymentMethod}
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                paymentMethod: event.target.value as StaffEmployee['paymentMethod'],
              })
            }
            options={['mobile_money', 'bank', 'cash'].map((method) => ({
              value: method,
              label: t(`staff.paymentMethod.${method}`),
            }))}
          />
          <Input
            label={t('staff.formDestination')}
            value={employeeForm.paymentDestination}
            onChange={(event) =>
              setEmployeeForm({ ...employeeForm, paymentDestination: event.target.value })
            }
            placeholder="TMoney 90 12 34 56"
          />
        </div>
      </Modal>

      <Modal
        open={inviteModal}
        onClose={() => setInviteModal(false)}
        title={t('staff.inviteTitle')}
        description={t('staff.inviteHint')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setInviteModal(false)}>
              {t('staff.close')}
            </Button>
            {!invitation && (
              <Button loading={pending} onClick={() => void sendInvite()}>
                {t('staff.inviteSend')}
              </Button>
            )}
          </div>
        }
      >
        {invitation ? (
          <div className="console-stack">
            <Badge tone="success" dot>
              {t('staff.inviteSent', {
                channel:
                  invitation.channel === 'email' ? t('staff.channelEmail') : t('staff.channelSms'),
              })}
            </Badge>
            <p className="console-muted">
              {t('staff.inviteExpires', { date: formatDate(invitation.expiresAt, locale) })}
            </p>
            <div className="console-kv">
              <div>
                <dt>{t('staff.inviteLink')}</dt>
                <dd style={{ wordBreak: 'break-all' }}>{invitation.link}</dd>
              </div>
            </div>
            <p className="console-muted">{t('staff.acceptHint')}</p>
            <Input
              label={t('staff.pin')}
              inputMode="numeric"
              maxLength={4}
              value={invitePin}
              onChange={(event) => setInvitePin(event.target.value.replace(/\D/g, ''))}
            />
            <Button
              size="sm"
              variant="outline"
              loading={pending}
              onClick={() => void acceptInvite()}
            >
              {t('staff.acceptTest')}
            </Button>
          </div>
        ) : (
          <div className="console-stack">
            <Input
              label={t('staff.formName')}
              required
              value={inviteForm.name}
              onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })}
            />
            <Input
              label={t('staff.formPhone')}
              required
              value={inviteForm.phone}
              onChange={(event) => setInviteForm({ ...inviteForm, phone: event.target.value })}
            />
            <Input
              label={t('staff.formEmail')}
              type="email"
              value={inviteForm.email}
              onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
            />
            <Input
              label={t('staff.formJobTitle')}
              required
              value={inviteForm.jobTitle}
              onChange={(event) => setInviteForm({ ...inviteForm, jobTitle: event.target.value })}
            />
            <Select
              label={t('staff.formRole')}
              value={inviteForm.roleCode}
              onChange={(event) => setInviteForm({ ...inviteForm, roleCode: event.target.value })}
              options={ROLES.map((role) => ({ value: role, label: t(`staff.role.${role}`) }))}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={shiftModal}
        onClose={() => setShiftModal(false)}
        title={t('staff.addShift')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setShiftModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void createShift()}>
              {t('staff.save')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('staff.shiftEmployee')}
            value={shiftForm.employeeId}
            onChange={(event) => setShiftForm({ ...shiftForm, employeeId: event.target.value })}
            options={employees
              .filter((employee) => employee.status === 'actif')
              .map((employee) => ({
                value: employee.id,
                label: `${employee.name} · ${employee.jobTitle}`,
              }))}
          />
          <Input
            label={t('staff.shiftDate')}
            type="date"
            value={shiftForm.date}
            onChange={(event) => setShiftForm({ ...shiftForm, date: event.target.value })}
          />
          <Input
            label={t('staff.shiftStart')}
            type="time"
            value={shiftForm.start}
            onChange={(event) => setShiftForm({ ...shiftForm, start: event.target.value })}
          />
          <Input
            label={t('staff.shiftEnd')}
            type="time"
            value={shiftForm.end}
            onChange={(event) => setShiftForm({ ...shiftForm, end: event.target.value })}
          />
          <Select
            label={t('staff.shiftStation')}
            value={shiftForm.station}
            onChange={(event) =>
              setShiftForm({ ...shiftForm, station: event.target.value as StaffShiftStation })
            }
            options={STATIONS.map((station) => ({
              value: station,
              label: t(`staff.station.${station}`),
            }))}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={shiftForm.publishNow}
              onChange={(event) => setShiftForm({ ...shiftForm, publishNow: event.target.checked })}
            />
            <span>{t('staff.publishNow')}</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(swapModal)}
        onClose={() => setSwapModal(null)}
        title={t('staff.swapTitle')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setSwapModal(null)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void requestSwap()}>
              {t('staff.swap')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          {swapModal && (
            <p className="console-muted">
              {swapModal.employeeName} · {formatDate(swapModal.date, locale)} · {swapModal.start}–
              {swapModal.end} ({Math.round(shiftMinutes(swapModal) / 60)} h)
            </p>
          )}
          <Select
            label={t('staff.swapTo')}
            value={swapTarget}
            onChange={(event) => setSwapTarget(event.target.value)}
            options={employees
              .filter(
                (employee) => employee.status === 'actif' && employee.id !== swapModal?.employeeId,
              )
              .map((employee) => ({ value: employee.id, label: employee.name }))}
          />
        </div>
      </Modal>

      <Modal
        open={leaveModal}
        onClose={() => setLeaveModal(false)}
        title={t('staff.requestLeave')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setLeaveModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void submitLeave()}>
              {t('staff.save')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('staff.leaveEmployee')}
            value={leaveForm.employeeId}
            onChange={(event) => setLeaveForm({ ...leaveForm, employeeId: event.target.value })}
            options={employees.map((employee) => ({ value: employee.id, label: employee.name }))}
          />
          <Select
            label={t('staff.leaveTypeField')}
            value={leaveForm.type}
            onChange={(event) =>
              setLeaveForm({ ...leaveForm, type: event.target.value as StaffLeaveType })
            }
            options={LEAVE_TYPES.map((type) => ({
              value: type,
              label: t(`staff.leaveType.${type}`),
            }))}
          />
          <Input
            label={t('staff.leaveFrom')}
            type="date"
            value={leaveForm.from}
            onChange={(event) => setLeaveForm({ ...leaveForm, from: event.target.value })}
          />
          <Input
            label={t('staff.leaveTo')}
            type="date"
            value={leaveForm.to}
            onChange={(event) => setLeaveForm({ ...leaveForm, to: event.target.value })}
          />
          <Textarea
            label={t('staff.leaveReason')}
            value={leaveForm.reason}
            onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={absenceModal}
        onClose={() => setAbsenceModal(false)}
        title={t('staff.recordAbsence')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setAbsenceModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button loading={pending} onClick={() => void submitAbsence()}>
              {t('staff.save')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Select
            label={t('staff.leaveEmployee')}
            value={absenceForm.employeeId}
            onChange={(event) => setAbsenceForm({ ...absenceForm, employeeId: event.target.value })}
            options={employees.map((employee) => ({ value: employee.id, label: employee.name }))}
          />
          <Input
            label={t('staff.absenceDate')}
            type="date"
            value={absenceForm.date}
            onChange={(event) => setAbsenceForm({ ...absenceForm, date: event.target.value })}
          />
          <Textarea
            label={t('staff.leaveReason')}
            value={absenceForm.reason}
            onChange={(event) => setAbsenceForm({ ...absenceForm, reason: event.target.value })}
          />
        </div>
      </Modal>

      <Modal
        open={clockModal}
        onClose={() => setClockModal(false)}
        title={t('staff.clockTitle')}
        description={t('staff.clockHint')}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setClockModal(false)}>
              {t('staff.cancel')}
            </Button>
            <Button
              loading={pending}
              disabled={clockPin.length !== 4}
              onClick={() => void clockIn()}
            >
              {t('staff.clockIn')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <Input
            label={t('staff.pin')}
            inputMode="numeric"
            maxLength={4}
            autoComplete="one-time-code"
            value={clockPin}
            onChange={(event) => setClockPin(event.target.value.replace(/\D/g, ''))}
            hint={t('staff.pinDemo')}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={clockGeo || Boolean(geofence)}
              disabled={Boolean(geofence)}
              onChange={(event) => setClockGeo(event.target.checked)}
            />
            <span>
              {t('staff.useLocation')}
              {geofence ? ` · ${t('staff.geofenceEnabled', { radius: geofence.radiusM })}` : ''}
            </span>
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail?.employee.name ?? t('staff.employeeTitle')}
        description={
          detail
            ? t('staff.employeeMeta', {
                role: detail.employee.jobTitle,
                date: formatDate(detail.employee.hireDate, locale),
              })
            : undefined
        }
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            {t('staff.close')}
          </Button>
        }
      >
        {detail && (
          <div className="console-stack">
            <div className="console-detail__badges">
              <Badge tone={STATUS_TONE[detail.employee.status]} dot>
                {t(`staff.status.${detail.employee.status}`)}
              </Badge>
              <Badge tone="info">{t(`staff.contract.${detail.employee.contractType}`)}</Badge>
              <Badge tone="neutral">
                {t(`staff.paymentMethod.${detail.employee.paymentMethod}`)}
              </Badge>
            </div>
            <dl className="console-kv">
              <div>
                <dt>{t('staff.colPhone')}</dt>
                <dd>{detail.employee.phone}</dd>
              </div>
              <div>
                <dt>{t('staff.formEmail')}</dt>
                <dd>{detail.employee.email ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('staff.colSalary')}</dt>
                <dd>{formatXof(detail.employee.baseSalaryXof, locale)}</dd>
              </div>
              <div>
                <dt>{t('staff.paymentDestination')}</dt>
                <dd>{detail.employee.paymentDestination}</dd>
              </div>
              <div>
                <dt>{t('staff.pin')}</dt>
                <dd>{detail.employee.pinMasked}</dd>
              </div>
              <div>
                <dt>{t('staff.qrBadge')}</dt>
                <dd>{detail.employee.qrToken.slice(0, 8)}…</dd>
              </div>
            </dl>
            <div
              className="console-stats"
              style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
            >
              <StatCard
                label={t('staff.sales')}
                value={formatXof(detail.performance.salesXof, locale)}
              />
              <StatCard label={t('staff.orders')} value={detail.performance.orders} />
              <StatCard label={t('staff.tables')} value={detail.performance.tablesServed} />
              <StatCard
                label={t('staff.tips')}
                value={formatXof(detail.performance.tipsXof, locale)}
              />
            </div>
            <Card>
              <CardHeader
                title={t('staff.documents')}
                action={<Badge tone="neutral">{detail.employee.documents.length}</Badge>}
              />
              <CardBody>
                {detail.employee.documents.length === 0 ? (
                  <p className="console-muted">{t('staff.noDocuments')}</p>
                ) : (
                  <ul className="console-docs">
                    {detail.employee.documents.map((document) => (
                      <li key={document.id}>
                        <div>
                          <strong>{document.name}</strong>
                          <span>
                            {document.type} · {formatDate(document.uploadedAt, locale)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <div
                    className="console-toolbar"
                    style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}
                  >
                    <Input
                      label={t('staff.docName')}
                      value={docForm.name}
                      onChange={(event) => setDocForm({ ...docForm, name: event.target.value })}
                    />
                    <Input
                      label={t('staff.docType')}
                      value={docForm.type}
                      onChange={(event) => setDocForm({ ...docForm, type: event.target.value })}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pending}
                      disabled={docForm.name.trim().length < 2}
                      onClick={() => void addDocument()}
                    >
                      {t('staff.addDocument')}
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('staff.shiftHistory')} />
              <CardBody>
                {detail.shifts.length === 0 ? (
                  <p className="console-muted">{t('staff.noHistory')}</p>
                ) : (
                  <DataTable
                    columns={shiftColumns}
                    rows={detail.shifts.slice(-8)}
                    getRowId={(row) => row.id}
                    caption={t('staff.shiftHistory')}
                  />
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </Modal>

      {!employees.length && !loading && (
        <EmptyState
          icon="users"
          title={t('staff.sectionTeam')}
          description={t('staff.readOnly')}
          action={
            canManage ? (
              <Button onClick={() => setEmployeeModal(true)}>{t('staff.addEmployee')}</Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
