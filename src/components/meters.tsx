import { MATCH_THRESHOLD } from "@/lib/thresholds";

/**
 * Similarity ring.
 *
 * Shows the cosine similarity AND the threshold it had to beat, as a tick on the arc. A bare
 * "87%" tells a reader nothing about whether that was enough; the tick is what makes the
 * number mean "this cleared the bar" or "this fell short".
 */
export function SimilarityRing({
  value,
  size = 112,
  threshold = MATCH_THRESHOLD,
  label = "similarity",
}: {
  value: number;
  size?: number;
  threshold?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = size >= 96 ? 8 : 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Three-quarter arc starting at the lower left, so the gauge reads left-to-right.
  const arc = 0.75;
  const cleared = clamped >= threshold;
  const colour = cleared ? "var(--color-verdict-true)" : "var(--color-verdict-mixed)";

  // Tick position along the same arc.
  const tickAngle = 135 + threshold * arc * 360;
  const tickRad = (tickAngle * Math.PI) / 180;
  const centre = size / 2;
  const inner = radius - stroke / 2 - 1;
  const outer = radius + stroke / 2 + 1;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${(clamped * 100).toFixed(1)} percent, threshold ${(threshold * 100).toFixed(0)} percent`}
      >
        <g transform={`rotate(135 ${centre} ${centre})`}>
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            stroke="var(--color-raised)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * arc} ${circumference}`}
          />
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * arc * clamped} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }}
          />
        </g>
        <line
          x1={centre + inner * Math.cos(tickRad)}
          y1={centre + inner * Math.sin(tickRad)}
          x2={centre + outer * Math.cos(tickRad)}
          y2={centre + outer * Math.sin(tickRad)}
          stroke="var(--color-ink)"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.55}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="nums text-xl font-semibold tabular-nums"
          style={{ color: colour, fontSize: size >= 96 ? "1.4rem" : "1.05rem" }}
        >
          {(clamped * 100).toFixed(0)}
          <span className="text-sm opacity-60">%</span>
        </span>
        <span className="label-xs mt-0.5" style={{ fontSize: "0.6rem" }}>
          {label}
        </span>
      </div>
    </div>
  );
}

/** Horizontal bar for the credibility score, with its three components named underneath. */
export function CredibilityBar({
  score,
  showBreakdown = false,
  sourceName,
  sourceReliability,
  reviewedAt,
}: {
  score: number | null;
  showBreakdown?: boolean;
  sourceName?: string | null;
  sourceReliability?: number | null;
  reviewedAt?: string | null;
}) {
  if (score === null || score === undefined) {
    return <p className="text-sm text-muted">Not scored yet.</p>;
  }
  const pct = Math.max(0, Math.min(1, score)) * 100;
  const tone =
    score >= 0.75
      ? "var(--color-verdict-true)"
      : score >= 0.5
        ? "var(--color-verdict-mixed)"
        : "var(--color-verdict-false)";

  const ageDays = reviewedAt
    ? Math.max(0, Math.round((Date.now() - new Date(reviewedAt).getTime()) / 86_400_000))
    : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs">Verdict confidence</span>
        <span className="nums text-sm font-semibold" style={{ color: tone }}>
          {score.toFixed(3)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${tone}99, ${tone})`,
            transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </div>
      {showBreakdown && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted">Source 50%</dt>
            <dd className="nums mt-0.5 text-ink-soft">
              {sourceReliability !== null && sourceReliability !== undefined
                ? sourceReliability.toFixed(2)
                : "0.50"}
            </dd>
            <dd className="mt-0.5 truncate text-[0.65rem] text-muted" title={sourceName ?? ""}>
              {sourceName ?? "uncited"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Recency 30%</dt>
            <dd className="nums mt-0.5 text-ink-soft">
              {ageDays === null ? "--" : `${Math.exp(-0.00094946 * ageDays).toFixed(2)}`}
            </dd>
            <dd className="mt-0.5 text-[0.65rem] text-muted">
              {ageDays === null ? "unknown" : `${ageDays}d old`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Certainty 20%</dt>
            <dd className="nums mt-0.5 text-ink-soft">by verdict</dd>
            <dd className="mt-0.5 text-[0.65rem] text-muted">hedged rungs score lower</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** Small inline bar used in dense lists where a ring would be too heavy. */
export function MiniBar({ value, tone }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" title={`${pct.toFixed(1)}%`}>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: tone ?? "var(--color-brand)" }}
      />
    </div>
  );
}
