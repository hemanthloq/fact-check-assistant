import Link from "next/link";
import type { CorpusMatch } from "@/lib/types";
import { VerdictBadge } from "./verdict";
import { MiniBar } from "./meters";

/** One corpus claim in a list or grid. Used by the corpus browser and the search results. */
export function ClaimCard({ claim, rank }: { claim: CorpusMatch; rank?: number }) {
  return (
    <Link
      href={`/claims/${claim.claimId}`}
      className="panel group flex flex-col gap-3 p-4 transition-all hover:border-line-bright hover:bg-panel-2/50"
    >
      <div className="flex items-start gap-3">
        {rank !== undefined && (
          <span className="nums mt-0.5 shrink-0 text-xs text-muted">{rank}</span>
        )}
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-soft transition-colors group-hover:text-ink">
          {claim.claimText}
        </p>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={claim.verdict} />
        {claim.categories.slice(0, 2).map((category) => (
          <span
            key={category}
            className="rounded-full border border-line px-2 py-0.5 text-[0.65rem] text-muted"
          >
            {category}
          </span>
        ))}
        {claim.similarity !== null && (
          <span className="nums ml-auto text-[0.7rem] text-brand-bright">
            {(claim.similarity * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {claim.credibilityScore !== null && (
        <div className="flex items-center gap-2">
          <MiniBar
            value={claim.credibilityScore}
            tone={
              claim.credibilityScore >= 0.75
                ? "var(--color-verdict-true)"
                : claim.credibilityScore >= 0.5
                  ? "var(--color-verdict-mixed)"
                  : "var(--color-verdict-false)"
            }
          />
          <span className="nums shrink-0 text-[0.65rem] text-muted">
            {claim.credibilityScore.toFixed(2)}
          </span>
        </div>
      )}
    </Link>
  );
}
