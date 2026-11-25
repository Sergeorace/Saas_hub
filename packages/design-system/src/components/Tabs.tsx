import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  variant?: 'pill' | 'line';
  className?: string;
}

export const tabDomId = (group: string, id: string) => `${group}-tab-${id}`;
export const panelDomId = (group: string, id: string) => `${group}-panel-${id}`;

export function Tabs({ items, value, onChange, ariaLabel, variant = 'pill', className }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const group = `tabs-${items.map((item) => item.id).join('-')}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    const nextItem = items[next];
    onChange(nextItem.id);
    refs.current[nextItem.id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx('rh-tabs', variant === 'line' && 'rh-tabs--line', className)}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[item.id] = node;
          }}
          type="button"
          role="tab"
          id={tabDomId(group, item.id)}
          aria-selected={value === item.id}
          aria-controls={panelDomId(group, item.id)}
          tabIndex={value === item.id ? 0 : -1}
          className="rh-tab"
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {item.icon && <Icon name={item.icon} size="sm" />}
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}
