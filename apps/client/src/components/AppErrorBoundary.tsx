import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '@resto-hub/design-system';

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RESTO-HUB client crash', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="rh-client-screen">
        <main className="rh-client-page">
          <div className="rh-client-empty">
            <span className="rh-client-empty__icon">
              <Icon name="alert" />
            </span>
            <h2>Une erreur est survenue</h2>
            <p>L’écran n’a pas pu s’afficher. Vous pouvez revenir à l’accueil et réessayer.</p>
            <p className="rh-client-hint">{error.message}</p>
            <button
              type="button"
              className="rh-client-btn rh-client-btn--primary"
              onClick={() => {
                window.location.hash = '#/';
                this.setState({ error: null });
              }}
            >
              Revenir à l’accueil
            </button>
          </div>
        </main>
      </div>
    );
  }
}
