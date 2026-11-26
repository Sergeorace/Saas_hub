import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RESTO-HUB] rendu interrompu', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="pub-page">
          <div className="rh-card">
            <div className="rh-card__body" role="alert">
              <strong>Une erreur est survenue</strong>
              <p className="console-muted">Actualisez la page ou revenez à l’accueil.</p>
              <p className="console-muted" data-error-message>
                {this.state.error.message}
              </p>
              <button
                type="button"
                className="rh-btn rh-btn--primary"
                onClick={() => window.location.assign('#/')}
              >
                Retour à l’accueil
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
