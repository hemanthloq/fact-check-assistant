import Link from "next/link";
import { notFound } from "next/navigation";
import { CredibilityBar, SimilarityRing } from "@/components/meters";
import { SetupBanner } from "@/components/setup-banner";
import { VerdictBadge, VerdictHeadline } from "@/components/verdict";
import { getClaim } from "@/lib/claims";
import { checkDatabase } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { ClaimStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_META: Record<ClaimStatus, { label: string; tone: string; blurb: string }> = {
  reviewed: {
    label: "In the corpus",
    tone: "var(--color-verdict-true)",
    blurb: "Has a verdict, and can now answer future submissions.",
  },
  pending: {
    label: "Awaiting review",
    tone: "var(--color-verdict-mixed)",
    blurb: "Nothing in the corpus was close enough, so a fact-checker will rule on it.",
  },
  matched: {
    label: "Answered from the corpus",
    tone: "var(--color-brand-bright)",
    blurb: "A stored claim was close enough to answer this one. No human review was needed.",
  },
  rejected: {
    label: "Rejected",
    tone: "var(--color-muted)",
    blurb: "Not a checkable factual claim, so it was kept out of the corpus.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await getClaim(Number.parseInt(id, 10)).catch(() => null);
  return { title: claim ? `Claim #${claim.id}` : "Claim" };
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <div className="pt-10">
        <SetupBanner detail={health.detail} />
      </div>
    );
  }

  const { id } = await params;
  const claimId = Number.parseInt(id, 10);
  if (!Number.isFinite(claimId)) notFound();

  const [claim, session] = await Promise.all([getClaim(claimId), getSession()]);
  if (!claim) notFound();

  const status = STATUS_META[claim.status];
  const current = claim.history[0] ?? null;
  const canReview =
    claim.status === "pending" && (session?.role === "fact_checker" || session?.role === "admin");

  return (
    <div className="pt-10 sm:pt-14">
      <Link
        href="/corpus"
        className="text-sm text-muted transition-colors hover:text-ink-soft"
      >
        &larr; Corpus
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <article className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
                style={{ color: status.tone, borderColor: `${status.tone}55` }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: status.tone }}
                  aria-hidden
                />
                {status.label}
              </span>
              <span className="nums text-xs text-muted">claim #{claim.id}</span>
              {claim.origin !== "user" && (
                <span className="rounded-full border border-line px-2 py-0.5 text-[0.65rem] text-muted">
                  {claim.origin === "liar" ? "LIAR dataset" : "seed data"}
                </span>
              )}
            </div>

            <h1 className="mt-4 text-xl leading-relaxed font-medium text-balance sm:text-[1.4rem]">
              {claim.text}
            </h1>

            <p className="mt-3 text-xs text-muted">{status.blurb}</p>

            {claim.categories.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {claim.categories.map((category) => (
                  <Link
                    key={category}
                    href={`/corpus?category=${encodeURIComponent(category)}`}
                    className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
                  >
                    {category}
                  </Link>
                ))}
              </div>
            )}
          </article>

          {current && (
            <section className="panel p-5 sm:p-6">
              <h2 className="label-xs">Current verdict</h2>
              <div className="mt-4">
                <VerdictHeadline verdict={current.verdict} />
              </div>
              {current.explanation && (
                <p className="mt-5 text-sm leading-relaxed text-ink-soft">{current.explanation}</p>
              )}
              <dl className="mt-5 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="label-xs">Source</dt>
                  <dd className="mt-1">
                    {current.source_url ? (
                      <a
                        href={current.source_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-brand-bright underline decoration-brand/40 underline-offset-4"
                      >
                        {current.source_name ?? "link"} &#8599;
                      </a>
                    ) : (
                      <span className="text-ink-soft">{current.source_name ?? "Not cited"}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="label-xs">Reviewer</dt>
                  <dd className="mt-1 text-ink-soft">{current.reviewer_name ?? "--"}</dd>
                </div>
                <div>
                  <dt className="label-xs">Reviewed</dt>
                  <dd className="mt-1 text-ink-soft">
                    {new Date(current.reviewed_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {claim.history.length > 1 && (
            <section className="panel p-5 sm:p-6">
              <h2 className="label-xs">Verdict history</h2>
              <p className="mt-1.5 text-xs text-muted">
                Every ruling stays on the record. The newest one is what the corpus serves.
              </p>
              <ol className="mt-4 space-y-4">
                {claim.history.map((entry, index) => (
                  <li key={entry.id} className="flex gap-3.5">
                    <span className="relative mt-1.5 flex flex-col items-center">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          index === 0 ? "bg-brand-bright" : "bg-line-bright"
                        }`}
                      />
                      {index < claim.history.length - 1 && (
                        <span className="mt-1 h-full w-px flex-1 bg-line" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <VerdictBadge verdict={entry.verdict} />
                        {index === 0 && (
                          <span className="text-[0.65rem] text-brand-bright">current</span>
                        )}
                        <span className="nums ml-auto text-[0.7rem] text-muted">
                          {new Date(entry.reviewed_at).toLocaleDateString()}
                        </span>
                      </div>
                      {entry.explanation && (
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                          {entry.explanation}
                        </p>
                      )}
                      <p className="mt-1 text-[0.7rem] text-muted">
                        {entry.reviewer_name ?? "unknown reviewer"}
                        {entry.source_name && ` - ${entry.source_name}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {claim.status === "rejected" && claim.reviewNote && (
            <section className="panel p-5">
              <h2 className="label-xs">Why this was rejected</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{claim.reviewNote}</p>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {claim.status === "matched" && claim.matchedClaimId && (
            <div className="panel p-5">
              <h2 className="label-xs">Matched against</h2>
              <div className="mt-3 flex justify-center">
                <SimilarityRing value={claim.matchSimilarity ?? 0} size={104} />
              </div>
              <Link
                href={`/claims/${claim.matchedClaimId}`}
                className="mt-4 block rounded-lg border border-line px-3 py-2 text-center text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
              >
                Claim #{claim.matchedClaimId}
              </Link>
              <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">
                This submission was answered from that claim&rsquo;s verdict. It was logged, but
                deliberately kept out of the searchable corpus &mdash; a duplicate must never
                become a second, verdict-less answer to a later query.
              </p>
            </div>
          )}

          {current && (
            <div className="panel p-5">
              <h2 className="label-xs">Credibility</h2>
              <div className="mt-3">
                <CredibilityBar
                  score={claim.credibilityScore}
                  showBreakdown
                  sourceName={current.source_name}
                  sourceReliability={
                    current.source_reliability === null ? null : Number(current.source_reliability)
                  }
                  reviewedAt={current.reviewed_at}
                />
              </div>
              <p className="mt-4 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-muted">
                Computed in the database by <code className="text-ink-soft">fn_credibility_score</code>
                , rewritten automatically whenever a verdict is filed or a source&rsquo;s
                reliability is edited.
              </p>
            </div>
          )}

          <div className="panel p-5">
            <h2 className="label-xs">Record</h2>
            <dl className="mt-3 space-y-3 text-xs">
              <Row label="Submitted" value={new Date(claim.submittedAt).toLocaleString()} />
              <Row label="By" value={claim.submittedByName ?? "anonymous"} />
              {claim.assignedToName && <Row label="Assigned to" value={claim.assignedToName} />}
              {claim.reviewedAt && (
                <Row label="Reviewed" value={new Date(claim.reviewedAt).toLocaleString()} />
              )}
            </dl>
          </div>

          {canReview && (
            <Link
              href={`/review/${claim.id}`}
              className="block rounded-lg bg-gradient-to-r from-brand to-cyan px-3 py-2.5 text-center text-sm font-medium text-void transition-all hover:brightness-110"
            >
              Review this claim
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink-soft" title={value}>
        {value}
      </dd>
    </div>
  );
}
