/**
 * Wordmark. The glyph is a magnifier whose lens is split into a filled and an empty half --
 * the matched / unmatched branch the whole product turns on.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="fca-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-bright)" />
          <stop offset="100%" stopColor="var(--color-cyan)" />
        </linearGradient>
      </defs>
      <circle cx="13.5" cy="13.5" r="9" fill="none" stroke="url(#fca-brand)" strokeWidth="2.25" />
      <path d="M13.5 4.5a9 9 0 0 1 0 18z" fill="url(#fca-brand)" opacity="0.28" />
      <path
        d="M9.75 13.75l2.75 2.75 5.25-5.5"
        fill="none"
        stroke="url(#fca-brand)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.25 20.25L27 27"
        stroke="url(#fca-brand)"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-[0.95rem] leading-none font-semibold tracking-tight">
        Fact&#8209;Check
        <span className="ml-1 font-normal text-ink-soft">Assistant</span>
      </span>
    </span>
  );
}
