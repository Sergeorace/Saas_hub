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
          <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F97316" />
            <stop offset="1" stopColor="#B23A0F" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill={`url(#${gradientId})`} />
        <path
          d="M13 11v18M27 11v18"
          stroke="#FFF7ED"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="20" cy="20" r="6.5" fill="none" stroke="#FFF7ED" strokeWidth="2.6" />
        <circle cx="20" cy="20" r="1.8" fill="#FDBA74" />
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
