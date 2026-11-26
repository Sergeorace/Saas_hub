import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type BadgeTone =
  'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
  live?: boolean;
  icon?: IconName;
  className?: string;
}

export function Badge({ tone = 'neutral', children, dot, live, icon, className }: BadgeProps) {
  return (
    <span
      className={cx('rh-badge', `rh-badge--${tone}`, (dot || live) && 'rh-badge--live', className)}
    >
      {icon && <Icon name={icon} size="sm" />}
      {(dot || live) && <span className="rh-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export type TableStatus = 'free' | 'reserved' | 'occupied' | 'bill' | 'cleaning' | 'out';

export const TABLE_STATUS_META: Record<TableStatus, { labelFr: string; labelEn: string }> = {
  free: { labelFr: 'Libre', labelEn: 'Free' },
  reserved: { labelFr: 'Réservée', labelEn: 'Reserved' },
  occupied: { labelFr: 'Occupée', labelEn: 'Occupied' },
  bill: { labelFr: "En attente d'addition", labelEn: 'Bill requested' },
  cleaning: { labelFr: 'À nettoyer', labelEn: 'Cleaning' },
  out: { labelFr: 'Hors service', labelEn: 'Out of service' },
};

export const TABLE_STATUS_ORDER: TableStatus[] = [
  'free',
  'reserved',
  'occupied',
  'bill',
  'cleaning',
  'out',
];

export function TableStatusBadge({
  status,
  label,
  className,
}: {
  status: TableStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cx('rh-table-status', `rh-table-status--${status}`, className)}>
      {label ?? TABLE_STATUS_META[status].labelFr}
    </span>
  );
}
