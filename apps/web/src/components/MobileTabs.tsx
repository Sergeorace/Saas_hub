import { Icon, type IconName } from '@resto-hub/design-system';

export interface MobileTabItem {
  id: string;
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

export function MobileTabs({ label, items }: { label: string; items: MobileTabItem[] }) {
  return (
    <nav className="console-tabbar" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="console-tabbar__item"
          aria-current={item.active ? 'page' : undefined}
          onClick={item.onClick}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.badge ? <span className="console-tabbar__badge">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
