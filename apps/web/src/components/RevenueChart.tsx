import { cx, formatXof, formatXofCompact, useI18n } from '@resto-hub/design-system';

export function RevenueChart({ series }: { series: Array<{ day: number; amount: number }> }) {
  const { locale, t, tm } = useI18n();
  const weekdays = tm<string[]>('cockpit.weekdays');
  const total = series.reduce((sum, point) => sum + point.amount, 0);
  const max = Math.max(...series.map((point) => point.amount));

  return (
    <figure className="chart">
      <div
        className="chart__plot"
        role="img"
        aria-label={`${t('cockpit.chartTitle')} — ${formatXof(total, locale)}`}
      >
        {series.map((point, index) => (
          <div className="chart__col" key={point.day}>
            <span className="chart__value">{formatXofCompact(point.amount, locale)}</span>
            <span className="chart__bar-wrap">
              <span
                className={cx('chart__bar', index === series.length - 1 && 'chart__bar--today')}
                style={{ height: `${Math.round((point.amount / max) * 100)}%` }}
                title={`${weekdays[index] ?? ''} · ${formatXof(point.amount, locale)}`}
              />
            </span>
            <span className="chart__day">{weekdays[index]}</span>
          </div>
        ))}
      </div>
      <figcaption className="chart__foot">
        <span>{t('cockpit.chartTotal')}</span>
        <strong>{formatXof(total, locale)}</strong>
      </figcaption>
    </figure>
  );
}
