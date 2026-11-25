import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Skeleton, cx, formatDate, formatTime, formatXof, useI18n, useToast } from '@resto-hub/design-system';
import { ApiError, accountApi, publicApi, type PublicOrder } from '../lib/api';
import { getOrder, syncOrder } from '../lib/localStore';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { useCart } from '../lib/cart';
import { ClientHeader } from '../components/ClientChrome';
import { StarRatingInput } from '../components/Stars';

const POLL_MS = 6000;
const STAGES = ['recue', 'en_preparation', 'prete', 'servie'] as const;

export default function TrackingPage({ tenantId, orderId, token }: { tenantId: string; orderId: string; token: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { user } = useSession();
  const local = getOrder(orderId);
  const cart = useCart(tenantId);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifyState, setNotifyState] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await publicApi.orderTracking(tenantId, orderId, token);
      setOrder(result.order);
      syncOrder(result.order);
      setError(null);
      const previous = lastStatus.current;
      if (previous && previous !== result.order.status) {
        const label = t(`tracking.${result.order.status}`);
        toast.push({
          title: result.order.status === 'prete' ? `${t('tracking.prete')} · ${result.order.number}` : label,
          description: result.order.status === 'prete' ? t('tracking.notifyHint') : undefined,
          tone: result.order.status === 'annulee' ? 'error' : 'success',
        });
        if (result.order.status === 'prete' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(`${t('tracking.prete')} · ${result.order.number}`, {
              body: `${local?.tenantName ?? ''} — ${t('tracking.notifyHint')}`,
              icon: '/icon.svg',
              tag: `order-${result.order.id}`,
            });
          } catch {
            /* notification non bloquante */
          }
        }
      }
      lastStatus.current = result.order.status;
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 404 ? t('tracking.notFound') : t('tracking.trackingInvalid'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, orderId, token, t, toast, local?.tenantName]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!order || order.status === 'servie' || order.status === 'annulee') return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [order?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setNotifyState('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotifyState(permission);
    if (permission === 'granted') toast.push({ title: t('tracking.notifyOn'), tone: 'success' });
    else if (permission === 'denied') toast.push({ title: t('tracking.notifyBlocked'), tone: 'warning' });
  };

  const claimPoints = async () => {
    setClaiming(true);
    try {
      const result = await accountApi.claim(tenantId, orderId);
      setClaimed(true);
      toast.push({
        title: result.alreadyCredited ? t('loyalty.alreadyCredited') : t('tracking.claimed'),
        description: t('loyalty.pointsShort', { points: result.account.points }),
        tone: 'success',
      });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      toast.push({
        title: code === 'order_not_paid' ? t('loyalty.orderNotPaid') : code === 'order_not_found' ? t('loyalty.orderNotFound') : t('common.error'),
        tone: 'warning',
      });
    } finally {
      setClaiming(false);
    }
  };

  const submitRating = async () => {
    if (rating < 1) return;
    try {
      await accountApi.submitReview({ tenantId, rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setRated(true);
      setReviewOpen(false);
      toast.push({ title: t('establishment.reviewThanks'), tone: 'success' });
    } catch {
      toast.push({ title: t('common.error'), tone: 'error' });
    }
  };

  if (loading && !order) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('tracking.title')} back="/commandes" />
        <main className="rh-client-page">
          <Skeleton height={120} />
          <Skeleton height={220} />
        </main>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('tracking.title')} back="/commandes" />
        <main className="rh-client-page">
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="wifi-off" />
            </span>
            <h2>{t('tracking.notFound')}</h2>
            <p>{error ?? t('tracking.trackingInvalid')}</p>
            <button type="button" className="rh-client-btn rh-client-btn--primary" onClick={() => navigate('/commandes')}>
              {t('orders.title')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const cancelActive = order.status === 'servie' ? STAGES.length : STAGES.indexOf(order.status as (typeof STAGES)[number]);
  const paid = order.paymentStatus === 'payee';
  const canAddItems = Boolean(cart.tableToken && cart.tableCode);
  const paidLabel = paid ? t('tracking.paid') : order.paymentStatus === 'partielle' ? t('tracking.partial') : t('tracking.unpaid');

  return (
    <div className="rh-client-screen">
      <ClientHeader
        title={t('tracking.orderNumber', { number: order.number })}
        subtitle={local?.tenantName}
        back={local?.tenantSlug ? `/e/${local.tenantSlug}` : '/commandes'}
        logo={undefined}
      />
      <main className="rh-client-page rh-client-page--flush">
        <section className={cx('rh-tracking-hero', order.status === 'annulee' && 'is-cancelled')}>
          <span className="rh-tracking-hero__badge">
            <Icon name={order.status === 'annulee' ? 'x-circle' : 'clock'} size="sm" />
            {t(`tracking.${order.status}`)}
          </span>
          <h1>{order.status === 'annulee' ? t('tracking.annulee') : order.status === 'prete' ? t('tracking.prete') : t(`tracking.${order.status}`)}</h1>
          <p className="rh-client-muted">
            {order.tableCode ? `${t('tracking.table', { code: order.tableCode })} · ` : ''}
            {t(`tracking.channel${order.channel === 'sur_place' ? 'SurPlace' : order.channel === 'a_emporter' ? 'Emporter' : order.channel === 'livraison' ? 'Livraison' : 'Precommande'}`)}
          </p>
          {order.status !== 'annulee' && order.status !== 'servie' && (
            <p className="rh-tracking-hero__eta">
              <Icon name="flame" size="sm" /> {t('tracking.estimated')}
            </p>
          )}
          {order.status === 'annulee' && <p className="rh-tracking-hero__hint">{t('tracking.cancelledHint')}</p>}
        </section>

        {order.status !== 'annulee' && (
          <section className="rh-tracking-steps" aria-label={t('tracking.timeline')}>
            {STAGES.map((stage, index) => {
              const reached = index <= cancelActive;
              const stamp = order.timeline.find((entry) => entry.status === stage)?.at;
              return (
                <div key={stage} className={cx('rh-tracking-step', reached && 'is-reached', index === cancelActive && 'is-current')}>
                  <span className="rh-tracking-step__dot">{reached ? <Icon name="check" size="sm" /> : index + 1}</span>
                  <div>
                    <strong>{t(`tracking.${stage}`)}</strong>
                    {stamp && <span>{formatTime(stamp, locale)}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <section className="rh-tracking-tickets">
          {order.tickets.map((ticket) => (
            <div key={ticket.station} className={cx('rh-ticket-chip', `is-${ticket.status}`)}>
              <Icon name={ticket.station === 'bar' ? 'coffee' : 'chef'} size="sm" />
              <span>
                {ticket.station === 'bar' ? t('tracking.stationBar') : t('tracking.stationCuisine')}
              </span>
              <strong>
                {ticket.status === 'nouvelle'
                  ? t('tracking.ticketNouvelle')
                  : ticket.status === 'en_preparation'
                    ? t('tracking.ticketEnPreparation')
                    : t('tracking.ticketPrete')}
              </strong>
            </div>
          ))}
          <span className="rh-client-pill rh-client-pill--info">{t('tracking.live')}</span>
        </section>

        <section className="rh-track-card">
          <header>
            <h2>{t('tracking.items')}</h2>
            <span className="rh-track-card__paid">{paidLabel}</span>
          </header>
          {order.lines.map((line, index) => (
            <div key={`${line.name}-${index}`} className="rh-track-line">
              <span>
                {line.quantity} × {line.name}
                {line.variantName ? <em> · {line.variantName}</em> : null}
              </span>
              <strong>{formatXof(line.lineTotalXof, locale)}</strong>
            </div>
          ))}
          <div className="rh-track-total">
            <span>{t('tracking.total')}</span>
            <strong>{formatXof(order.totalXof, locale)}</strong>
          </div>
          <p className="rh-client-hint">
            <Icon name="clock" size="sm" /> {formatDate(order.createdAt, locale)} · {t('tracking.footer')}
          </p>
        </section>

        {notifyState !== 'granted' && notifyState !== 'unsupported' && notifyState !== 'denied' && (
          <section className="rh-track-card rh-track-notify">
            <div>
              <strong>{t('tracking.notify')}</strong>
              <p>{t('tracking.notifyHint')}</p>
            </div>
            <button type="button" className="rh-client-btn rh-client-btn--soft" onClick={enableNotifications}>
              <Icon name="bell" size="sm" /> {t('tracking.notify')}
            </button>
          </section>
        )}
        {notifyState === 'granted' && (
          <p className="rh-client-hint rh-client-hint--center">
            <Icon name="bell" size="sm" /> {t('tracking.notifyOn')}
          </p>
        )}
        {notifyState === 'denied' && <p className="rh-client-hint rh-client-hint--center">{t('tracking.notifyBlocked')}</p>}

        <section className="rh-track-actions">
          {canAddItems && order.status !== 'annulee' && (
            <button
              type="button"
              className="rh-client-btn rh-client-btn--primary rh-client-btn--block"
              onClick={() =>
                navigate(`/e/${local?.tenantSlug ?? tenantId}/menu?table=${encodeURIComponent(cart.tableCode ?? '')}&k=${encodeURIComponent(cart.tableToken ?? '')}`)
              }
            >
              <Icon name="plus" size="sm" /> {t('tracking.addItems')}
            </button>
          )}
          {user && paid && (
            <button
              type="button"
              className="rh-client-btn rh-client-btn--soft rh-client-btn--block"
              onClick={claimPoints}
              disabled={claiming || claimed}
            >
              <Icon name="sparkles" size="sm" /> {claimed ? t('tracking.claimed') : t('tracking.claimPoints')}
            </button>
          )}
          {!user && paid && (
            <button type="button" className="rh-client-btn rh-client-btn--soft rh-client-btn--block" onClick={() => navigate('/compte')}>
              <Icon name="sparkles" size="sm" /> {t('loyalty.signIn')}
            </button>
          )}
          <div className="rh-track-actions__row">
            <button type="button" className="rh-client-btn rh-client-btn--ghost" onClick={() => navigate(`/recu/${order.id}`)}>
              <Icon name="receipt" size="sm" /> {t('tracking.receipt')}
            </button>
            {order.status !== 'servie' && order.status !== 'annulee' && (
              <button type="button" className="rh-client-btn rh-client-btn--ghost" onClick={() => void load()}>
                <Icon name="refresh" size="sm" /> {t('tracking.refresh')}
              </button>
            )}
          </div>
        </section>

        {user && (order.status === 'prete' || order.status === 'servie') && (
          <section className="rh-track-card">
            <header>
              <h2>{t('tracking.rate')}</h2>
            </header>
            {rated ? (
              <p className="rh-client-hint">
                <Icon name="check-circle" size="sm" /> {t('establishment.reviewThanks')}
              </p>
            ) : reviewOpen ? (
              <div className="rh-track-review">
                <StarRatingInput value={rating} onChange={setRating} label={t('tracking.rate')} />
                <textarea
                  className="rh-client-input"
                  rows={3}
                  placeholder={t('establishment.reviewPlaceholder')}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
                <button type="button" className="rh-client-btn rh-client-btn--primary" onClick={submitRating} disabled={rating < 1}>
                  {t('establishment.submitReview')}
                </button>
              </div>
            ) : (
              <button type="button" className="rh-client-btn rh-client-btn--soft" onClick={() => setReviewOpen(true)}>
                <Icon name="sparkles" size="sm" /> {t('tracking.rate')}
              </button>
            )}
          </section>
        )}

        {!user && (order.status === 'prete' || order.status === 'servie') && (
          <p className="rh-client-hint rh-client-hint--center">{t('establishment.reviewLogin')}</p>
        )}
      </main>
    </div>
  );
}
