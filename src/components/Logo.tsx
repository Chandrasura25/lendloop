/** LendLoop mark: two chasing arrows in a loop on a blue tile, plus the wordmark. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ll-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ll-g)" />
      <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
        <path d="M9.1 14.8A7 7 0 0 1 18.4 9.4" />
        <path d="M22.9 17.2A7 7 0 0 1 13.6 22.6" />
      </g>
      <g fill="#fff">
        <path d="M21.2 10.4L17.6 11.7L19.2 7.1Z" />
        <path d="M10.8 21.6L14.4 20.3L12.8 24.9Z" />
      </g>
    </svg>
  );
}

export default function Logo() {
  return (
    <span className="brand">
      <LogoMark />
      LendLoop
    </span>
  );
}
