import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  flat?: boolean;
}

export function Card({ interactive, flat, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rh-card',
        interactive && 'rh-card--interactive',
        flat && 'rh-card--flat',
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, action, className }: CardHeaderProps) {
  return (
    <div className={cx('rh-card__header', className)}>
      <div>
        <div className="rh-card__title">{title}</div>
        {subtitle && <div className="rh-card__subtitle">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rh-card__body', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rh-card__footer', className)} {...rest} />;
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: IconName;
  delta?: { value: string; direction: 'up' | 'down' };
  meta?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, icon, delta, meta, className }: StatCardProps) {
  return (
    <div className={cx('rh-card rh-card--padded rh-stat', className)}>
      <div className="rh-stat__label">
        {icon && <Icon name={icon} size="sm" />}
        {label}
      </div>
      <div className="rh-stat__value">{value}</div>
      {(delta || meta) && (
        <div className="rh-stat__meta">
          {delta && (
            <span className={cx('rh-trend', delta.direction === 'up' ? 'rh-trend--up' : 'rh-trend--down')}>
              <Icon name={delta.direction === 'up' ? 'trending-up' : 'arrow-right'} size="sm" />
              {delta.value}
            </span>
          )}
          {meta}
        </div>
      )}
    </div>
  );
}
