import { useEffect, useState } from 'react';
import {
  Button,
  Icon,
  Logo,
  SegmentedControl,
  useI18n,
  useTheme,
  type Locale,
} from '@resto-hub/design-system';

const SECTION_IDS = ['product', 'story', 'services', 'journeys', 'payments', 'pricing'] as const;

export function SiteHeader() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHref, setActiveHref] = useState('#product');

  useEffect(() => {
    const closeOnResize = () => {
      if (window.innerWidth >= 1024) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('resize', closeOnResize);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', closeOnResize);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (section): section is HTMLElement => Boolean(section),
    );
    if (!('IntersectionObserver' in window) || sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveHref(`#${visible.target.id}`);
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: [0.15, 0.4, 0.7] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const links = [
    { href: '#story', label: t('landing.nav.about') },
    { href: '#product', label: t('landing.nav.product') },
    { href: '#services', label: t('landing.nav.services') },
    { href: '#pricing', label: t('landing.nav.pricing') },
  ];

  return (
    <header className="cnav">
      <div className="site-container cnav__inner">
        <a href="#top" className="cnav__brand" aria-label="RESTO-HUB">
          <Logo withWordmark inverse size={28} />
        </a>

        <nav
          id="site-nav"
          className={menuOpen ? 'cnav__links is-open' : 'cnav__links'}
          aria-label={t('nav.menu')}
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={activeHref === link.href ? 'is-active' : undefined}
              aria-current={activeHref === link.href ? 'true' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="cnav__mobile-tools">
            <a href="#/connexion" onClick={() => setMenuOpen(false)}>
              {t('nav.login')}
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
            <Button
              variant="ghost"
              iconOnly
              aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
              iconLeft={theme === 'light' ? 'moon' : 'sun'}
              onClick={toggleTheme}
            />
          </div>
          <a href="#contact" className="cnav__mobile-contact" onClick={() => setMenuOpen(false)}>
            {t('landing.nav.contact')}
          </a>
        </nav>

        <div className="cnav__actions">
          <div className="cnav__locale">
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
            className="cnav__theme"
            aria-label={theme === 'light' ? t('nav.themeDark') : t('nav.themeLight')}
            iconLeft={theme === 'light' ? 'moon' : 'sun'}
            onClick={toggleTheme}
          />
          <a href="#/connexion" className="cnav__login">
            {t('nav.login')}
          </a>
          <a href="#contact" className="cnav__contact">
            <span className="cnav__contact-icon">
              <Icon name="phone" size="sm" />
            </span>
            {t('landing.nav.contact')}
          </a>
          <Button
            variant="ghost"
            iconOnly
            className="cnav__burger"
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
