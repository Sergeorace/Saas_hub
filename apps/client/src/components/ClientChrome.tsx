import type { ReactNode } from 'react';
import { BottomNav, Icon, cx, useI18n, useTheme, type NavItem } from '@resto-hub/design-system';
import { navigate } from '../lib/router';

export function ThemeToggle({ compact = true }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const label = theme === 'dark' ? t('common.light') : t('common.dark');
  return (
    <button
      type="button"
      className={cx('rh-chrome-btn', !compact && 'rh-chrome-btn--wide')}
      onClick={toggleTheme}
      aria-label={`${t('common.theme')} : ${label}`}
      title={`${t('common.theme')} : ${label}`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      className="rh-chrome-btn rh-chrome-btn--locale"
      onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
      aria-label={`${locale === 'fr' ? 'Switch to English' : 'Passer en français'}`}
      title={locale === 'fr' ? 'English' : 'Français'}
    >
      <span>{locale === 'fr' ? 'FR' : 'EN'}</span>
    </button>
  );
}

export function ClientHeader({
  title,
  subtitle,
  back,
  logo,
  actions,
  sticky = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string | boolean;
  logo?: string | null;
  actions?: ReactNode;
  sticky?: boolean;
}) {
  const goBack = typeof back === 'string' ? back : '/';
  return (
    <header className={cx('rh-client-header', sticky && 'rh-client-header--sticky')}>
      <div className="rh-client-header__row">
        {back ? (
          <button
            type="button"
            className="rh-chrome-btn rh-chrome-btn--round"
            aria-label="Retour"
            onClick={() => (back === true ? (window.history.length > 1 ? window.history.back() : navigate('/')) : navigate(goBack))}
          >
            <Icon name="arrow-left" size="sm" />
          </button>
        ) : (
          <span className="rh-client-header__mark" aria-hidden="true">
            {logo ? <img src={logo} alt="" /> : <Icon name="utensils" size="sm" />}
          </span>
        )}
        <div className="rh-client-header__titles">
          <div className="rh-client-header__title">{title}</div>
          {subtitle && <div className="rh-client-header__subtitle">{subtitle}</div>}
        </div>
        <div className="rh-client-header__actions">
          {actions}
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function ClientBottomBar({ active }: { active: string }) {
  const { t, locale } = useI18n();
  const items: NavItem[] = [
    { id: 'home', label: t('nav.home'), icon: 'home', href: '#/', active: active === 'home' },
    { id: 'explore', label: t('nav.explore'), icon: 'search', href: '#/recherche', active: active === 'explore' },
    { id: 'scan', label: t('nav.scan'), icon: 'scan', href: '#/scan', active: active === 'scan' },
    { id: 'orders', label: t('nav.orders'), icon: 'receipt', href: '#/commandes', active: active === 'orders' },
    { id: 'account', label: t('nav.account'), icon: 'users', href: '#/compte', active: active === 'account' },
  ];
  return (
    <div className="rh-client-bottom">
      <BottomNav items={items} ariaLabel={locale === 'fr' ? 'Navigation de l’application cliente' : 'Guest app navigation'} />
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rh-client-section-head">
      <div>
        <h2 className="rh-client-section-title">{title}</h2>
        {subtitle && <p className="rh-client-section-sub">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rh-client-page" aria-busy="true">
      <div className="rh-client-skel rh-client-skel--hero" />
      <div className="rh-client-skeleton-row">
        {Array.from({ length: rows }, (_, index) => (
          <div className="rh-client-skel rh-client-skel--row" key={index} />
        ))}
      </div>
    </div>
  );
}

export function ErrorPanel({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <div className="rh-client-page">
      <div className="rh-client-error">
        <span className="rh-client-error__icon">
          <Icon name="alert" />
        </span>
        <p>{message}</p>
        {onRetry && (
          <button type="button" className="rh-client-link-btn" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={cx('rh-client-pill', `rh-client-pill--${tone}`)}>{children}</span>;
}
