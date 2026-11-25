import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Logo,
  SegmentedControl,
  useI18n,
  useTheme,
  type Locale,
} from '@resto-hub/design-system';
import { useToast } from '@resto-hub/design-system';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import {
  errorMessage,
  identityApi,
  type LoginResult,
  type MfaConfirmation,
  type TokenBundle,
} from '../lib/api';

type Phase =
  | { kind: 'credentials' }
  | { kind: 'phone'; challengeId?: string; devCode?: string }
  | { kind: 'mfa-setup'; ticket: string; secret: string; otpauthUrl: string }
  | { kind: 'mfa-verify'; ticket: string }
  | { kind: 'recovery'; codes: string[]; bundle: TokenBundle };

const DEMO_ACCOUNTS = [
  { email: 'admin@resto-hub.tg', password: 'Admin#2026', labelKey: 'auth.demoAdmin' },
  { email: 'gerant@sahelgrill.tg', password: 'Gerant#2026', labelKey: 'auth.demoManager' },
  { email: 'serveur@sahelgrill.tg', password: 'Serveur#2026', labelKey: 'auth.demoStaff' },
];

export function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { signIn, status, claims } = useSession();
  const toast = useToast();

  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [phase, setPhase] = useState<Phase>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; code?: string; email?: string; password?: string }>({});
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && claims) {
      const isPlatform = claims.platformPermissions.includes('platform:establishments:review');
      const hasTenant = Object.keys(claims.tenantPermissions).length > 0;
      navigate(isPlatform ? '/admin' : hasTenant ? '/espace' : '/');
    }
  }, [status, claims]);

  const finish = async (bundle: TokenBundle, message: string) => {
    const { claims } = await signIn(bundle);
    toast.push({ title: message });
    const isPlatform = claims.platformPermissions.includes('platform:establishments:review');
    const hasTenant = Object.keys(claims.tenantPermissions).length > 0;
    navigate(isPlatform ? '/admin' : hasTenant ? '/espace' : '/');
  };

  const handleLoginResult = async (result: LoginResult) => {
    if (!result.mfaRequired) {
      await finish(result, t('auth.success'));
      return;
    }
    if (result.mfaSetupRequired) {
      setPending('mfa');
      try {
        const enrollment = await identityApi.mfaEnroll(result.ticket);
        setPhase({ kind: 'mfa-setup', ticket: result.ticket, secret: enrollment.secret, otpauthUrl: enrollment.otpauthUrl });
      } catch (error) {
        setErrors({ form: errorMessage(error) });
      } finally {
        setPending(null);
      }
      return;
    }
    setPhase({ kind: 'mfa-verify', ticket: result.ticket });
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    setPending('email');
    try {
      const result = await identityApi.emailLogin(email.trim(), password);
      await handleLoginResult(result);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const startPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    setPending('phone-start');
    try {
      const challenge = await identityApi.phoneStart(phone.trim());
      setPhase({ kind: 'phone', challengeId: challenge.challengeId, devCode: challenge.devCode });
      setCode('');
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const verifyPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase.kind !== 'phone' || !phase.challengeId) return;
    setErrors({});
    setPending('phone-verify');
    try {
      const result = await identityApi.phoneVerify(phase.challengeId, code.trim(), name.trim() || undefined);
      await handleLoginResult(result);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const confirmMfaSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase.kind !== 'mfa-setup') return;
    setErrors({});
    setPending('mfa-confirm');
    try {
      const result: MfaConfirmation = await identityApi.mfaConfirm(code.trim(), phase.ticket);
      if (!result.accessToken || !result.refreshToken || !result.sessionId || !result.user) {
        setErrors({ form: t('auth.mfaUnexpected') });
        return;
      }
      setPhase({ kind: 'recovery', codes: result.recoveryCodes, bundle: result as TokenBundle });
    } catch (error) {
      setErrors({ code: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const verifyMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase.kind !== 'mfa-verify') return;
    setErrors({});
    setPending('mfa-verify');
    try {
      const bundle = await identityApi.mfaVerify(phase.ticket, code.trim());
      await finish(bundle, t('auth.success'));
    } catch (error) {
      setErrors({ code: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const socialLogin = async (provider: 'google' | 'apple') => {
    setErrors({});
    setPending(provider);
    try {
      const demoEmail = email.trim() || 'gerant@sahelgrill.tg';
      const result = await identityApi.social(provider, `demo:${demoEmail}`);
      await handleLoginResult(result);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setPending(null);
    }
  };

  const reset = () => {
    setPhase({ kind: 'credentials' });
    setCode('');
    setRecoveryMode(false);
    setErrors({});
  };

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <div className="auth-aside__top">
          <a href="#/" className="auth-aside__brand" aria-label="RESTO-HUB">
            <Logo withWordmark size={30} />
          </a>
          <SegmentedControl<Locale>
            ariaLabel={t('nav.language')}
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'fr', label: 'FR', ariaLabel: 'Français' },
              { value: 'en', label: 'EN', ariaLabel: 'English' },
            ]}
          />
        </div>
        <div className="auth-aside__body">
          <p className="auth-aside__eyebrow">{t('auth.eyebrow')}</p>
          <h1 className="auth-aside__title">{t('auth.pitchTitle')}</h1>
          <p className="auth-aside__lead">{t('auth.pitchBody')}</p>
          <ul className="auth-aside__points">
            {[t('auth.pitchPoint1'), t('auth.pitchPoint2'), t('auth.pitchPoint3')].map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="auth-demos">
            <div className="auth-demos__title">{t('auth.demoTitle')}</div>
            <p className="auth-demos__hint">{t('auth.demoHint')}</p>
            <div className="auth-demos__list">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="auth-chip"
                  onClick={() => {
                    setMode('email');
                    reset();
                    setEmail(account.email);
                    setPassword(account.password);
                  }}
                >
                  <span className="auth-chip__label">{t(account.labelKey)}</span>
                  <span className="auth-chip__email">{account.email}</span>
                  <code className="auth-chip__secret">{account.password}</code>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="auth-aside__legal">{t('auth.legal')}</p>
      </aside>

      <main className="auth-main">
        <div className="auth-main__top">
          <Button variant="ghost" iconLeft="arrow-left" size="sm" onClick={() => navigate('/')}>
            {t('auth.backHome')}
          </Button>
          <Button
            variant="ghost"
            iconOnly
            aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
            iconLeft={theme === 'light' ? 'moon' : 'sun'}
            onClick={toggleTheme}
          />
        </div>

        <div className="auth-card">
          {(phase.kind === 'credentials' || phase.kind === 'phone') && (
            <>
              <header className="auth-card__head">
                <h2 className="auth-card__title">{t('auth.title')}</h2>
                <p className="auth-card__lead">{t('auth.lead')}</p>
              </header>

              <TabsMode value={mode} onChange={setMode} />

              {mode === 'email' ? (
                <form className="auth-form" onSubmit={submitEmail} noValidate>
                  <Input
                    label={t('auth.email')}
                    type="email"
                    autoComplete="email"
                    placeholder="gerant@etablissement.tg"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <Input
                    label={t('auth.password')}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
                  <Button type="submit" size="lg" fullWidth loading={pending === 'email'}>
                    {pending === 'email' ? t('auth.loggingIn') : t('auth.login')}
                  </Button>
                </form>
              ) : (
                <>
                  {phase.kind !== 'phone' ? (
                    <form className="auth-form" onSubmit={startPhone} noValidate>
                      <Input
                        label={t('auth.phone')}
                        type="tel"
                        autoComplete="tel"
                        placeholder="+228 90 00 00 00"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        hint={t('auth.phoneHint')}
                        required
                      />
                      <Input
                        label={t('auth.nameOptional')}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="name"
                      />
                      {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
                      <Button type="submit" size="lg" fullWidth loading={pending === 'phone-start'}>
                        {t('auth.sendCode')}
                      </Button>
                    </form>
                  ) : (
                    <form className="auth-form" onSubmit={verifyPhone} noValidate>
                      <div className="auth-otp-head">
                        <p>{t('auth.codeSentTo', { phone })}</p>
                        {phase.devCode && (
                          <Badge tone="info" icon="smartphone">
                            {t('auth.devCode', { code: phase.devCode })}
                          </Badge>
                        )}
                      </div>
                      <Input
                        label={t('auth.code')}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]*"
                        maxLength={6}
                        className="rh-input--otp"
                        placeholder="000000"
                        value={code}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                        required
                      />
                      {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
                      <Button type="submit" size="lg" fullWidth loading={pending === 'phone-verify'} disabled={code.length < 4}>
                        {t('auth.verify')}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={reset}>
                        {t('auth.changePhone')}
                      </Button>
                    </form>
                  )}
                </>
              )}

              <div className="auth-divider"><span>{t('auth.or')}</span></div>
              <div className="auth-social">
                <Button variant="outline" iconLeft="globe" onClick={() => socialLogin('google')} loading={pending === 'google'}>
                  Google
                </Button>
                <Button variant="outline" iconLeft="smartphone" onClick={() => socialLogin('apple')} loading={pending === 'apple'}>
                  Apple
                </Button>
              </div>
              <p className="auth-hint">{t('auth.socialHint')}</p>

              <p className="auth-switch">
                {t('auth.noAccount')}{' '}
                <a href="#/inscription">{t('auth.createAccount')}</a>
              </p>
            </>
          )}

          {phase.kind === 'mfa-setup' && (
            <form className="auth-form" onSubmit={confirmMfaSetup} noValidate>
              <Badge tone="warning" icon="shield">{t('auth.mfaRequired')}</Badge>
              <header className="auth-card__head">
                <h2 className="auth-card__title">{t('auth.mfaSetupTitle')}</h2>
                <p className="auth-card__lead">{t('auth.mfaSetupLead')}</p>
              </header>
              <ol className="auth-steps">
                <li>{t('auth.mfaStep1')}</li>
                <li>{t('auth.mfaStep2')}</li>
                <li>{t('auth.mfaStep3')}</li>
              </ol>
              <div className="auth-secret">
                <span>{t('auth.mfaSecret')}</span>
                <code>{phase.secret}</code>
                <a href={phase.otpauthUrl} className="auth-secret__link">{t('auth.mfaOpen')}</a>
              </div>
              <Input
                label={t('auth.mfaCodeLabel')}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="rh-input--otp"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                error={errors.code}
                required
              />
              {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
              <Button type="submit" size="lg" fullWidth loading={pending === 'mfa-confirm'} disabled={code.length !== 6}>
                {t('auth.mfaConfirm')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                {t('auth.back')}
              </Button>
            </form>
          )}

          {phase.kind === 'mfa-verify' && (
            <form className="auth-form" onSubmit={verifyMfa} noValidate>
              <Badge tone="info" icon="lock">{t('auth.mfaVerifyBadge')}</Badge>
              <header className="auth-card__head">
                <h2 className="auth-card__title">{t('auth.mfaVerifyTitle')}</h2>
                <p className="auth-card__lead">{t('auth.mfaVerifyLead')}</p>
              </header>
              <Input
                label={recoveryMode ? t('auth.recoveryCode') : t('auth.mfaCodeLabel')}
                inputMode={recoveryMode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={recoveryMode ? 12 : 6}
                placeholder={recoveryMode ? 'ABCD-EFGH' : '000000'}
                className={recoveryMode ? undefined : 'rh-input--otp'}
                value={code}
                onChange={(event) =>
                  setCode(recoveryMode ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, ''))
                }
                error={errors.code}
                required
              />
              {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
              <Button type="submit" size="lg" fullWidth loading={pending === 'mfa-verify'}>
                {t('auth.mfaVerify')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRecoveryMode((current) => !current);
                  setCode('');
                  setErrors({});
                }}
              >
                {recoveryMode ? t('auth.mfaUseTotp') : t('auth.mfaUseRecovery')}
              </Button>
            </form>
          )}

          {phase.kind === 'recovery' && (
            <div className="auth-form">
              <Badge tone="success" icon="check-circle">{t('auth.mfaEnabled')}</Badge>
              <header className="auth-card__head">
                <h2 className="auth-card__title">{t('auth.recoveryTitle')}</h2>
                <p className="auth-card__lead">{t('auth.recoveryLead')}</p>
              </header>
              <div className="auth-recovery">
                {phase.codes.map((recovery) => (
                  <code key={recovery}>{recovery}</code>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                fullWidth
                onClick={() => {
                  void navigator.clipboard?.writeText(phase.codes.join('\n'));
                  toast.push({ title: t('auth.recoveryCopied') });
                }}
              >
                {t('auth.recoveryCopy')}
              </Button>
              <Button
                type="button"
                size="lg"
                fullWidth
                onClick={() => {
                  void finish(phase.bundle, t('auth.success')).catch((error: unknown) => {
                    toast.push({ title: t('auth.errorTitle'), description: errorMessage(error), tone: 'error' });
                  });
                }}
              >
                {t('auth.recoveryContinue')}
              </Button>
            </div>
          )}
        </div>

        <p className="auth-main__foot">{t('auth.footnote')}</p>
      </main>
    </div>
  );
}

function TabsMode({ value, onChange }: { value: 'email' | 'phone'; onChange: (next: 'email' | 'phone') => void }) {
  const { t } = useI18n();
  const items: Array<{ value: 'email' | 'phone'; label: string; icon: 'receipt' | 'smartphone' }> = [
    { value: 'email', label: t('auth.tabEmail'), icon: 'receipt' },
    { value: 'phone', label: t('auth.tabPhone'), icon: 'smartphone' },
  ];
  return (
    <div className="auth-mode" role="tablist" aria-label={t('auth.title')}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? 'auth-mode__btn is-active' : 'auth-mode__btn'}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
