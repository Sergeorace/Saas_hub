import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  SkeletonText,
  formatTime,
  useI18n,
  useToast,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  orderApi,
  type KdsPayload,
  type KdsTicket,
  type OrderStation,
} from '../lib/api';

const STATIONS: Array<OrderStation | 'all'> = ['all', 'cuisine', 'bar'];

const COLUMNS: Array<{
  key: 'nouvelle' | 'en_preparation' | 'prete';
  label: 'colNew' | 'colPrep' | 'colReady';
}> = [
  { key: 'nouvelle', label: 'colNew' },
  { key: 'en_preparation', label: 'colPrep' },
  { key: 'prete', label: 'colReady' },
];

interface Props {
  tenantId: string;
  locale: Locale;
  canUpdate: boolean;
}

function ageLabel(ticket: KdsTicket): string {
  const minutes = Math.max(0, Math.round(ticket.ageSeconds / 60));
  return minutes < 1 ? '< 1 min' : `${minutes} min`;
}

export function KdsTab({ tenantId, locale, canUpdate }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [station, setStation] = useState<OrderStation | 'all'>('all');
  const [payload, setPayload] = useState<KdsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const stationRef = useRef(station);
  stationRef.current = station;

  const tick = useCallback(async () => {
    try {
      const result = await orderApi.kds(tenantId, stationRef.current);
      setPayload(result);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    void tick();
    const timer = window.setInterval(() => void tick(), 1_500);
    return () => window.clearInterval(timer);
  }, [tick, station]);

  const act = async (ticket: KdsTicket, status: 'en_preparation' | 'prete') => {
    setActing(ticket.id);
    try {
      const result = await orderApi.ticketStatus(tenantId, ticket.id, status);
      setPayload(result.kds);
      toast.push({
        title:
          status === 'prete'
            ? `${t('kds.ready')} · ${ticket.orderNumber}`
            : `${t('kds.start')} · ${ticket.orderNumber}`,
        tone: 'success',
      });
    } catch (cause) {
      toast.push({ title: t('kds.error'), description: errorMessage(cause), tone: 'error' });
      void tick();
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="kds-shell">
      <header className="kds-head">
        <div className="kds-head__title">
          <h2>{t('kds.title')}</h2>
          <p>{t('kds.subtitle')}</p>
        </div>
        <div className="kds-head__controls">
          <Badge tone="success" live>
            {t('kds.live')}
          </Badge>
          <div className="kds-stations" role="group" aria-label={t('kds.title')}>
            {STATIONS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={station === entry ? 'kds-chip is-active' : 'kds-chip'}
                aria-pressed={station === entry}
                onClick={() => setStation(entry)}
              >
                {entry === 'all'
                  ? t('kds.stationAll')
                  : entry === 'cuisine'
                    ? t('kds.stationCuisine')
                    : t('kds.stationBar')}
              </button>
            ))}
          </div>
          <span className="kds-clock">{formatTime(new Date(), locale)}</span>
        </div>
      </header>

      {error && (
        <div className="kds-alert" role="alert">
          {error}
          <Button size="sm" variant="outline" onClick={() => void tick()}>
            {t('orders.refresh')}
          </Button>
        </div>
      )}

      {loading && !payload ? (
        <div className="kds-loading">
          <SkeletonText lines={6} />
          <span>{t('kds.loading')}</span>
        </div>
      ) : (
        <div className="kds-board">
          {COLUMNS.map((column) => {
            const tickets = (payload?.tickets ?? []).filter(
              (ticket) => ticket.status === column.key,
            );
            return (
              <section key={column.key} className="kds-col">
                <header className="kds-col__head">
                  <h3>{t(`kds.${column.label}`)}</h3>
                  <span className="kds-col__count">{tickets.length}</span>
                </header>
                <div className="kds-col__list">
                  {tickets.length === 0 && <p className="kds-col__empty">{t('kds.emptyColumn')}</p>}
                  {tickets.map((ticket) => (
                    <article
                      key={ticket.id}
                      className={[
                        'kds-ticket',
                        ticket.urgent ? 'is-urgent' : '',
                        ticket.critical ? 'is-critical' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <header className="kds-ticket__head">
                        <strong className="kds-ticket__number">{ticket.orderNumber}</strong>
                        <span className="kds-ticket__age">{ageLabel(ticket)}</span>
                      </header>
                      <div className="kds-ticket__meta">
                        <Badge tone={ticket.channel === 'sur_place' ? 'primary' : 'info'}>
                          {t(
                            `kds.${ticket.channel === 'sur_place' ? 'table' : ticket.channel === 'a_emporter' ? 'takeaway' : ticket.channel === 'livraison' ? 'delivery' : 'preorder'}`,
                          )}
                        </Badge>
                        {ticket.tableCode && <strong>{ticket.tableCode}</strong>}
                        {station === 'all' && (
                          <Badge tone={ticket.station === 'bar' ? 'info' : 'accent'}>
                            {ticket.station === 'bar'
                              ? t('kds.stationBar')
                              : t('kds.stationCuisine')}
                          </Badge>
                        )}
                        {(ticket.critical || ticket.urgent) && (
                          <span className="kds-ticket__flag">
                            {ticket.critical ? t('kds.late') : t('kds.urgent')}
                          </span>
                        )}
                      </div>
                      {ticket.scheduledFor && (
                        <p className="kds-ticket__scheduled">
                          {t('kds.scheduled', { time: formatTime(ticket.scheduledFor, locale) })}
                        </p>
                      )}
                      <ul className="kds-ticket__lines">
                        {ticket.lines.map((line, index) => (
                          <li key={`${ticket.id}-${index}`}>
                            <span className="kds-ticket__qty">{line.quantity}×</span>
                            <div>
                              <strong>
                                {line.name}
                                {line.variantName ? ` — ${line.variantName}` : ''}
                              </strong>
                              {line.options.length > 0 && <span>{line.options.join(' · ')}</span>}
                              {line.notes && <em>{line.notes}</em>}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {canUpdate && (
                        <button
                          type="button"
                          className={column.key === 'prete' ? 'kds-action is-done' : 'kds-action'}
                          disabled={acting === ticket.id || column.key === 'prete'}
                          onClick={() =>
                            void act(ticket, column.key === 'nouvelle' ? 'en_preparation' : 'prete')
                          }
                        >
                          {column.key === 'nouvelle' ? t('kds.start') : t('kds.ready')}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!payload && !loading && !error && (
        <EmptyState icon="chef" title={t('kds.noOrders')} description={t('kds.refreshNote')} />
      )}

      <footer className="kds-foot">
        <span>{t('kds.refreshNote')}</span>
        <span aria-hidden="true">AFRICA/LOME · 18 % TVA</span>
      </footer>
    </div>
  );
}
