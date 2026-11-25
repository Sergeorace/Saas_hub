import { cx } from '@resto-hub/design-system';

function StarShape({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cx('rh-star', filled && 'rh-star--on')}>
      <path
        d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.5l6.1-.9z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const rounded = Math.round(value);
  return (
    <span className={cx('rh-stars', `rh-stars--${size}`)} aria-label={`${value.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <StarShape key={star} filled={star <= rounded} />
      ))}
    </span>
  );
}

export function StarRatingInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="rh-star-input" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={cx('rh-star-input__btn', star <= value && 'rh-star-input__btn--on')}
          aria-label={`${star} / 5`}
          aria-pressed={star <= value}
          onClick={() => onChange(star)}
        >
          <StarShape filled={star <= value} />
        </button>
      ))}
    </div>
  );
}

export function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="rh-heart">
      <path
        d="M12 20.5S3.5 15.2 3.5 9.4A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.5 2.7c0 5.8-8.5 11.1-8.5 11.1z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
