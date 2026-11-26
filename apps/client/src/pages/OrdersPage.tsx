import { useEffect, useState } from 'react';
import {
  Icon,
  cx,
  formatDate,
  formatTime,
  formatXof,
  useI18n,
  useToast,
} from '@resto-hub/design-system';
import { publicApi } from '../lib/api';
import {
  listOrders,
  listReservations,
  updateReservationStatus,
  type LocalOrder,
  type LocalReservation,
} from '../lib/localStore';
import { navigate } from '../lib/router';
import { ClientBottomBar, ClientHeader } from '../components/ClientChrome';

const ORDER_TONES: Record<string, string> = {
  recue: 'info',
  en_preparation: 'warning',
  prete: 'success',
  servie: 'success',
  annulee: 'error',
};

const ORDER_KEYS: Record<string, string> = {
  recue: 'statusRecue',
  en_preparation: 'statusEnPreparation',
  prete: 'statusPrete',
  servie: 'statusServie',
  annulee: 'statusAnnulee',
};

export default function OrdersPage({ initialTab }: { initialTab?: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'orders' | 'reservations'>(
    initialTab === 'reservations' ? 'reservations' : 'orders',
  );
  const [orders, setOrders] = useState<LocalOrder[]>(() => listOrders());
  const [reservations, setReservations] = useState<LocalReservation[]>(() => listReservations());

  useEffect(() => {
    const refresh = () => {
      setOrders(listOrders());
      setReservations(listReservations());
    };
    window.addEventListener('restohub:client-history', refresh);
    return () => window.removeEventListener('restohub:client-history', refresh);
  }, []);

  const cancelReservation = async (reservation: LocalReservation) => {
    if (!window.confirm(t('reservation.cancelConfirm'))) return;
    try {
      const result = await publicApi.cancelReservation(
        reservation.tenantId,
        reservation.reservationId,
        reservation.token,
      );
      updateReservationStatus(result.reservation.id, result.reservation.status);
      toast.push({ title: t('reservation.cancelled'), tone: 'success' });
    } catch {
      toast.push({ title: t('common.error'), tone: 'error' });
    }
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />
      <main className="rh-client-page rh-client-page--flush">
        <div className="rh-history-tabs" role="tablist" aria-label={t('orders.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'orders'}
            className={cx('rh-history-tab', tab === 'orders' && 'is-active')}
            onClick={() => setTab('orders')}
          >
            <Icon name="receipt" size="sm" /> {t('orders.title')}
            <span>{orders.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reservations'}
            className={cx('rh-history-tab', tab === 'reservations' && 'is-active')}
            onClick={() => setTab('reservations')}
          >
            <Icon name="calendar" size="sm" /> {t('orders.reservationTitle')}
            <span>{reservations.length}</span>
          </button>
        </div>

        {tab === 'orders' && (
          <section className="rh-history-list">
            {orders.length === 0 ? (
              <div className="rh-client-empty">
                <span className="rh-client-empty__icon">
                  <Icon name="receipt" />
                </span>
                <h2>{t('orders.empty')}</h2>
                <p>{t('orders.emptyDesc')}</p>
                <button
                  type="button"
                  className="rh-client-btn rh-client-btn--primary"
                  onClick={() => navigate('/recherche')}
                >
                  {t('explore.title')}
                </button>
              </div>
            ) : (
              orders.map((order) => (
                <article key={order.orderId} className="rh-history-card">
                  <header>
                    <div>
                      <strong>{order.tenantName}</strong>
                      <span>
                        {order.number} · {formatDate(order.createdAt, locale)}{' '}
                        {formatTime(order.createdAt, locale)}
                      </span>
                    </div>
                    <span
                      className={cx(
                        'rh-client-pill',
                        `rh-client-pill--${ORDER_TONES[order.status] ?? 'info'}`,
                      )}
                    >
                      {t(`orders.${ORDER_KEYS[order.status] ?? 'statusRecue'}`)}
                    </span>
                  </header>
                  <ul>
                    {order.lines.slice(0, 3).map((line, index) => (
                      <li key={`${order.orderId}-${index}`}>
                        <span>
                          {line.quantity} × {line.name}
                        </span>
                      </li>
                    ))}
                    {order.lines.length > 3 && (
                      <li className="rh-client-muted">+ {order.lines.length - 3}</li>
                    )}
                  </ul>
                  <footer>
                    <strong>{formatXof(order.totalXof, locale)}</strong>
                    <div>
                      <button
                        type="button"
                        className="rh-client-btn rh-client-btn--ghost rh-client-btn--sm"
                        onClick={() => navigate(`/recu/${order.orderId}`)}
                      >
                        <Icon name="download" size="sm" /> {t('orders.receipt')}
                      </button>
                      <button
                        type="button"
                        className="rh-client-btn rh-client-btn--soft rh-client-btn--sm"
                        onClick={() =>
                          navigate(
                            `/suivi/${order.tenantId}/${order.orderId}?k=${encodeURIComponent(order.trackingToken)}`,
                          )
                        }
                      >
                        <Icon name="arrow-right" size="sm" /> {t('orders.viewOrder')}
                      </button>
                    </div>
                  </footer>
                </article>
              ))
            )}
            <p className="rh-client-hint rh-client-hint--center">
              <Icon name="lock" size="sm" /> {t('orders.localHint')}
            </p>
          </section>
        )}

        {tab === 'reservations' && (
          <section className="rh-history-list">
            {reservations.length === 0 ? (
              <div className="rh-client-empty">
                <span className="rh-client-empty__icon">
                  <Icon name="calendar" />
                </span>
                <h2>{t('reservation.myReservations')}</h2>
                <p>{t('reservation.empty')}</p>
                <button
                  type="button"
                  className="rh-client-btn rh-client-btn--primary"
                  onClick={() => navigate('/recherche')}
                >
                  {t('explore.title')}
                </button>
              </div>
            ) : (
              reservations.map((reservation) => (
                <article
                  key={reservation.reservationId}
                  className={cx(
                    'rh-history-card',
                    'rh-history-resa',
                    reservation.status === 'annulee' && 'is-cancelled',
                  )}
                >
                  <header>
                    <div>
                      <strong>{reservation.tenantName}</strong>
                      <span>
                        {reservation.reference} ·{' '}
                        {formatDate(`${reservation.date}T12:00:00Z`, locale)} {reservation.time}
                      </span>
                    </div>
                    <span
                      className={cx(
                        'rh-client-pill',
                        reservation.status === 'annulee'
                          ? 'rh-client-pill--error'
                          : reservation.status === 'installee'
                            ? 'rh-client-pill--success'
                            : 'rh-client-pill--info',
                      )}
                    >
                      {t(
                        `reservation.status${reservation.status === 'confirmee' ? 'Confirmee' : reservation.status === 'installee' ? 'Installee' : reservation.status === 'annulee' ? 'Annulee' : 'NoShow'}`,
                      )}
                    </span>
                  </header>
                  <p className="rh-history-resa__meta">
                    <Icon name="users" size="sm" />{' '}
                    {t('reservation.partyValue', { count: reservation.partySize })}
                    {reservation.tableCode ? (
                      <>
                        <Icon name="grid" size="sm" /> {reservation.tableCode}
                      </>
                    ) : null}
                  </p>
                  <footer>
                    {reservation.status === 'confirmee' && (
                      <button
                        type="button"
                        className="rh-client-btn rh-client-btn--ghost rh-client-btn--sm"
                        onClick={() => cancelReservation(reservation)}
                      >
                        <Icon name="x" size="sm" /> {t('orders.cancel')}
                      </button>
                    )}
                  </footer>
                </article>
              ))
            )}
          </section>
        )}
      </main>
      <ClientBottomBar active="orders" />
    </div>
  );
}
