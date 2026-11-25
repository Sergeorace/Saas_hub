import { useEffect, useState } from 'react';
import {
  Button,
  Logo,
  SegmentedControl,
  useI18n,
  useTheme,
  type Locale,
} from '@resto-hub/design-system';

export function SiteHeader() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnResize = () => {
      if (window.innerWidth >= 900) setMenuOpen(false);
    };
    window.addEventListener('resize', closeOnResize);
    return () => window.removeEventListener('resize', closeOnResize);
  }, []);

  const links = [
    { href: '#product', label: t('nav.product') },
    { href: '#services', label: t('nav.services') },
    { href: '#journeys', label: t('nav.journeys') },
    { href: '#payments', label: t('nav.payments') },
    { href: '#design', label: t('nav.design') },
    { href: '#pricing', label: t('nav.pricing') },
  ];

  return (
    <header className="site-header">
      <div className="site-container site-header__inner">
        <a href="#top" className="site-header__brand" aria-label="RESTO-HUB">
          <Logo withWordmark size={30} />
        </a>

        <nav
          id="site-nav"
          className={menuOpen ? 'site-nav is-open' : 'site-nav'}
          aria-label={t('nav.menu')}
        >
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          ))}
          <a
            href="#/inscription"
            className="rh-btn rh-btn--primary rh-btn--sm site-nav__mobile-cta"
            onClick={() => setMenuOpen(false)}
          >
            {t('nav.demo')}
          </a>
        </nav>

        <div className="site-header__actions">
          <div className="site-header__locale" aria-label={t('nav.language')}>
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
          <Button
            variant="ghost"
            iconOnly
            aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
            iconLeft={theme === 'light' ? 'moon' : 'sun'}
            onClick={toggleTheme}
          />
          <a href="#/connexion" className="rh-btn rh-btn--ghost site-header__login">
            {t('nav.login')}
          </a>
          <a href="#/inscription" className="rh-btn rh-btn--primary rh-btn--sm site-header__cta">
            {t('nav.demo')}
          </a>
          <Button
            variant="ghost"
            iconOnly
            className="site-header__burger"
            aria-label={menuOpen ? t('nav.close') : t('nav.menu')}
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            iconLeft={menuOpen ? 'x' : 'menu'}
            onClick={() => setMenuOpen((value) => !value)}
          />
        </div>
      </div>
    </header>
  );
}
