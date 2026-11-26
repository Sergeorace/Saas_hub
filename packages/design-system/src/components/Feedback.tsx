import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height, circle, className, style }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cx('rh-skeleton', circle && 'rh-skeleton--circle', className)}
      style={{ width, height, ...style }}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rh-stack" style={{ gap: '0.55rem' }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="rh-skeleton rh-skeleton--text"
          style={{ width: index === lines - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon = 'sparkles',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx('rh-empty', className)}>
      <span className="rh-empty__icon">
        <Icon name={icon} size="lg" />
      </span>
      <h3 className="rh-empty__title">{title}</h3>
      {description && <p className="rh-empty__desc">{description}</p>}
      {action && <div className="rh-empty__actions">{action}</div>}
    </div>
  );
}

export function Avatar({
  name,
  size = 'md',
  tone = 'primary',
}: {
  name: string;
  size?: 'md' | 'lg';
  tone?: 'primary' | 'neutral';
}) {
  const value = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={cx(
        'rh-avatar',
        size === 'lg' && 'rh-avatar--lg',
        tone === 'neutral' && 'rh-avatar--neutral',
      )}
      aria-label={name}
      role="img"
    >
      {value}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  icon?: IconName;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cx('rh-segmented', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="rh-segmented__item"
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size="sm" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
