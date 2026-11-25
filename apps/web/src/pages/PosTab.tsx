import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  SkeletonText,
  Textarea,
  formatTime,
  formatXof,
  useI18n,
  useToast,
  type Locale,
} from '@resto-hub/design-system';
import {
  errorMessage,
  orderApi,
  type Order,
  type PaymentMethod,
  type PosPayload,
} from '../lib/api';

const METHODS: PaymentMethod[] = ['especes', 'mobile_money', 'carte'];

interface Props {
  tenantId: string;
  locale: Locale;
  permissions: string[];
}

function methodLabel(method: PaymentMethod, t: (key: string) => string): string {
  return method === 'especes' ? t('pos.methodEspeces') : method === 'mobile_money' ? t('pos.methodMobile') : t('pos.methodCarte');
}

export function PosTab({ tenantId, locale, permissions }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const canOperate = permissions.includes('pos:operate');
  const canClose = permissions.includes('pos:close');
  const canDiscount = permissions.includes('order:discount');
  const canCancel = permissions.includes('order:cancel');

  const [payload, setPayload] = useState<PosPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const [openOpen, setOpenOpen] = useState(false);
  const [floatValue, setFloatValue] = useState('20000');
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('especes');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');
  const [lastPaid, setLastPaid] = useState<Order | null>(null);

  const [discountOrder, setDiscountOrder] = useState<Order | null>(null);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('10');
  const [discountReason, setDiscountReason] = useState('');
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const tick = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const result = await orderApi.pos(tenantId);
      setPayload(result);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    void tick(false);
    const timer = window.setInterval(() => void tickRef.current(true), 5_000);
    return () => window.clearInterval(timer);
  }, [tick]);

  const openSession = async () => {
    setActing('open');
    try {
      await orderApi.openSession(tenantId, Math.max(0, Number(floatValue) || 0));
      setOpenOpen(false);
      toast.push({ title: t('pos.sessionOpen'), tone: 'success' });
      await tickRef.current(true);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const closeSession = async () => {
    setActing('close');
    try {
      const result = await orderApi.closeSession(tenantId, Math.max(0, Number(counted) || 0), closeNotes.trim() || undefined);
      setCloseOpen(false);
      setCounted('');
      setCloseNotes('');
      toast.push({
        title: t('pos.lastClosed'),
        description: `${t('pos.difference')} : ${formatXof(result.session.differenceXof ?? 0, locale)}`,
        tone: (result.session.differenceXof ?? 0) === 0 ? 'success' : 'warning',
      });
      await tickRef.current(true);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const startPayment = (order: Order) => {
    setPayOrder(order);
    setPayMethod('especes');
    setPayAmount(String(order.remainingXof));
    setPayReference('');
  };

  const submitPayment = async () => {
    if (!payOrder) return;
    const amount = Math.round(Number(payAmount) || 0);
    if (amount <= 0 || amount > payOrder.remainingXof) {
      toast.push({ title: t('pos.amount'), tone: 'error' });
      return;
    }
    setActing('pay');
    try {
      const result = await orderApi.pay(tenantId, payOrder.id, {
        method: payMethod,
        amountXof: amount,
        ...(payReference.trim() ? { reference: payReference.trim() } : {}),
      });
      setPayOrder(null);
      setLastPaid(result.order.paymentStatus === 'payee' ? result.order : null);
      toast.push({
        title: formatXof(amount, locale),
        description: result.order.invoiceNumber ? `${t('pos.invoice')} ${result.order.invoiceNumber}` : t('pos.pay'),
        tone: 'success',
      });
      await tickRef.current(true);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const downloadReceipt = async (order: Order) => {
    setActing(`receipt-${order.id}`);
    try {
      const blob = await orderApi.receiptBlob(tenantId, order.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const applyDiscount = async () => {
    if (!discountOrder || discountReason.trim().length < 3) return;
    setActing('discount');
    try {
      const result = await orderApi.discount(tenantId, discountOrder.id, {
        type: discountType,
        value: Number(discountValue) || 0,
        reason: discountReason.trim(),
      });
      toast.push({ title: t('orders.discountApplied'), tone: 'success' });
      setDiscountOrder(null);
      setDiscountReason('');
      if (payOrder?.id === result.order.id) startPayment(result.order);
      await tickRef.current(true);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const submitCancel = async () => {
    if (!cancelOrder || cancelReason.trim().length < 4) return;
    setActing('cancel');
    try {
      await orderApi.cancel(tenantId, cancelOrder.id, cancelReason.trim());
      toast.push({ title: t('orders.statusUpdated'), tone: 'success' });
      setCancelOrder(null);
      setCancelReason('');
      await tickRef.current(true);
    } catch (cause) {
      toast.push({ title: t('pos.errorLoad'), description: errorMessage(cause), tone: 'error' });
    } finally {
      setActing(null);
    }
  };

  const session = payload?.session;
  const expected = session?.liveExpectedXof ?? 0;
  const countedValue = Math.max(0, Number(counted) || 0);
  const previewDifference = counted ? countedValue - expected : 0;

  if (loading && !payload) {
    return <Card><CardBody><SkeletonText lines={8} /></CardBody></Card>;
  }

  return (
    <>
      {error && (
        <Card className="console-alert">
          <CardBody>
            <p className="auth-error" role="alert">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void tick(false)}>{t('workspace.retry')}</Button>
          </CardBody>
        </Card>
      )}

      {lastPaid && (
        <Card className="pos-paid">
          <CardBody>
            <div className="pos-paid__row">
              <div>
                <Badge tone="success" dot>{t('orders.paymentStatus.payee')}</Badge>
                <strong>{lastPaid.number} · {formatXof(lastPaid.totalXof, locale)}</strong>
                <span>{lastPaid.invoiceNumber} · {lastPaid.receiptNumber}</span>
              </div>
              <div className="pos-paid__actions">
                <Button size="sm" iconLeft="download" loading={acting === `receipt-${lastPaid.id}`} onClick={() => void downloadReceipt(lastPaid)}>
                  {t('pos.receipt')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLastPaid(null)}>{t('orders.back')}</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="pos-grid">
        <Card className="pos-session">
          <CardHeader
            title={session ? t('pos.sessionOpen') : t('pos.title')}
            subtitle={session ? t('pos.openedAt', { time: formatTime(session.openedAt, locale) }) : t('pos.noSessionBody')}
            action={session ? <Badge tone="success" live>{t('pos.paymentsCount', { count: session.payments })}</Badge> : undefined}
          />
          <CardBody>
            {session ? (
              <>
                <dl className="pos-kv">
                  <div><dt>{t('pos.openingFloat')}</dt><dd>{formatXof(session.openingFloatXof, locale)}</dd></div>
                  <div><dt>{t('pos.collected')}</dt><dd>{formatXof(session.collectedXof, locale)}</dd></div>
                  <div><dt>{t('pos.expected')}</dt><dd><strong>{formatXof(session.liveExpectedXof, locale)}</strong></dd></div>
                </dl>
                <div className="pos-methods">
                  {METHODS.map((method) => (
                    <span key={method} className="pos-method">
                      <em>{methodLabel(method, t)}</em>
                      <strong>{formatXof(session.byMethod[method] ?? 0, locale)}</strong>
                    </span>
                  ))}
                </div>
                {canClose && (
                  <Button variant="outline" iconLeft="lock" onClick={() => setCloseOpen(true)}>
                    {t('pos.closeSession')}
                  </Button>
                )}
              </>
            ) : (
              <div className="pos-empty-session">
                <EmptyState
                  icon="wallet"
                  title={t('pos.noSessionTitle')}
                  description={t('pos.noSessionBody')}
                  action={canOperate ? <Button iconLeft="wallet" onClick={() => setOpenOpen(true)}>{t('pos.openSession')}</Button> : undefined}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="pos-today">
          <CardHeader title={t('pos.todayRevenue')} action={<Badge tone="info">{payload?.today.payments ?? 0}</Badge>} />
          <CardBody>
            <strong className="pos-today__value">{formatXof(payload?.today.revenueXof ?? 0, locale)}</strong>
            <div className="pos-methods">
              {METHODS.map((method) => (
                <span key={method} className="pos-method">
                  <em>{methodLabel(method, t)}</em>
                  <strong>{formatXof(payload?.today.byMethod[method] ?? 0, locale)}</strong>
                </span>
              ))}
            </div>
            {payload?.lastClosed && (
              <div className="pos-last">
                <span>{t('pos.lastClosed')} · {payload.lastClosed.closedAt ? formatTime(payload.lastClosed.closedAt, locale) : '—'}</span>
                <Badge tone={(payload.lastClosed.differenceXof ?? 0) === 0 ? 'success' : 'warning'}>
                  {t('pos.difference')} {formatXof(payload.lastClosed.differenceXof ?? 0, locale)}
                </Badge>
              </div>
            )}
            <p className="pos-hint">{t('pos.cashierHint')}</p>
          </CardBody>
        </Card>
      </div>

      <Card className="pos-topay">
        <CardHeader
          title={t('pos.toPay')}
          subtitle={`${t('pos.totalDue')} · ${formatXof(payload?.toPayTotalXof ?? 0, locale)}`}
          action={<Badge tone="warning">{payload?.toPay.length ?? 0}</Badge>}
        />
        <CardBody>
          {(payload?.toPay.length ?? 0) === 0 ? (
            <EmptyState icon="receipt" title={t('pos.toPayEmpty')} description={t('pos.noSessionBody')} />
          ) : (
            <ul className="pos-rows">
              {payload?.toPay.map((order) => (
                <li key={order.id}>
                  <div className="pos-row__main">
                    <strong>{order.number}</strong>
                    <span>
                      {t(`orders.channel.${order.channel}`)}
                      {order.tableCode ? ` · ${order.tableCode}` : ''}
                      {order.customer?.name ? ` · ${order.customer.name}` : ''}
                    </span>
                    <span>{formatTime(order.createdAt, locale)}</span>
                  </div>
                  <div className="pos-row__amount">
                    <strong>{formatXof(order.remainingXof, locale)}</strong>
                    <Badge tone={order.paymentStatus === 'partielle' ? 'warning' : 'danger'}>
                      {t(`orders.paymentStatus.${order.paymentStatus}`)}
                    </Badge>
                  </div>
                  <div className="pos-row__actions">
                    {canOperate && session && (
                      <Button size="sm" iconLeft="banknote" onClick={() => startPayment(order)}>{t('pos.pay')}</Button>
                    )}
                    {canDiscount && order.paymentStatus === 'impayee' && (
                      <Button size="sm" variant="outline" iconLeft="gift" onClick={() => setDiscountOrder(order)}>{t('pos.discount')}</Button>
                    )}
                    {canCancel && (
                      <Button size="sm" variant="ghost" iconLeft="x" onClick={() => setCancelOrder(order)}>{t('pos.cancel')}</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!session && (payload?.toPay.length ?? 0) > 0 && (
            <p className="reg-note">{t('pos.noSessionBody')}</p>
          )}
        </CardBody>
      </Card>

      <Modal
        open={openOpen}
        onClose={() => setOpenOpen(false)}
        title={t('pos.openTitle')}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setOpenOpen(false)}>{t('orders.back')}</Button>
            <Button loading={acting === 'open'} onClick={() => void openSession()}>{t('pos.open')}</Button>
          </div>
        }
      >
        <Input
          label={t('pos.openingFloat')}
          type="number"
          min={0}
          max={5_000_000}
          value={floatValue}
          onChange={(event) => setFloatValue(event.target.value)}
          hint={t('pos.cashierHint')}
        />
      </Modal>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={t('pos.closeTitle')}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>{t('orders.back')}</Button>
            <Button variant="danger" loading={acting === 'close'} disabled={!counted} onClick={() => void closeSession()}>
              {t('pos.close')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <dl className="pos-kv">
            <div><dt>{t('pos.expected')}</dt><dd>{formatXof(expected, locale)}</dd></div>
            <div>
              <dt>{t('pos.difference')}</dt>
              <dd>
                <Badge tone={previewDifference === 0 ? 'success' : previewDifference > 0 ? 'info' : 'danger'}>
                  {formatXof(previewDifference, locale)}
                </Badge>
              </dd>
            </div>
          </dl>
          <Input
            label={t('pos.countedAmount')}
            type="number"
            min={0}
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
          />
          <Textarea
            label={t('pos.notes')}
            rows={2}
            value={closeNotes}
            onChange={(event) => setCloseNotes(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(payOrder)}
        onClose={() => setPayOrder(null)}
        title={payOrder ? t('pos.payTitle', { number: payOrder.number }) : t('pos.pay')}
        description={payOrder ? `${formatXof(payOrder.totalXof, locale)} · ${t('orders.remaining')} ${formatXof(payOrder.remainingXof, locale)}` : undefined}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setPayOrder(null)}>{t('orders.back')}</Button>
            <Button iconLeft="banknote" loading={acting === 'pay'} onClick={() => void submitPayment()}>{t('pos.confirmPay')}</Button>
          </div>
        }
      >
        <div className="console-stack">
          <div className="pos-methods pos-methods--select" role="group" aria-label={t('pos.pay')}>
            {METHODS.map((method) => (
              <button
                key={method}
                type="button"
                className={method === payMethod ? 'ord-chip is-active' : 'ord-chip'}
                aria-pressed={method === payMethod}
                onClick={() => setPayMethod(method)}
              >
                {methodLabel(method, t)}
              </button>
            ))}
          </div>
          <Input
            label={t('pos.amount')}
            type="number"
            min={1}
            max={payOrder?.remainingXof ?? undefined}
            value={payAmount}
            onChange={(event) => setPayAmount(event.target.value)}
          />
          {payMethod !== 'especes' && (
            <Input
              label={t('pos.reference')}
              value={payReference}
              onChange={(event) => setPayReference(event.target.value)}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(discountOrder)}
        onClose={() => setDiscountOrder(null)}
        title={t('pos.discount')}
        description={discountOrder?.number}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setDiscountOrder(null)}>{t('orders.back')}</Button>
            <Button loading={acting === 'discount'} disabled={discountReason.trim().length < 3} onClick={() => void applyDiscount()}>
              {t('orders.discountApply')}
            </Button>
          </div>
        }
      >
        <div className="console-stack">
          <div className="pos-methods pos-methods--select" role="group" aria-label={t('orders.discountType')}>
            <button type="button" className={discountType === 'percent' ? 'ord-chip is-active' : 'ord-chip'} onClick={() => setDiscountType('percent')}>
              {t('orders.discountPercent')}
            </button>
            <button type="button" className={discountType === 'amount' ? 'ord-chip is-active' : 'ord-chip'} onClick={() => setDiscountType('amount')}>
              {t('orders.discountAmount')}
            </button>
          </div>
          <Input label={t('orders.discountValue')} type="number" min={1} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} />
          <Input label={t('orders.discountReason')} value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} />
        </div>
      </Modal>

      <Modal
        open={Boolean(cancelOrder)}
        onClose={() => setCancelOrder(null)}
        title={t('pos.cancel')}
        description={cancelOrder?.number}
        closeLabel={t('meta.close')}
        footer={
          <div className="ord-composer__footer-actions">
            <Button variant="ghost" onClick={() => setCancelOrder(null)}>{t('orders.back')}</Button>
            <Button variant="danger" loading={acting === 'cancel'} disabled={cancelReason.trim().length < 4} onClick={() => void submitCancel()}>
              {t('orders.cancelConfirm')}
            </Button>
          </div>
        }
      >
        <Textarea
          label={t('orders.cancelReason')}
          rows={3}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder={t('orders.cancelReasonPlaceholder')}
        />
      </Modal>
    </>
  );
}
