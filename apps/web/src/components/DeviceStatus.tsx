export function DeviceStatus({ className }: { className?: string }) {
  return (
    <span className={className}>
      <svg viewBox="0 0 18 12" width="14" height="10" aria-hidden="true" focusable="false">
        <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
        <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
        <rect x="15" y="0.5" width="3" height="11.5" rx="1" fill="currentColor" opacity="0.3" />
      </svg>
      <svg viewBox="0 0 24 18" width="15" height="11" aria-hidden="true" focusable="false">
        <path
          d="M12 15.4a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Zm0-6.8c2 0 3.8.8 5.2 2l-1.3 1.4a5.6 5.6 0 0 0-7.8 0l-1.3-1.4a7.3 7.3 0 0 1 5.2-2Zm0-5.2c3.4 0 6.4 1.3 8.7 3.4l-1.3 1.4A10.8 10.8 0 0 0 12 5.6 10.8 10.8 0 0 0 4.6 8.2L3.3 6.8A12.4 12.4 0 0 1 12 3.4Z"
          fill="currentColor"
        />
      </svg>
      <svg viewBox="0 0 26 12" width="21" height="10" aria-hidden="true" focusable="false">
        <rect
          x="0.75"
          y="0.75"
          width="21.5"
          height="10.5"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
        />
        <rect x="2.5" y="2.5" width="15" height="7" rx="1.6" fill="currentColor" />
        <rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}
