import { useI18n } from '@resto-hub/design-system';
import { navigate, useLocation } from './lib/router';
import HomePage from './pages/HomePage';
import ExplorePage from './pages/ExplorePage';
import EstablishmentPage from './pages/EstablishmentPage';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import TrackingPage from './pages/TrackingPage';
import ScanPage from './pages/ScanPage';
import ReservationPage from './pages/ReservationPage';
import LoyaltyPage from './pages/LoyaltyPage';
import OrdersPage from './pages/OrdersPage';
import AccountPage from './pages/AccountPage';
import ReceiptPage from './pages/ReceiptPage';
import { ClientHeader } from './components/ClientChrome';

export default function App() {
  const location = useLocation();
  const { t } = useI18n();
  const segments = location.segments;

  if (segments.length === 0) return <HomePage />;

  if (segments[0] === 'recherche') return <ExplorePage />;

  if (segments[0] === 'scan')
    return <ScanPage presetTenant={location.query.get('tenant') ?? undefined} />;

  if (segments[0] === 'commandes')
    return <OrdersPage initialTab={location.query.get('tab') ?? undefined} />;

  if (segments[0] === 'compte') return <AccountPage />;

  if (segments[0] === 'recu' && segments[1]) return <ReceiptPage orderId={segments[1]} />;

  if (segments[0] === 'suivi' && segments[1] && segments[2]) {
    return (
      <TrackingPage
        tenantId={segments[1]}
        orderId={segments[2]}
        token={location.query.get('k') ?? ''}
      />
    );
  }

  if (segments[0] === 'e' && segments[1]) {
    const slug = segments[1];
    if (segments.length === 2) return <EstablishmentPage slug={slug} />;
    if (segments[2] === 'menu') return <MenuPage slug={slug} />;
    if (segments[2] === 'panier') return <CartPage slug={slug} />;
    if (segments[2] === 'paiement') return <CheckoutPage slug={slug} />;
    if (segments[2] === 'fidelite') return <LoyaltyPage slug={slug} />;
    if (segments[2] === 'reservation') {
      return (
        <ReservationPage
          slug={slug}
          existingId={location.query.get('res') ?? undefined}
          existingToken={location.query.get('k') ?? undefined}
        />
      );
    }
  }

  return (
    <div className="rh-client-screen">
      <ClientHeader title={t('common.error')} back="/" />
      <main className="rh-client-page">
        <div className="rh-client-empty">
          <h2>404</h2>
          <p>{t('common.noData')}</p>
          <button
            type="button"
            className="rh-client-btn rh-client-btn--primary"
            onClick={() => navigate('/')}
          >
            {t('nav.home')}
          </button>
        </div>
      </main>
    </div>
  );
}
