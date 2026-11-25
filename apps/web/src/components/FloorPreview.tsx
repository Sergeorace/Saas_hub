import {
  Icon,
  TABLE_STATUS_META,
  TABLE_STATUS_ORDER,
  cx,
  useI18n,
} from '@resto-hub/design-system';
import type { TableInfo } from '../data/types';

export function FloorPreview({
  tables,
  selectedId,
  onSelect,
}: {
  tables: TableInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { locale, t } = useI18n();

  return (
    <div className="floor">
      <div className="floor__grid" role="group" aria-label={t('hero.preview.floor')}>
        {tables.map((table) => {
          const label = TABLE_STATUS_META[table.status][locale === 'fr' ? 'labelFr' : 'labelEn'];
          return (
            <button
              key={table.id}
              type="button"
              className={cx(
                'floor-tile',
                `floor-tile--${table.status}`,
                selectedId === table.id && 'is-selected',
              )}
              aria-pressed={selectedId === table.id}
              aria-label={`${t('hero.preview.table')} ${table.id} · ${label}`}
              onClick={() => onSelect(table.id)}
            >
              <span className="floor-tile__id">{table.id}</span>
              <span className="floor-tile__meta">
                <Icon name="users" size="sm" />
                {table.seats}
              </span>
              <span className="floor-tile__status">{label}</span>
            </button>
          );
        })}
      </div>
      <ul className="floor__legend">
        {TABLE_STATUS_ORDER.map((status) => (
          <li key={status}>
            <span className={cx('floor-dot', `floor-dot--${status}`)} aria-hidden="true" />
            {TABLE_STATUS_META[status][locale === 'fr' ? 'labelFr' : 'labelEn']}
          </li>
        ))}
      </ul>
    </div>
  );
}
