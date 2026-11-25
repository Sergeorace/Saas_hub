import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, ThemeProvider, ToastProvider, useI18n } from '@resto-hub/design-system';
import '@resto-hub/design-system/styles.css';
import './styles/client.css';
import { messages } from './i18n/messages';
import { SessionProvider } from './lib/session';
import { adoptLegacyPaths } from './lib/router';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import App from './App';

function LocalizedToasts({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return <ToastProvider closeLabel={locale === 'fr' ? 'Fermer' : 'Close'}>{children}</ToastProvider>;
}

adoptLegacyPaths();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <I18nProvider messages={messages} defaultLocale="fr">
        <LocalizedToasts>
          <SessionProvider>
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </SessionProvider>
        </LocalizedToasts>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA hors ligne optionnelle */
    });
  });
}
