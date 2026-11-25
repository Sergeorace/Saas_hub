import { useMemo, useState } from 'react';
import { cx, useI18n } from '@resto-hub/design-system';
import type { Establishment } from '../lib/api';
import { isOpenNow, kindKey, shortAddress } from '../lib/format';
import { navigate } from '../lib/router';

const WIDTH = 340;
const HEIGHT = 240;
const PADDING = 34;

interface Point {
  establishment: Establishment;
  x: number;
  y: number;
}

export function PlacesMap({ establishments }: { establishments: Establishment[] }) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(establishments[0]?.id ?? null);

  const points = useMemo<Point[]>(() => {
    const withGeo = establishments.filter((item) => item.geo);
    if (withGeo.length === 0) return [];
    const lats = withGeo.map((item) => item.geo!.lat);
    const lngs = withGeo.map((item) => item.geo!.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat || 0.01;
    const lngSpan = maxLng - minLng || 0.01;
    return withGeo.map((item) => {
      const ratioX = (item.geo!.lng - minLng) / lngSpan;
      const ratioY = (item.geo!.lat - minLat) / latSpan;
      return {
        establishment: item,
        x: PADDING + ratioX * (WIDTH - PADDING * 2),
        y: HEIGHT - PADDING - ratioY * (HEIGHT - PADDING * 2),
      };
    });
  }, [establishments]);

  const selected = establishments.find((item) => item.id === selectedId) ?? establishments[0];

  return (
    <div className="rh-map">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="rh-map__canvas" role="img" aria-label={t('explore.mapHint')}>
        <defs>
          <linearGradient id="rh-map-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary-soft)" />
            <stop offset="100%" stopColor="var(--surface-2)" />
          </linearGradient>
          <pattern id="rh-map-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M34 0H0V34" fill="none" stroke="var(--border)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={WIDTH} height={HEIGHT} rx="22" fill="url(#rh-map-bg)" />
        <rect width={WIDTH} height={HEIGHT} rx="22" fill="url(#rh-map-grid)" opacity="0.7" />
        <path
          d="M0 178 C 60 168, 96 196, 150 190 S 248 166, 300 182 S 334 196, 340 190"
          fill="none"
          stroke="var(--secondary)"
          strokeOpacity="0.35"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <text x={WIDTH - 16} y={HEIGHT - 14} textAnchor="end" className="rh-map__water">
          Golfe du Bénin
        </text>
        {points.map((point, index) => {
          const active = point.establishment.id === selected?.id;
          return (
            <g
              key={point.establishment.id}
              transform={`translate(${point.x} ${point.y})`}
              className={cx('rh-map__pin', active && 'rh-map__pin--active')}
              role="button"
              tabIndex={0}
              aria-label={point.establishment.brandName}
              onClick={() => setSelectedId(point.establishment.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedId(point.establishment.id);
                }
              }}
            >
              {active && <circle r="19" fill="var(--primary)" opacity="0.16" />}
              <circle r={active ? 11 : 9} fill="var(--primary)" stroke="var(--surface)" strokeWidth="2.5" />
              <text y="3.5" textAnchor="middle" className="rh-map__pin-label">
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>

      {selected && (
        <button
          type="button"
          className="rh-map__card"
          onClick={() => navigate(`/e/${selected.slug || selected.id}`)}
        >
          <div>
            <strong>{selected.brandName}</strong>
            <span>
              {t(`establishment.${kindKey(selected.kind)}`)} · {shortAddress(selected)}
            </span>
          </div>
          <span className={cx('rh-client-pill', isOpenNow(selected) ? 'rh-client-pill--success' : 'rh-client-pill--neutral')}>
            {isOpenNow(selected) ? t('common.open') : t('common.closed')}
          </span>
        </button>
      )}
      <p className="rh-map__hint">{t('explore.mapHint')}</p>
    </div>
  );
}
