import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';
import { Avatar } from './Feedback';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href?: string;
  active?: boolean;
  badge?: string | number;
  onClick?: () => void;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

function NavItemView({ item, compact }: { item: NavItem; compact?: boolean }) {
  const content = (
    <>
      <span className={cx(compact ? 'rh-bottom-nav__icon' : 'rh-nav-item__icon')}>
        <Icon name={item.icon} size={compact ? 'md' : 'sm'} />
        {compact && item.badge != null && (
          <span className="rh-bottom-nav__badge">{item.badge}</span>
        )}
      </span>
      <span>{item.label}</span>
      {!compact && item.badge != null && <span className="rh-nav-item__badge">{item.badge}</span>}
    </>
  );

  const className = compact ? 'rh-bottom-nav__item' : 'rh-nav-item';
  const ariaCurrent = item.active ? 'page' : undefined;

  if (item.href) {
    return (
      <a href={item.href} className={className} aria-current={ariaCurrent} onClick={item.onClick}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} aria-current={ariaCurrent} onClick={item.onClick}>
      {content}
    </button>
  );
}

export interface SidebarProps {
  brand: ReactNode;
  groups: NavGroup[];
  tenant?: { name: string; meta?: string };
  footer?: ReactNode;
  navLabel?: string;
  className?: string;
}

export function Sidebar({ brand, groups, tenant, footer, navLabel = 'Navigation principale', className }: SidebarProps) {
  return (
    <aside className={cx('rh-sidebar', className)}>
      <div className="rh-sidebar__brand">{brand}</div>
      {tenant && (
        <div className="rh-sidebar__tenant">
          <Avatar name={tenant.name} />
          <div>
            <div className="rh-sidebar__tenant-name">{tenant.name}</div>
            {tenant.meta && <div className="rh-sidebar__tenant-meta">{tenant.meta}</div>}
          </div>
        </div>
      )}
      <nav aria-label={navLabel} className="rh-stack" style={{ gap: 'var(--space-5)' }}>
        {groups.map((group, groupIndex) => (
          <div className="rh-sidebar__section" key={group.label ?? groupIndex}>
            {group.label && <div className="rh-sidebar__label">{group.label}</div>}
            {group.items.map((item) => (
              <NavItemView key={item.id} item={item} />
            ))}
          </div>
        ))}
      </nav>
      {footer && <div className="rh-sidebar__footer">{footer}</div>}
    </aside>
  );
}

export interface BottomNavProps {
  items: NavItem[];
  ariaLabel?: string;
  className?: string;
}

export function BottomNav({ items, ariaLabel = 'Navigation mobile', className }: BottomNavProps) {
  return (
    <nav className={cx('rh-bottom-nav', className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <NavItemView key={item.id} item={item} compact />
      ))}
    </nav>
  );
}

export interface AppShellProps {
  sidebar?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  topbarActions?: ReactNode;
  children: ReactNode;
  bottomNav?: ReactNode;
}

export function AppShell({ sidebar, title, subtitle, topbarActions, children, bottomNav }: AppShellProps) {
  return (
    <div className="rh-shell">
      {sidebar}
      <div className="rh-main">
        <header className="rh-topbar">
          <div>
            <div className="rh-topbar__title">{title}</div>
            {subtitle && <div className="rh-topbar__subtitle">{subtitle}</div>}
          </div>
          {topbarActions && <div className="rh-topbar__actions">{topbarActions}</div>}
        </header>
        <main className="rh-content">{children}</main>
        {bottomNav}
      </div>
    </div>
  );
}
