import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, ThemeProvider, ToastProvider, useI18n } from '@resto-hub/design-system';
import '@resto-hub/design-system/styles.css';
import './styles/site.css';
import './styles/console.css';
import './styles/step2.css';
import './styles/step3.css';
import { messages } from './i18n/messages';
import { SessionProvider } from './lib/session';
import App from './App';

function LocalizedToasts({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <ToastProvider closeLabel={locale === 'fr' ? 'Fermer' : 'Close'}>{children}</ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light">
      <I18nProvider messages={messages} defaultLocale="fr">
        <LocalizedToasts>
          <SessionProvider>
            <App />
          </SessionProvider>
        </LocalizedToasts>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
