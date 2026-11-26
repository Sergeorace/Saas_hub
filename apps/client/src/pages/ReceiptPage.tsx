import { useMemo } from 'react';
import { Icon, formatDate, formatTime, formatXof, useI18n } from '@resto-hub/design-system';
import { getOrder } from '../lib/localStore';
import { navigate } from '../lib/router';
import { ClientHeader } from '../components/ClientChrome';

export default function ReceiptPage({ orderId }: { orderId: string }) {
  const { t, locale } = useI18n();
  const order = useMemo(() => getOrder(orderId), [orderId]);

  if (!order) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('receipt.title')} back="/commandes" />
        <main className="rh-client-page">
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="receipt" />
            </span>
            <h2>{t('receipt.notFound')}</h2>
            <button
              type="button"
              className="rh-client-btn rh-client-btn--primary"
              onClick={() => navigate('/commandes')}
            >
              {t('orders.title')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const paid = order.paymentStatus === 'payee';

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('receipt.title')} back="/commandes" />
      <main className="rh-client-page rh-client-page--flush">
        <article className="rh-receipt">
          <header className="rh-receipt__head">
            <span className="rh-receipt__logo">RH</span>
            <div>
              <strong>{order.tenantName}</strong>
              <span>{t('receipt.digital')}</span>
            </div>
            <span
              className={`rh-client-pill ${paid ? 'rh-client-pill--success' : 'rh-client-pill--warning'}`}
            >
              {paid ? t('tracking.paid') : t('tracking.unpaid')}
            </span>
          </header>

          <dl className="rh-receipt__meta">
            <div>
              <dt>{t('receipt.order')}</dt>
              <dd>{order.number}</dd>
            </div>
            <div>
              <dt>{t('receipt.date')}</dt>
              <dd>
                {formatDate(order.createdAt, locale)} · {formatTime(order.createdAt, locale)}
              </dd>
            </div>
            {order.tableCode && (
              <div>
                <dt>{t('receipt.table')}</dt>
                <dd>{order.tableCode}</dd>
              </div>
            )}
          </dl>

          <table className="rh-receipt__lines">
            <thead>
              <tr>
                <th>{t('receipt.items')}</th>
                <th>{t('receipt.total')}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, index) => (
                <tr key={`${order.orderId}-${index}`}>
                  <td>
                    {line.quantity} × {line.name}
                    {line.variantName ? <em> · {line.variantName}</em> : null}
                  </td>
                  <td>{formatXof(line.lineTotalXof, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{paid ? t('receipt.total') : t('cart.total')}</th>
                <th>{formatXof(order.totalXof, locale)}</th>
              </tr>
            </tfoot>
          </table>

          <p className="rh-receipt__thanks">{t('receipt.thanks')}</p>
          <p className="rh-client-hint rh-client-hint--center">
            <Icon name="lock" size="sm" /> {t('receipt.footer')}
          </p>
        </article>

        <div className="rh-receipt__actions">
          <button
            type="button"
            className="rh-client-btn rh-client-btn--primary rh-client-btn--block"
            onClick={() => window.print()}
          >
            <Icon name="download" size="sm" /> {t('receipt.print')}
          </button>
          <button
            type="button"
            className="rh-client-btn rh-client-btn--ghost rh-client-btn--block"
            onClick={() =>
              navigate(
                `/suivi/${order.tenantId}/${order.orderId}?k=${encodeURIComponent(order.trackingToken)}`,
              )
            }
          >
            <Icon name="arrow-right" size="sm" /> {t('tracking.title')}
          </button>
        </div>
      </main>
    </div>
  );
}
