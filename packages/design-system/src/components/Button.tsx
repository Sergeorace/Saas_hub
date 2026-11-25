import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'soft'
  | 'danger'
  | 'danger-soft';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  iconOnly?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    iconLeft,
    iconRight,
    iconOnly = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'rh-btn',
        variant !== 'primary' && `rh-btn--${variant}`,
        variant === 'primary' && 'rh-btn--primary',
        size !== 'md' && `rh-btn--${size}`,
        fullWidth && 'rh-btn--full',
        iconOnly && 'rh-btn--icon',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="rh-btn__spinner" aria-hidden="true" />
      ) : (
        iconLeft && (
          <span className="rh-btn__icon">
            <Icon name={iconLeft} />
          </span>
        )
      )}
      {!iconOnly && children}
      {iconRight && !loading && (
        <span className="rh-btn__icon">
          <Icon name={iconRight} />
        </span>
      )}
    </button>
  );
});
