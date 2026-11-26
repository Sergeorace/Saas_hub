import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

const toneIcon: Record<ToastTone, IconName> = {
  success: 'check-circle',
  error: 'x-circle',
  info: 'info',
  warning: 'alert',
};

interface ToastContextValue {
  push: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({
  children,
  closeLabel = 'Fermer',
}: {
  children: ReactNode;
  closeLabel?: string;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastOptions) => {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random()}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      const duration = toast.duration ?? 4500;
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="rh-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const tone = toast.tone ?? 'success';
          return (
            <div key={toast.id} className={cx('rh-toast', `rh-toast--${tone}`)} role="status">
              <span className="rh-toast__icon">
                <Icon name={toneIcon[tone]} />
              </span>
              <div className="rh-toast__content">
                <div className="rh-toast__title">{toast.title}</div>
                {toast.description && <div className="rh-toast__desc">{toast.description}</div>}
              </div>
              <button type="button" className="rh-toast__close" onClick={() => dismiss(toast.id)}>
                <Icon name="x" size="sm" />
                <span className="rh-sr-only">{closeLabel}</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast doit être utilisé dans un <ToastProvider>.');
  }
  return context;
}
