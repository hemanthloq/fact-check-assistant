import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClaimCard } from "@/components/claim-card";
import { SetupBanner } from "@/components/setup-banner";
import { VerdictForm } from "@/components/verdict-form";
import { requireRole } from "@/lib/auth";
import { getClaim, listCategories, searchCorpus } from "@/lib/claims";
import { checkDatabase } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { MATCH_THRESHOLD } from "@/lib/thresholds";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review claim" };

export default async function ReviewClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <div className="pt-10">
        <SetupBanner detail={health.detail} />
      </div>
    );
  }

  await requireRole("fact_checker", "admin");

  const { id } = await params;
  const claimId = Number.parseInt(id, 10);
  if (!Number.isFinite(claimId)) notFound();

  const claim = await getClaim(claimId);
  if (!claim) notFound();
  // Already ruled on (possibly by someone else while this page was open) -- send the reviewer
  // to the record rather than letting them file a second verdict by accident.
  if (claim.status !== "pending") redirect(`/claims/${claimId}`);

  const [neighbours, categories] = await Promise.all([
    searchCorpus(claim.text, 5).catch(() => []),
    listCategories().catch(() => []),
  ]);

  const closest = neighbours[0] ?? null;
  const nearMiss = closest && (closest.similarity ?? 0) >= MATCH_THRESHOLD - 0.12;

  return (
    <div className="pt-10 sm:pt-14">
      <Link href="/review" className="text-sm text-muted transition-colors hover:text-ink-soft">
        &larr; Review queue
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <article className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-2 rounded-full border border-verdict-mixed/30 bg-verdict-mixed/10 px-2.5 py-1 text-verdict-mixed">
                <span className="size-1.5 rounded-full bg-verdict-mixed" aria-hidden />
                pending
              </span>
              <span className="nums">#{claim.id}</span>
              <span>submitted {timeAgo(claim.submittedAt)}</span>
              <span>by {claim.submittedByName ?? "anonymous"}</span>
            </div>

            <h1 className="mt-4 text-xl leading-relaxed font-medium text-balance">{claim.text}</h1>
          </article>

          <VerdictForm
            claimId={claim.id}
            categories={categories}
            suggestedCategories={closest?.categories ?? []}
          />
        </div>

        <aside className="space-y-4">
          <div className="panel p-5">
            <h2 className="label-xs">Why this reached you</h2>
            {closest ? (
              <>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                  The closest claim in the corpus scored{" "}
                  <span
                    className="nums font-semibold"
                    style={{
                      color: nearMiss ? "var(--color-verdict-mixed)" : "var(--color-ink)",
                    }}
                  >
                    {((closest.similarity ?? 0) * 100).toFixed(1)}%
                  </span>
                  , under the {(MATCH_THRESHOLD * 100).toFixed(0)}% bar.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {nearMiss
                    ? "That is a near miss. Read the neighbour below first -- if it is genuinely the same claim, your ruling here will catch future rewordings of both."
                    : "Nothing in the corpus is close, so this is a genuinely new claim."}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                The corpus is empty, so everything reaches review.
              </p>
            )}
          </div>

          {neighbours.length > 0 && (
            <div>
              <h2 className="label-xs">Nearest verified claims</h2>
              <ul className="mt-2.5 space-y-2">
                {neighbours.map((neighbour) => (
                  <li key={neighbour.claimId}>
                    <ClaimCard claim={neighbour} />
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[0.7rem] leading-relaxed text-muted">
                If one of these is the same claim in different words, consider raising{" "}
                <code className="text-ink-soft">MATCH_THRESHOLD</code> &mdash; or re-running{" "}
                <code className="text-ink-soft">npm run calibrate</code> on your own corpus.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
