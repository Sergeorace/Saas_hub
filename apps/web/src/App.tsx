import { useEffect } from 'react';
import { useI18n } from '@resto-hub/design-system';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { Hero } from './sections/Hero';
import { Cockpit } from './sections/Cockpit';
import { Services } from './sections/Services';
import { Journeys } from './sections/Journeys';
import { Payments } from './sections/Payments';
import { DesignGallery } from './sections/DesignGallery';
import { Pricing } from './sections/Pricing';
import { FinalCta } from './sections/FinalCta';
import { useRoute } from './lib/router';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminPage } from './pages/AdminPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { PublicTablePage, PublicTrackingPage } from './pages/PublicOrderPage';
import { ErrorBoundary } from './components/ErrorBoundary';

function LandingPage() {
  const { t } = useI18n();

  useEffect(() => {
    document.title = t('meta.title');
  }, [t]);

  return (
    <div className="site" id="top">
      <a className="rh-skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Cockpit />
        <Services />
        <Journeys />
        <Payments />
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
};

export default function App() {
  const route = useRoute();
  const tableMatch = /^\/t\/([^/]+)\/([^/]+)$/.exec(route.path);
  const trackingMatch = /^\/suivi\/([^/]+)\/([^/]+)$/.exec(route.path);
  const title =
    TITLES[route.path] ??
    (tableMatch ? 'Carte de la table — RESTO-HUB' : trackingMatch ? 'Suivi de commande — RESTO-HUB' : 'RESTO-HUB');

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

  switch (route.path) {
    case '/connexion':
      return <LoginPage />;
    case '/inscription':
      return <RegisterPage />;
    case '/admin':
      return <AdminPage />;
    case '/espace':
      return <WorkspacePage />;
    default:
      return <LandingPage />;
  }
}
