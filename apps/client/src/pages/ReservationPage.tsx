import { useEffect, useMemo, useState } from 'react';
import { Icon, Skeleton, cx, useI18n, useToast } from '@resto-hub/design-system';
import { ApiError, publicApi, type Reservation, type ReservationAvailability } from '../lib/api';
import { useEstablishment } from '../lib/hooks';
import { useTenantTheme } from '../lib/tenantTheme';
import { navigate } from '../lib/router';
import { recordReservation, updateReservationStatus } from '../lib/localStore';
import { ClientHeader } from '../components/ClientChrome';
import { loadCustomerDraft } from './CartPage';

function lomeToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(iso: string, locale: string): { weekday: string; day: string } {
  const date = new Date(`${iso}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    }).format(date),
  };
}

function prettyDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
}

export default function ReservationPage({
  slug,
  existingId,
  existingToken,
}: {
  slug: string;
  existingId?: string;
  existingToken?: string;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { data, loading } = useEstablishment(slug);
  const establishment = data?.establishment;
  useTenantTheme(
    establishment
      ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor }
      : null,
  );

  const today = lomeToday();
  const draft = loadCustomerDraft();
  const [date, setDate] = useState(today);
  const [partySize, setPartySize] = useState(2);
  const [time, setTime] = useState('');
  const [tableId, setTableId] = useState('');
  const [name, setName] = useState(draft.name);
  const [phone, setPhone] = useState(draft.phone);
  const [note, setNote] = useState('');
  const [availability, setAvailability] = useState<ReservationAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ reservation: Reservation; token: string } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_unused, index) => addDays(today, index)),
    [today],
  );

  useEffect(() => {
    if (!establishment) return;
    let alive = true;
    setAvailabilityLoading(true);
    publicApi
      .reservationAvailability(establishment.id, date, partySize)
      .then((result) => {
        if (!alive) return;
        setAvailability(result);
        setTime((current) =>
          result.slots.some((slot) => slot.time === current && slot.available) ? current : '',
        );
        setTableId((current) =>
          result.tables.some((table) => table.id === current) ? current : '',
        );
      })
      .catch(() => {
        if (alive) setAvailability(null);
      })
      .finally(() => {
        if (alive) setAvailabilityLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [establishment, date, partySize]);

  useEffect(() => {
    if (!establishment || !existingId || !existingToken) return;
    let alive = true;
    publicApi
      .reservation(establishment.id, existingId, existingToken)
      .then((result) => {
        if (alive) setConfirmed({ reservation: result.reservation, token: existingToken });
      })
      .catch(() => {
        /* lien invalide : formulaire standard */
      });
    return () => {
      alive = false;
    };
  }, [establishment, existingId, existingToken]);

  const submit = async () => {
    if (!establishment) return;
    if (!time) {
      toast.push({ title: t('reservation.picks'), tone: 'warning' });
      return;
    }
    if (!name.trim() || !phone.trim()) {
      toast.push({ title: t('checkout.customerRequired'), tone: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await publicApi.createReservation(establishment.id, {
        date,
        time,
        partySize,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(tableId ? { tableId } : {}),
      });
      recordReservation({
        tenantId: establishment.id,
        tenantName: establishment.brandName,
        token: result.publicToken,
        reservation: result.reservation,
      });
      setConfirmed({ reservation: result.reservation, token: result.publicToken });
      toast.push({ title: t('reservation.confirmedTitle'), tone: 'success' });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      toast.push({
        title:
          code === 'no_table_available'
            ? t('reservation.errorNoTable')
            : code === 'invalid_date'
              ? t('reservation.errorDate')
              : t('common.error'),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!establishment || !confirmed) return;
    if (!window.confirm(t('reservation.cancelConfirm'))) return;
    setCancelling(true);
    try {
      const result = await publicApi.cancelReservation(
        establishment.id,
        confirmed.reservation.id,
        confirmed.token,
      );
      updateReservationStatus(result.reservation.id, result.reservation.status);
      setConfirmed({ reservation: result.reservation, token: confirmed.token });
      toast.push({ title: t('reservation.cancelled'), tone: 'success' });
    } catch {
      toast.push({ title: t('common.error'), tone: 'error' });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('reservation.title')} back={`/e/${slug}`} />
        <main className="rh-client-page">
          <Skeleton height={140} />
          <Skeleton height={200} />
        </main>
      </div>
    );
  }

  if (!establishment) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('reservation.title')} back="/recherche" />
        <main className="rh-client-page">
          <p className="rh-client-muted">{t('common.error')}</p>
        </main>
      </div>
    );
  }

  if (confirmed) {
    const reservation = confirmed.reservation;
    const statusKey =
      reservation.status === 'confirmee'
        ? 'statusConfirmee'
        : reservation.status === 'installee'
          ? 'statusInstallee'
          : reservation.status === 'annulee'
            ? 'statusAnnulee'
            : 'statusNoShow';
    return (
      <div className="rh-client-screen">
        <ClientHeader
          title={t('reservation.confirmedTitle')}
          back={`/e/${establishment.slug}`}
          logo={establishment.logoUrl}
        />
        <main className="rh-client-page rh-client-page--flush">
          <section
            className={cx('rh-resa-ticket', reservation.status === 'annulee' && 'is-cancelled')}
          >
            <span className="rh-resa-ticket__icon">
              <Icon
                name={reservation.status === 'annulee' ? 'x-circle' : 'check-circle'}
                size="lg"
              />
            </span>
            <h1>
              {reservation.status === 'annulee'
                ? t('reservation.cancelled')
                : t('reservation.confirmedTitle')}
            </h1>
            <p>
              {reservation.status === 'annulee'
                ? t('reservation.statusAnnulee')
                : t('reservation.confirmedDesc')}
            </p>
            <div className="rh-resa-ticket__grid">
              <div>
                <span>{t('reservation.reference')}</span>
                <strong>{reservation.reference}</strong>
              </div>
              <div>
                <span>{t('reservation.date')}</span>
                <strong>{prettyDate(reservation.date, locale)}</strong>
              </div>
              <div>
                <span>{t('reservation.time')}</span>
                <strong>{reservation.time}</strong>
              </div>
              <div>
                <span>{t('reservation.party')}</span>
                <strong>{t('reservation.partyValue', { count: reservation.partySize })}</strong>
              </div>
              <div>
                <span>{t('reservation.table')}</span>
                <strong>{reservation.tableCode ?? t('reservation.anyTable')}</strong>
              </div>
              <div>
                <span>{t('tracking.status')}</span>
                <strong>{t(`reservation.${statusKey}`)}</strong>
              </div>
            </div>
            {reservation.note && <p className="rh-client-hint">{reservation.note}</p>}
          </section>
          <div className="rh-resa-actions">
            {reservation.status === 'confirmee' && (
              <button
                type="button"
                className="rh-client-btn rh-client-btn--ghost rh-client-btn--block"
                onClick={cancel}
                disabled={cancelling}
              >
                <Icon name="x" size="sm" /> {t('reservation.cancelReservation')}
              </button>
            )}
            <button
              type="button"
              className="rh-client-btn rh-client-btn--primary rh-client-btn--block"
              onClick={() => navigate(`/e/${establishment.slug}/menu`)}
            >
              <Icon name="utensils" size="sm" /> {t('establishment.menu')}
            </button>
            <button
              type="button"
              className="rh-client-btn rh-client-btn--ghost rh-client-btn--block"
              onClick={() => navigate('/commandes')}
            >
              {t('reservation.myReservations')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="rh-client-screen">
      <ClientHeader
        title={t('reservation.title')}
        subtitle={t('reservation.subtitle', { tenant: establishment.brandName })}
        back={`/e/${establishment.slug}`}
        logo={establishment.logoUrl}
      />
      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-resa-section">
          <h2>{t('reservation.date')}</h2>
          <div className="rh-resa-days" role="group" aria-label={t('reservation.date')}>
            {days.map((iso) => {
              const label = dayLabel(iso, locale);
              return (
                <button
                  key={iso}
                  type="button"
                  className={cx('rh-resa-day', iso === date && 'is-active')}
                  onClick={() => setDate(iso)}
                  aria-pressed={iso === date}
                >
                  <span>{iso === today ? t('common.today') : label.weekday}</span>
                  <strong>{label.day}</strong>
                </button>
              );
            })}
          </div>
          <label className="rh-client-field">
            <span>{t('reservation.date')}</span>
            <input
              type="date"
              className="rh-client-input"
              value={date}
              min={today}
              max={addDays(today, 60)}
              onChange={(event) => setDate(event.target.value || today)}
            />
          </label>
        </section>

        <section className="rh-resa-section">
          <h2>{t('reservation.party')}</h2>
          <div className="rh-resa-party">
            <button
              type="button"
              className="rh-resa-step"
              aria-label={t('common.remove')}
              onClick={() => setPartySize((value) => Math.max(1, value - 1))}
              disabled={partySize <= 1}
            >
              <Icon name="minus" />
            </button>
            <strong>{t('reservation.partyValue', { count: partySize })}</strong>
            <button
              type="button"
              className="rh-resa-step"
              aria-label={t('common.add')}
              onClick={() => setPartySize((value) => Math.min(16, value + 1))}
              disabled={partySize >= 16}
            >
              <Icon name="plus" />
            </button>
          </div>
        </section>

        <section className="rh-resa-section">
          <h2>{t('reservation.slots')}</h2>
          {availabilityLoading ? (
            <Skeleton height={64} />
          ) : !availability || availability.slots.every((slot) => !slot.available) ? (
            <p className="rh-client-hint">
              <Icon name="info" size="sm" /> {t('reservation.noSlots')}
            </p>
          ) : (
            <div className="rh-resa-slots" role="group" aria-label={t('reservation.slots')}>
              {availability.slots.map((slot) => (
                <button
                  key={slot.time}
                  type="button"
                  className={cx(
                    'rh-resa-slot',
                    time === slot.time && 'is-active',
                    !slot.available && 'is-full',
                  )}
                  disabled={!slot.available}
                  onClick={() => setTime(slot.time)}
                  aria-pressed={time === slot.time}
                >
                  <strong>{slot.time}</strong>
                  <span>
                    {slot.available
                      ? t('reservation.seats', { count: slot.tablesAvailable })
                      : t('reservation.full')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rh-resa-section">
          <h2>{t('reservation.tables')}</h2>
          <p className="rh-client-hint">{t('reservation.tablesHint')}</p>
          <div className="rh-resa-tables">
            <button
              type="button"
              className={cx('rh-resa-table', tableId === '' && 'is-active')}
              onClick={() => setTableId('')}
              aria-pressed={tableId === ''}
            >
              <Icon name="users" size="sm" /> {t('reservation.anyTable')}
            </button>
            {(availability?.tables ?? []).map((table) => (
              <button
                key={table.id}
                type="button"
                className={cx('rh-resa-table', tableId === table.id && 'is-active')}
                onClick={() => setTableId(table.id)}
                aria-pressed={tableId === table.id}
              >
                <strong>{table.code}</strong>
                <span>
                  {table.zoneName ?? table.type} ·{' '}
                  {t('reservation.seats', { count: table.effectiveCapacity })}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rh-resa-section">
          <h2>{t('reservation.detailsTitle')}</h2>
          <label className="rh-client-field">
            <span>{t('reservation.name')}</span>
            <input
              className="rh-client-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="rh-client-field">
            <span>{t('reservation.phone')}</span>
            <input
              className="rh-client-input"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+228 90 12 34 56"
            />
          </label>
          <label className="rh-client-field">
            <span>
              {t('reservation.note')} <em>({t('reservation.optional')})</em>
            </span>
            <textarea
              className="rh-client-input"
              rows={2}
              placeholder={t('reservation.notePlaceholder')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </section>

        <div className="rh-resa-actions">
          <button
            type="button"
            className="rh-client-btn rh-client-btn--primary rh-client-btn--block rh-client-btn--lg"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? t('reservation.confirming') : t('reservation.confirm')}
          </button>
        </div>
      </main>
    </div>
  );
}
