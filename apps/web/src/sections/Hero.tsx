import { useState } from 'react';
import {
  Badge,
  Icon,
  TableStatusBadge,
  formatXof,
  useI18n,
} from '@resto-hub/design-system';
import { eventFeed, kpis, tables } from '../data/demo';
import { FloorPreview } from '../components/FloorPreview';

const bulletIcons = ['layers', 'wallet', 'wifi-off'] as const;

export function Hero() {
  const { t, tm, locale } = useI18n();
  const [selectedId, setSelectedId] = useState('T03');
  const bullets = tm<string[]>('hero.bullets');

  const selected = tables.find((table) => table.id === selectedId) ?? tables[0];
  const occupied = tables.filter((table) => table.status === 'occupied').length;
  const openTickets = 3;

  return (
    <section className="hero" id="product">
      <div className="site-container hero__grid">
        <div className="hero__copy">
          <p className="rh-eyebrow">
            <span className="hero__pulse" aria-hidden="true" />
            {t('hero.eyebrow')}
          </p>
          <h1 className="rh-display hero__title">
            {t('hero.titleA')} <em>{t('hero.titleAccent')}</em> {t('hero.titleB')}
          </h1>
          <p className="hero__lead">{t('hero.lead')}</p>
          <div className="hero__actions">
            <a className="rh-btn rh-btn--primary rh-btn--lg" href="#/inscription">
              {t('hero.primaryCta')}
              <span className="rh-btn__icon">
                <Icon name="arrow-right" />
              </span>
            </a>
            <a className="rh-btn rh-btn--outline rh-btn--lg" href="#services">
              {t('hero.secondaryCta')}
            </a>
          </div>
          <p className="hero__note">
            <Icon name="check-circle" size="sm" />
            {t('hero.note')}
          </p>
          <ul className="hero__bullets">
            {(bullets ?? []).map((bullet, index) => (
              <li key={bullet}>
                <Icon name={bulletIcons[index] ?? 'check'} size="sm" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <div className="preview">
            <div className="preview__chrome">
              <span className="preview__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="preview__url">app.resto-hub.tg/le-baobab</span>
              <Badge tone="success" live>
                {t('hero.preview.live')}
              </Badge>
            </div>

            <div className="preview__body">
              <aside className="preview__rail" aria-hidden="true">
                <span className="preview__rail-item is-active">
                  <Icon name="grid" size="sm" />
                </span>
                <span className="preview__rail-item">
                  <Icon name="receipt" size="sm" />
                  <span className="preview__rail-badge">4</span>
                </span>
                <span className="preview__rail-item">
                  <Icon name="chef" size="sm" />
                </span>
                <span className="preview__rail-item">
                  <Icon name="users" size="sm" />
                </span>
                <span className="preview__rail-item">
                  <Icon name="chart" size="sm" />
                </span>
                <span className="preview__rail-avatar">AD</span>
              </aside>

              <div className="preview__main">
                <div className="preview__head">
                  <div>
                    <h2>{t('hero.preview.service')}</h2>
                    <p>{t('hero.preview.tenant')}</p>
                  </div>
                  <Badge tone="primary" icon="clock">
                    21:04
                  </Badge>
                </div>

                <div className="preview__stats">
                  <div>
                    <span>{t('hero.preview.revenue')}</span>
                    <strong>{formatXof(kpis.revenue, locale)}</strong>
                  </div>
                  <div>
                    <span>{t('hero.preview.tables')}</span>
                    <strong>
                      {occupied} / {tables.length}
                    </strong>
                  </div>
                  <div>
                    <span>{t('hero.preview.tickets')}</span>
                    <strong>{openTickets}</strong>
                  </div>
                </div>

                <div className="preview__panel">
                  <div className="preview__panel-head">
                    <strong>{t('hero.preview.floor')}</strong>
                    <span>{t('hero.preview.floorSub')}</span>
                  </div>
                  <FloorPreview tables={tables} selectedId={selectedId} onSelect={setSelectedId} />
                </div>

                <div className="preview__foot">
                  <div className="preview__detail">
                    <div className="preview__detail-head">
                      <span>{t('hero.preview.table')}</span>
                      <strong>{selected.id}</strong>
                      <TableStatusBadge
                        status={selected.status}
                        label={
                          selected.status === 'bill' ? t('hero.preview.bill') : undefined
                        }
                      />
                    </div>
                    <div className="preview__detail-meta">
                      <span>
                        {t('hero.preview.covers')} · {selected.guests ?? '—'} / {selected.seats}
                      </span>
                      <span>
                        {t('hero.preview.waiter')} · {selected.waiter ?? '—'}
                      </span>
                    </div>
                    {selected.total ? (
                      <div className="preview__amount">
                        <span>{t('hero.preview.bill')}</span>
                        <strong>{formatXof(selected.total, locale)}</strong>
                      </div>
                    ) : (
                      <p className="preview__hint">{t('hero.preview.selectHint')}</p>
                    )}
                  </div>

                  <div className="preview__feed">
                    <div className="preview__feed-head">
                      <strong>{t('hero.preview.events')}</strong>
                      <span className="preview__live-dot" aria-hidden="true" />
                    </div>
                    <ul>
                      {eventFeed.slice(0, 3).map((event) => (
                        <li key={event.id}>
                          <span className={`preview__event-dot preview__event-dot--${event.tone}`} />
                          <div>
                            <span className="preview__event-name">{event.name}</span>
                            <span className="preview__event-detail">{event.detail}</span>
                          </div>
                          <span className="preview__event-time">{event.time}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="hero__float">
            <span className="hero__float-icon">
              <Icon name="wallet" />
            </span>
            <div>
              <strong>+ {formatXof(24500, locale)}</strong>
              <span>OrderPaid · TMoney</span>
            </div>
            <Badge tone="success" dot>
              OK
            </Badge>
          </div>
        </div>
      </div>
    </section>
  );
}
