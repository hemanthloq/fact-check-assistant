import { VERDICT_META, type Verdict } from "@/lib/types";

const TONE_CLASSES = {
  true: {
    text: "text-verdict-true",
    bg: "bg-verdict-true/10",
    border: "border-verdict-true/30",
    dot: "bg-verdict-true",
    glow: "shadow-[0_0_28px_-8px_var(--color-verdict-true)]",
  },
  mixed: {
    text: "text-verdict-mixed",
    bg: "bg-verdict-mixed/10",
    border: "border-verdict-mixed/30",
    dot: "bg-verdict-mixed",
    glow: "shadow-[0_0_28px_-8px_var(--color-verdict-mixed)]",
  },
  false: {
    text: "text-verdict-false",
    bg: "bg-verdict-false/10",
    border: "border-verdict-false/30",
    dot: "bg-verdict-false",
    glow: "shadow-[0_0_28px_-8px_var(--color-verdict-false)]",
  },
} as const;

export function verdictTone(verdict: Verdict) {
  return TONE_CLASSES[VERDICT_META[verdict].tone];
}

/** Compact inline verdict label, for lists and tables. */
export function VerdictBadge({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const meta = VERDICT_META[verdict];
  const tone = verdictTone(verdict);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.bg} ${tone.border} ${tone.text} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * The headline verdict on a result. Deliberately large: it is the one thing a reader came for,
 * and the blurb under it keeps "Half True" from being read as a hedge-free answer.
 */
export function VerdictHeadline({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  const tone = verdictTone(verdict);
  return (
    <div className="flex items-start gap-4">
      <span
        className={`mt-1.5 size-3 shrink-0 rounded-full ${tone.dot} ${tone.glow}`}
        aria-hidden
      />
      <div className="min-w-0">
        <div className={`text-2xl leading-none font-semibold tracking-tight sm:text-3xl ${tone.text}`}>
          {meta.label}
        </div>
        <p className="mt-2 text-sm text-ink-soft">{meta.blurb}</p>
      </div>
    </div>
  );
}
