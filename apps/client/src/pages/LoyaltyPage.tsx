import { useMemo, useState } from 'react';
import {
  Icon,
  Skeleton,
  formatDate,
  formatNumber,
  formatXof,
  useI18n,
  useToast,
} from '@resto-hub/design-system';
import {
  ApiError,
  accountApi,
  publicApi,
  type LoyaltyAccount,
  type LoyaltyProgram,
} from '../lib/api';
import { useEstablishment } from '../lib/hooks';
import { useTenantTheme } from '../lib/tenantTheme';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/hooks';
import { navigate } from '../lib/router';
import { listOrders } from '../lib/localStore';
import { ClientHeader } from '../components/ClientChrome';

export default function LoyaltyPage({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { data, loading } = useEstablishment(slug);
  const establishment = data?.establishment;
  useTenantTheme(
    establishment
      ? { primaryColor: establishment.primaryColor, secondaryColor: establishment.secondaryColor }
      : null,
  );
  const { user } = useSession();
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const program = useAsync<{ tenantId: string; program: LoyaltyProgram }>(
    () =>
      establishment
        ? publicApi.loyaltyProgram(establishment.id)
        : Promise.reject(new Error('tenant')),
    [establishment?.id],
  );
  const account = useAsync<{ account: LoyaltyAccount; program: LoyaltyProgram } | null>(
    () => (establishment && user ? accountApi.loyalty(establishment.id) : Promise.resolve(null)),
    [establishment?.id, user?.id],
  );

  const paidOrders = useMemo(
    () =>
      establishment
        ? listOrders()
            .filter(
              (order) => order.tenantId === establishment.id && order.paymentStatus === 'payee',
            )
            .slice(0, 6)
        : [],
    [establishment?.id],
  );

  if (loading) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('loyalty.title')} back={`/e/${slug}`} />
        <main className="rh-client-page">
          <Skeleton height={160} />
          <Skeleton height={200} />
        </main>
      </div>
    );
  }

  if (!establishment) {
    return (
      <div className="rh-client-screen">
        <ClientHeader title={t('loyalty.title')} back="/recherche" />
        <main className="rh-client-page">
          <p className="rh-client-muted">{t('common.error')}</p>
        </main>
      </div>
    );
  }

  const current = account.data?.account ?? null;
  const rules = account.data?.program ?? program.data?.program ?? null;

  const claim = async (orderId: string) => {
    setBusy(orderId);
    try {
      const result = await accountApi.claim(establishment.id, orderId);
      setClaimed((previous) => new Set(previous).add(orderId));
      toast.push({
        title: result.alreadyCredited ? t('loyalty.alreadyCredited') : t('loyalty.claimed'),
        description: t('loyalty.pointsShort', { points: result.account.points }),
        tone: result.alreadyCredited ? 'info' : 'success',
      });
      account.reload();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      toast.push({
        title:
          code === 'order_not_paid'
            ? t('loyalty.orderNotPaid')
            : code === 'order_not_found'
              ? t('loyalty.orderNotFound')
              : t('common.error'),
        tone: 'warning',
      });
    } finally {
      setBusy(null);
    }
  };

  const redeem = async (rewardId: string, label: string, points: number) => {
    if (!window.confirm(t('loyalty.redeemConfirm', { points, label }))) return;
    setBusy(rewardId);
    try {
      const result = await accountApi.redeem(establishment.id, rewardId);
      toast.push({
        title: t('loyalty.redeemed', { label }),
        description: t('loyalty.pointsShort', { points: result.account.points }),
        tone: 'success',
      });
      account.reload();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      toast.push({
        title: code === 'insufficient_points' ? t('loyalty.insufficient') : t('common.error'),
        tone: 'warning',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rh-client-screen">
      <ClientHeader
        title={t('loyalty.title')}
        subtitle={establishment.brandName}
        back={`/e/${establishment.slug}`}
        logo={establishment.logoUrl}
      />
      <main className="rh-client-page rh-client-page--flush">
        <section className="rh-loyalty-hero">
          <span className="rh-loyalty-hero__brand">
            <Icon name="sparkles" size="sm" /> {t('establishment.loyaltyTitle')}
          </span>
          {user && current ? (
            <>
              <div className="rh-loyalty-hero__points">
                <strong>{formatNumber(current.points)}</strong>
                <span>{t('loyalty.points')}</span>
              </div>
              <div className="rh-loyalty-hero__tier">
                <span className="rh-client-pill rh-client-pill--info">
                  {t('account.tier', { tier: current.tier.label })}
                </span>
                <span>
                  {t('loyalty.multiplier', {
                    value: formatNumber(current.tier.multiplier, locale),
                  })}
                </span>
              </div>
              <div className="rh-loyalty-progress">
                <div className="rh-loyalty-progress__bar">
                  <span
                    style={{
                      width: current.nextTier
                        ? `${Math.min(100, Math.round((current.lifetimePoints / Math.max(1, current.lifetimePoints + current.nextTier.pointsNeeded)) * 100))}%`
                        : '100%',
                    }}
                  />
                </div>
                <p>
                  {current.nextTier
                    ? t('loyalty.nextTier', {
                        points: current.nextTier.pointsNeeded,
                        tier: current.nextTier.label,
                      })
                    : t('loyalty.maxTier')}
                </p>
              </div>
            </>
          ) : (
            <div className="rh-loyalty-hero__guest">
              <strong>{t('loyalty.empty')}</strong>
              <p>{t('loyalty.signIn')}</p>
              <button
                type="button"
                className="rh-client-btn rh-client-btn--primary"
                onClick={() => navigate('/compte')}
              >
                <Icon name="smartphone" size="sm" /> {t('common.login')}
              </button>
            </div>
          )}
        </section>

        {rules && (
          <section className="rh-client-card">
            <h2>{t('loyalty.program')}</h2>
            <p className="rh-client-hint">
              <Icon name="zap" size="sm" />{' '}
              {t('loyalty.perXof', { points: 1, amount: formatXof(rules.pointsPerXof, locale) })}
            </p>
            <div className="rh-loyalty-tiers">
              {rules.tiers.map((tier) => (
                <div
                  key={tier.code}
                  className={`rh-loyalty-tier${current?.tier.code === tier.code ? ' is-current' : ''}`}
                >
                  <strong>{tier.label}</strong>
                  <span>
                    {formatNumber(tier.minLifetimePoints)} pts · ×{' '}
                    {formatNumber(tier.multiplier, locale)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {rules && rules.rewards.length > 0 && (
          <section className="rh-client-card">
            <h2>{t('loyalty.rewards')}</h2>
            <div className="rh-loyalty-rewards">
              {rules.rewards.map((reward) => {
                const affordable = (current?.points ?? 0) >= reward.costPoints;
                return (
                  <div key={reward.id} className="rh-loyalty-reward">
                    <div>
                      <strong>{reward.label}</strong>
                      <span>{t('loyalty.pointsShort', { points: reward.costPoints })}</span>
                    </div>
                    <button
                      type="button"
                      className="rh-client-btn rh-client-btn--soft rh-client-btn--sm"
                      disabled={!user || !affordable || busy === reward.id}
                      onClick={() => redeem(reward.id, reward.label, reward.costPoints)}
                    >
                      {affordable ? t('loyalty.redeem') : t('loyalty.insufficient')}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {user && (
          <section className="rh-client-card">
            <h2>{t('loyalty.claimTitle')}</h2>
            <p className="rh-client-hint">{t('loyalty.claimDesc')}</p>
            {paidOrders.length === 0 ? (
              <p className="rh-client-hint">{t('loyalty.noOrders')}</p>
            ) : (
              <div className="rh-loyalty-claims">
                {paidOrders.map((order) => (
                  <div key={order.orderId} className="rh-loyalty-claim">
                    <div>
                      <strong>{order.number}</strong>
                      <span>
                        {formatDate(order.createdAt, locale)} · {formatXof(order.totalXof, locale)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rh-client-btn rh-client-btn--ghost rh-client-btn--sm"
                      disabled={busy === order.orderId || claimed.has(order.orderId)}
                      onClick={() => claim(order.orderId)}
                    >
                      {claimed.has(order.orderId) ? t('loyalty.claimed') : t('loyalty.claimButton')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {user && current && (
          <section className="rh-client-card">
            <h2>{t('loyalty.history')}</h2>
            {current.history.length === 0 ? (
              <p className="rh-client-hint">{t('loyalty.noHistory')}</p>
            ) : (
              <ul className="rh-loyalty-history">
                {[...current.history].reverse().map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`rh-loyalty-history__badge rh-loyalty-history__badge--${entry.type}`}
                    >
                      <Icon name={entry.type === 'redeem' ? 'gift' : 'sparkles'} size="sm" />
                    </span>
                    <div>
                      <strong>{entry.reason}</strong>
                      <span>{formatDate(entry.at, locale)}</span>
                    </div>
                    <em className={entry.points >= 0 ? 'is-positive' : 'is-negative'}>
                      {entry.points >= 0 ? '+' : ''}
                      {entry.points}
                    </em>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {rules?.rules && (
          <p className="rh-client-hint rh-client-hint--center">
            <Icon name="info" size="sm" /> {rules.rules}
          </p>
        )}
      </main>
    </div>
  );
}
