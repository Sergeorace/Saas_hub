import { useId } from 'react';
import { cx } from '../lib/cx';

export interface LogoProps {
  withWordmark?: boolean;
  tag?: string;
  inverse?: boolean;
  className?: string;
  size?: number;
}

export function Logo({ withWordmark = true, tag, inverse, className, size = 34 }: LogoProps) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <span
      className={cx('rh-logo', inverse && 'rh-logo--inverse', className)}
      aria-label="RESTO-HUB"
      role="img"
    >
      <svg
        className="rh-logo__mark"
        style={{ width: size, height: size }}
        viewBox="0 0 40 40"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="40"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#175732" />
            <stop offset="1" stopColor="#0B5343" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill={`url(#${gradientId})`} />
        <rect
          x="1"
          y="1"
          width="38"
          height="38"
          rx="11"
          fill="none"
          stroke="#FFF7ED"
          strokeOpacity="0.14"
        />
        <path
          d="M11 23a9 9 0 0 1 18 0"
          fill="none"
          stroke="#FFF7ED"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M8.5 23h23" stroke="#FFF7ED" strokeWidth="3" strokeLinecap="round" />
        <circle cx="20" cy="13" r="3" fill="#F2CD6B" />
        <circle cx="20" cy="13" r="1.3" fill="#F97316" />
      </svg>
      {withWordmark && (
        <span className="rh-logo__word" aria-hidden="true">
          resto<span className="rh-logo__dot">·</span>hub
        </span>
      )}
      {tag && (
        <span className="rh-logo__tag" aria-hidden="true">
          {tag}
        </span>
      )}
    </span>
  );
}
