/** LendLoop mark: two interlocking chain links (lend and return) on a blue tile, plus the wordmark. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ll-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ll-g)" />
      <g fill="none" strokeWidth="2.6" strokeLinecap="round">
        <rect
          x="-8.2"
          y="-4.6"
          width="16.4"
          height="9.2"
          rx="4.6"
          stroke="#bfdbfe"
          strokeOpacity="0.75"
          transform="translate(19.9 12.1) rotate(-45)"
        />
        <rect
          x="-8.2"
          y="-4.6"
          width="16.4"
          height="9.2"
          rx="4.6"
          stroke="#fff"
          transform="translate(12.1 19.9) rotate(-45)"
        />
      </g>
    </svg>
  );
}

export default function Logo() {
  return (
    <span className="brand">
      <LogoMark />
      <span>
        Lend<b>Loop</b>
      </span>
    </span>
  );
}
