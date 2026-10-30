"use client";

import Link from "next/link";
import type { CorpusMatch, SubmissionResult } from "@/lib/types";
import { CredibilityBar, SimilarityRing } from "./meters";
import { VerdictHeadline, VerdictBadge } from "./verdict";

export function ResultPanel({ result }: { result: SubmissionResult }) {
  const matched = result.outcome === "matched" || result.outcome === "matched_lexical";
  return (
    <div className="animate-rise space-y-4">
      {matched && result.match ? (
        <MatchedResult result={result} match={result.match} />
      ) : (
        <QueuedResult result={result} />
      )}

      {result.nearMatches.length > 0 && (
        <NearMatches matches={result.nearMatches} answered={matched} />
      )}
    </div>
  );
}

function MatchedResult({ result, match }: { result: SubmissionResult; match: CorpusMatch }) {
  const lexical = result.outcome === "matched_lexical";

  return (
    <article className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2/60 px-5 py-3">
        <span className="size-1.5 rounded-full bg-verdict-true" aria-hidden />
        <h2 className="text-sm font-medium">Already fact-checked</h2>
        <span className="ml-auto text-xs text-muted">
          {lexical ? "found via full-text, confirmed semantically" : "matched semantically"}
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <VerdictHeadline verdict={match.verdict} />
          <SimilarityRing value={match.similarity ?? 0} threshold={result.threshold} />
        </div>

        <div className="mt-6 panel-flat bg-panel-2/40 p-4">
          <p className="label-xs">The claim we matched</p>
          <p
            className="headline-markup mt-2 text-[0.95rem] leading-relaxed text-ink"
            dangerouslySetInnerHTML={{ __html: renderHeadline(match.headline, match.claimText) }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {match.categories.map((category) => (
              <span
                key={category}
                className="rounded-full border border-line px-2 py-0.5 text-[0.7rem] text-ink-soft"
              >
                {category}
              </span>
            ))}
          </div>
        </div>

        {match.explanation && (
          <div className="mt-5">
            <p className="label-xs">Why</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{match.explanation}</p>
          </div>
        )}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <CredibilityBar
            score={match.credibilityScore}
            showBreakdown
            sourceName={match.sourceName}
            sourceReliability={match.sourceReliability ?? null}
            reviewedAt={match.reviewedAt}
          />
          <div className="text-sm">
            <p className="label-xs">Source</p>
            {match.sourceUrl ? (
              <a
                href={match.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-2 inline-flex items-center gap-1.5 text-brand-bright underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
              >
                {match.sourceName ?? new URL(match.sourceUrl).hostname}
                <span aria-hidden>&#8599;</span>
              </a>
            ) : (
              <p className="mt-2 text-ink-soft">{match.sourceName ?? "Not cited"}</p>
            )}
            <p className="mt-3 text-xs text-muted">
              Reviewed {new Date(match.reviewedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Link
            href={`/claims/${match.claimId}`}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
          >
            Full record &amp; verdict history
          </Link>
          <p className="text-xs text-muted">
            No fact-checker was needed: this verdict already existed in the corpus.
          </p>
        </div>
      </div>
    </article>
  );
}

function QueuedResult({ result }: { result: SubmissionResult }) {
  const duplicate = result.outcome === "already_queued";

  return (
    <article className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2/60 px-5 py-3">
        <span className="size-1.5 rounded-full bg-verdict-mixed" aria-hidden />
        <h2 className="text-sm font-medium">
          {duplicate ? "Already in the review queue" : "Sent for human review"}
        </h2>
        <span className="ml-auto text-xs text-muted">no close match in the corpus</span>
      </div>

      <div className="p-5 sm:p-6">
        <p className="text-[0.95rem] leading-relaxed text-ink-soft">
          {duplicate ? (
            <>
              Somebody submitted this exact claim before you, so it was joined to the existing
              queue item rather than duplicated. One review will answer both of you.
            </>
          ) : (
            <>
              Nothing in the corpus of{" "}
              <span className="nums text-ink">{result.corpusSize.toLocaleString()}</span> verified
              claims came within{" "}
              <span className="nums text-ink">{(result.threshold * 100).toFixed(0)}%</span> of this
              one, so the system did not guess. A fact-checker will rule on it, and once they do
              it joins the corpus &mdash; the next person to ask gets an instant answer.
            </>
          )}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="panel-flat bg-panel-2/40 p-3">
            <dt className="label-xs">Claim</dt>
            <dd className="nums mt-1 text-lg">#{result.claimId}</dd>
          </div>
          <div className="panel-flat bg-panel-2/40 p-3">
            <dt className="label-xs">Queue position</dt>
            <dd className="nums mt-1 text-lg">
              {result.queuePosition === null ? "--" : result.queuePosition}
            </dd>
          </div>
          <div className="panel-flat bg-panel-2/40 p-3">
            <dt className="label-xs">Status</dt>
            <dd className="mt-1 text-lg">
              <span className="rounded-full border border-verdict-mixed/30 bg-verdict-mixed/10 px-2 py-0.5 text-sm text-verdict-mixed">
                pending
              </span>
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-line pt-4">
          <Link
            href={`/claims/${result.claimId}`}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
          >
            Track this claim
          </Link>
        </div>
      </div>
    </article>
  );
}

function NearMatches({ matches, answered }: { matches: CorpusMatch[]; answered: boolean }) {
  return (
    <section className="panel p-5">
      <h3 className="text-sm font-medium">
        {answered ? "Related verdicts" : "Related, but not close enough to rule on"}
      </h3>
      <p className="mt-1 text-xs text-muted">
        {answered
          ? "Other corpus claims near this one in vector space."
          : "These share ground with your claim but fell under the match threshold, so their verdicts were not applied to it."}
      </p>

      <ul className="mt-4 divide-y divide-line">
        {matches.map((match) => (
          <li key={match.claimId} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <Link
                href={`/claims/${match.claimId}`}
                className="block text-sm leading-relaxed text-ink-soft transition-colors hover:text-ink"
              >
                {match.claimText}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={match.verdict} />
                <span className="nums text-[0.7rem] text-muted">
                  {((match.similarity ?? 0) * 100).toFixed(1)}% similar
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turns a ts_headline result into safe markup.
 *
 * fn_search_claims_fts asks Postgres for alphanumeric sentinels rather than raw <mark>,
 * precisely so this step can escape the entire string first -- claim text is user-submitted,
 * and ts_headline passes it through verbatim. Only after escaping are the sentinels swapped
 * for real tags, so the sole markup that can reach the DOM is <mark>.
 */
function renderHeadline(headline: string | null | undefined, fallback: string): string {
  if (!headline) return escapeHtml(fallback);
  return escapeHtml(headline)
    .replace(/FCAMARKSTART/g, "<mark>")
    .replace(/FCAMARKEND/g, "</mark>");
}
