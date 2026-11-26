import { useEffect } from 'react';
import { useI18n } from '@resto-hub/design-system';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { Hero } from './sections/Hero';
import { TrustStrip } from './sections/TrustStrip';
import { Story } from './sections/Story';
import { Testimonials } from './sections/Testimonials';
import { Cockpit } from './sections/Cockpit';
import { Services } from './sections/Services';
import { Journeys } from './sections/Journeys';
import { Payments } from './sections/Payments';
import { DesignGallery } from './sections/DesignGallery';
import { Pricing } from './sections/Pricing';
import { FinalCta } from './sections/FinalCta';
import { useRoute, scrollToSection } from './lib/router';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminPage } from './pages/AdminPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { DesignPage } from './pages/DesignPage';
import { PublicTablePage, PublicTrackingPage } from './pages/PublicOrderPage';
import { ErrorBoundary } from './components/ErrorBoundary';

function LandingPage() {
  const { t } = useI18n();

  useEffect(() => {
    document.title = t('meta.title');
  }, [t]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.('a[href^="#"]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (href === '#' || href.startsWith('#/')) return;
      const id = decodeURIComponent(href.slice(1));
      if (!document.getElementById(id)) return;
      event.preventDefault();
      scrollToSection(id);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <div className="site" id="top">
      <a className="rh-skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <Hero />
        <TrustStrip />
        <Story />
        <Cockpit />
        <Services />
        <Journeys />
        <Payments />
        <Testimonials />
        <DesignGallery />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

const TITLES: Record<string, string> = {
  '/connexion': 'Connexion — RESTO-HUB',
  '/inscription': 'Créer un établissement — RESTO-HUB',
  '/admin': 'Supervision plateforme — RESTO-HUB',
  '/espace': 'Espace gérant — RESTO-HUB',
  '/design': 'Design system — RESTO-HUB',
};

export default function App() {
  const route = useRoute();
  const pagePath = route.isAnchor ? '/' : route.path;
  const tableMatch = /^\/t\/([^/]+)\/([^/]+)$/.exec(route.path);
  const trackingMatch = /^\/suivi\/([^/]+)\/([^/]+)$/.exec(route.path);
  const title =
    TITLES[pagePath] ??
    (tableMatch
      ? 'Carte de la table — RESTO-HUB'
      : trackingMatch
        ? 'Suivi de commande — RESTO-HUB'
        : 'RESTO-HUB');

  useEffect(() => {
    document.title = title;
  }, [title]);

  if (tableMatch) {
    return (
      <ErrorBoundary key={route.path}>
        <PublicTablePage
          tenantId={decodeURIComponent(tableMatch[1])}
          tableCode={decodeURIComponent(tableMatch[2])}
          tableToken={route.params.get('k') ?? ''}
        />
      </ErrorBoundary>
    );
  }

  if (trackingMatch) {
    return (
      <ErrorBoundary key={route.path}>
        <PublicTrackingPage
          tenantId={decodeURIComponent(trackingMatch[1])}
          orderId={decodeURIComponent(trackingMatch[2])}
          trackingKey={route.params.get('k') ?? ''}
        />
      </ErrorBoundary>
    );
  }

  switch (pagePath) {
    case '/connexion':
      return <LoginPage />;
    case '/inscription':
      return <RegisterPage />;
    case '/admin':
      return <AdminPage />;
    case '/espace':
      return <WorkspacePage />;
    case '/design':
      return <DesignPage />;
    default:
      return <LandingPage />;
  }
}
