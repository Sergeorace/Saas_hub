import { useEffect, useMemo, useState } from 'react';
import {
  Icon,
  Skeleton,
  cx,
  formatNumber,
  initials,
  useI18n,
  useTheme,
  useToast,
} from '@resto-hub/design-system';
import { ApiError, accountApi, authApi, publicApi, type Establishment, type LoyaltyAccount, type LoyaltyProgram, type Review } from '../lib/api';
import { useSession } from '../lib/session';
import { useAsync } from '../lib/hooks';
import { navigate } from '../lib/router';
import { ClientBottomBar, ClientHeader } from '../components/ClientChrome';
import { StarRatingInput, Stars } from '../components/Stars';

export default function AccountPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const { user, session, signIn, signOut } = useSession();

  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  const establishments = useAsync(() => publicApi.establishments({}), []);
  const favorites = useAsync(() => (user ? accountApi.favorites() : Promise.resolve({ items: [] })), [user?.id]);
  const reviews = useAsync(() => (user ? accountApi.myReviews() : Promise.resolve({ items: [] as Review[] })), [user?.id]);
  const loyalty = useAsync<{ items: LoyaltyAccount[]; program: LoyaltyProgram | null }>(
    () => (user ? accountApi.myLoyalty() : Promise.resolve({ items: [] as LoyaltyAccount[], program: null })),
    [user?.id],
  );

  const byId = useMemo(() => {
    const map = new Map<string, Establishment>();
    for (const establishment of establishments.data?.items ?? []) map.set(establishment.id, establishment);
    return map;
  }, [establishments.data]);

  const favoriteEstablishments = (favorites.data?.items ?? [])
    .map((favorite) => byId.get(favorite.tenantId))
    .filter((establishment): establishment is Establishment => Boolean(establishment));

  useEffect(() => {
    if (loginNotice) {
      const timer = window.setTimeout(() => setLoginNotice(null), 2600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [loginNotice]);

  const sendCode = async () => {
    if (!phone.trim()) return;
    setSending(true);
    try {
      const result = await authApi.phoneStart(phone.trim());
      setChallenge({ id: result.challengeId, devCode: result.devCode });
      setCode('');
      toast.push({
        title: t('account.loginTitle'),
        description: result.devCode ? t('account.devCode', { code: result.devCode }) : undefined,
        tone: 'info',
      });
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : t('common.error');
      toast.push({ title: t('common.error'), description: message, tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (!challenge || !code.trim()) return;
    setVerifying(true);
    try {
      const bundle = await authApi.phoneVerify(challenge.id, code.trim(), name.trim() || undefined);
      signIn(bundle);
      setChallenge(null);
      setCode('');
      toast.push({ title: t('account.signedInAs'), description: bundle.user.name, tone: 'success' });
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : t('common.error');
      toast.push({ title: t('common.error'), description: message, tone: 'error' });
    } finally {
      setVerifying(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm(t('account.logoutConfirm'))) return;
    await signOut();
    setLoginNotice(t('nav.account'));
    toast.push({ title: t('common.logout'), tone: 'info' });
  };

  const displayName = session?.user.name || user?.name || '';

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('account.title')} />
      <main className="rh-client-page rh-client-page--flush">
        {!user && (
          <>
            <section className="rh-account-hero">
              <span className="rh-account-hero__badge">
                <Icon name="sparkles" size="sm" /> RESTO-HUB
              </span>
              <h1>{t('account.guestTitle')}</h1>
              <p>{t('account.guestDesc')}</p>
              <ul>
                <li>
                  <Icon name="check-circle" size="sm" /> {t('account.welcome1')}
                </li>
                <li>
                  <Icon name="check-circle" size="sm" /> {t('account.welcome2')}
                </li>
                <li>
                  <Icon name="check-circle" size="sm" /> {t('account.welcome3')}
                </li>
              </ul>
            </section>

            <section className="rh-account-card">
              <h2>{t('account.loginTitle')}</h2>
              <p className="rh-client-hint">{t('account.loginDesc')}</p>
              {!challenge ? (
                <>
                  <label className="rh-client-field">
                    <span>{t('account.phone')}</span>
                    <input
                      className="rh-client-input"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={t('account.phonePlaceholder')}
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void sendCode();
                      }}
                    />
                  </label>
                  <button type="button" className="rh-client-btn rh-client-btn--primary rh-client-btn--block" onClick={sendCode} disabled={sending || phone.trim().length < 6}>
                    {sending ? t('account.sending') : t('account.sendCode')}
                  </button>
                </>
              ) : (
                <>
                  <label className="rh-client-field">
                    <span>{t('account.code')}</span>
                    <input
                      className="rh-client-input rh-client-input--code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder={t('account.codePlaceholder')}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void verifyCode();
                      }}
                    />
                  </label>
                  <label className="rh-client-field">
                    <span>
                      {t('account.name')} <em>({t('common.optional')})</em>
                    </span>
                    <input className="rh-client-input" autoComplete="given-name" placeholder={t('account.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  {challenge.devCode && (
                    <p className="rh-client-hint">
                      <Icon name="info" size="sm" /> {t('account.devCode', { code: challenge.devCode })}
                    </p>
                  )}
                  <button type="button" className="rh-client-btn rh-client-btn--primary rh-client-btn--block" onClick={verifyCode} disabled={verifying || code.length < 4}>
                    {verifying ? t('account.verifying') : t('account.verify')}
                  </button>
                  <button type="button" className="rh-client-link-btn" onClick={() => setChallenge(null)}>
                    {t('account.changePhone')}
                  </button>
                </>
              )}
            </section>
          </>
        )}

        {user && (
          <>
            <section className="rh-account-profile">
              <span className="rh-account-avatar">{initials(displayName || user.phone || 'RH')}</span>
              <div>
                <strong>{displayName || user.phone}</strong>
                <span>{user.phone ?? user.email}</span>
                <span className="rh-client-pill rh-client-pill--success">{t('account.signedInAs')}</span>
              </div>
              <button type="button" className="rh-client-icon-btn" aria-label={t('common.logout')} onClick={handleSignOut}>
                <Icon name="logout" />
              </button>
            </section>

            <section className="rh-account-card">
              <header className="rh-account-card__head">
                <h2>{t('account.loyalty')}</h2>
                <span className="rh-client-hint">{t('account.loyaltyDesc')}</span>
              </header>
              {loyalty.loading && <Skeleton height={64} />}
              {!loyalty.loading && (loyalty.data?.items.length ?? 0) === 0 && <p className="rh-client-hint">{t('account.noLoyalty')}</p>}
              <div className="rh-account-loyalty">
                {(loyalty.data?.items ?? []).map((account) => {
                  const establishment = byId.get(account.tenantId);
                  return (
                    <button
                      key={account.tenantId}
                      type="button"
                      className="rh-account-loyalty__row"
                      onClick={() => establishment && navigate(`/e/${establishment.slug}/fidelite`)}
                    >
                      <span className="rh-account-loyalty__points">{formatNumber(account.points)}</span>
                      <span className="rh-account-loyalty__meta">
                        <strong>{establishment?.brandName ?? account.tenantId}</strong>
                        <em>{t('account.tier', { tier: account.tier.label })}</em>
                      </span>
                      <Icon name="chevron-right" size="sm" />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rh-account-card">
              <header className="rh-account-card__head">
                <h2>{t('account.favorites')}</h2>
              </header>
              {favorites.loading && <Skeleton height={64} />}
              {!favorites.loading && favoriteEstablishments.length === 0 && <p className="rh-client-hint">{t('account.noFavorites')}</p>}
              <div className="rh-account-favorites">
                {favoriteEstablishments.map((establishment) => (
                  <button key={establishment.id} type="button" className="rh-account-favorite" onClick={() => navigate(`/e/${establishment.slug}`)}>
                    <span className="rh-account-favorite__thumb" style={{ backgroundImage: establishment.photos[0] ? `url(${establishment.photos[0]})` : undefined }}>
                      {!establishment.photos[0] && <Icon name="utensils" />}
                    </span>
                    <span>
                      <strong>{establishment.brandName}</strong>
                      <em>{establishment.address?.city ?? 'Lomé'}</em>
                    </span>
                    <Icon name="chevron-right" size="sm" />
                  </button>
                ))}
              </div>
            </section>

            <section className="rh-account-card">
              <header className="rh-account-card__head">
                <h2>{t('account.myReviews')}</h2>
              </header>
              {reviews.loading && <Skeleton height={64} />}
              {!reviews.loading && (reviews.data?.items.length ?? 0) === 0 && <p className="rh-client-hint">{t('account.noReviews')}</p>}
              <div className="rh-account-reviews">
                {(reviews.data?.items ?? []).map((review) => {
                  const establishment = byId.get(review.tenantId);
                  return (
                    <article key={review.id} className="rh-account-review">
                      <header>
                        <strong>{establishment?.brandName ?? review.tenantId}</strong>
                        <Stars value={review.rating} size="sm" />
                      </header>
                      {review.comment && <p>{review.comment}</p>}
                      <footer>
                        <span>{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(review.createdAt))}</span>
                        {review.status === 'pending' && <span className="rh-client-pill rh-client-pill--warning">{t('establishment.reviewPending')}</span>}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {loginNotice && <p className="rh-client-hint rh-client-hint--center">{loginNotice}</p>}

        <section className="rh-account-card">
          <header className="rh-account-card__head">
            <h2>{t('account.settings')}</h2>
          </header>
          <div className="rh-account-setting">
            <div>
              <strong>{t('account.appearance')}</strong>
              <span>{theme === 'dark' ? t('common.dark') : t('common.light')}</span>
            </div>
            <div className="rh-account-segment">
              <button type="button" className={cx(theme === 'light' && 'is-active')} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
                <Icon name="sun" size="sm" /> {t('common.light')}
              </button>
              <button type="button" className={cx(theme === 'dark' && 'is-active')} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
                <Icon name="moon" size="sm" /> {t('common.dark')}
              </button>
            </div>
          </div>
          <div className="rh-account-setting">
            <div>
              <strong>{t('account.language')}</strong>
              <span>{locale === 'fr' ? 'Français · XOF' : 'English · XOF'}</span>
            </div>
            <div className="rh-account-segment">
              <button type="button" className={cx(locale === 'fr' && 'is-active')} onClick={() => setLocale('fr')} aria-pressed={locale === 'fr'}>
                FR
              </button>
              <button type="button" className={cx(locale === 'en' && 'is-active')} onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>
                EN
              </button>
            </div>
          </div>
          <div className="rh-account-setting">
            <div>
              <strong>{t('orders.title')}</strong>
              <span>{t('orders.subtitle')}</span>
            </div>
            <button type="button" className="rh-client-icon-btn" aria-label={t('orders.title')} onClick={() => navigate('/commandes')}>
              <Icon name="receipt" />
            </button>
          </div>
          <div className="rh-account-setting">
            <div>
              <strong>{t('scan.title')}</strong>
              <span>{t('scan.desc')}</span>
            </div>
            <button type="button" className="rh-client-icon-btn" aria-label={t('scan.title')} onClick={() => navigate('/scan')}>
              <Icon name="scan" />
            </button>
          </div>
        </section>

        <section className="rh-account-install">
          <Icon name="smartphone" />
          <div>
            <strong>{t('account.install')}</strong>
            <p>{t('account.installDesc')}</p>
          </div>
        </section>
        <p className="rh-client-hint rh-client-hint--center">{t('account.aboutDesc')}</p>
      </main>
      <ClientBottomBar active="account" />
    </div>
  );
}
