import Link from "next/link";
import { Suspense } from "react";
import { ClaimCard } from "@/components/claim-card";
import { CorpusControls } from "@/components/corpus-controls";
import { SetupBanner } from "@/components/setup-banner";
import { browseCorpus, listCategories, searchCorpus } from "@/lib/claims";
import { checkDatabase } from "@/lib/db";
import { VERDICTS, type Verdict } from "@/lib/types";

export const metadata = { title: "Corpus" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export default async function CorpusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <div className="pt-10">
        <SetupBanner detail={health.detail} />
      </div>
    );
  }

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const verdictParam = typeof params.verdict === "string" ? params.verdict : "";
  const verdict = (VERDICTS as string[]).includes(verdictParam) ? (verdictParam as Verdict) : null;
  const category = typeof params.category === "string" ? params.category : null;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);

  const categories = await listCategories().catch(() => []);

  // Two different operations behind one page: a semantic search (vector KNN, ranked by
  // similarity) when there is a query, and a filtered relational browse otherwise.
  const searching = q.length >= 3;
  const [searchResults, browse] = await Promise.all([
    searching ? searchCorpus(q, 30) : Promise.resolve([]),
    searching
      ? Promise.resolve({ rows: [], total: 0 })
      : browseCorpus({
          verdict,
          category,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
  ]);

  // Filters still apply on top of a semantic search, done in memory because the result set is
  // capped at 30 rows -- not worth a second round trip.
  const results = searching
    ? searchResults.filter(
        (row) =>
          (!verdict || row.verdict === verdict) &&
          (!category || row.categories.includes(category)),
      )
    : browse.rows;

  const totalPages = searching ? 1 : Math.max(1, Math.ceil(browse.total / PAGE_SIZE));

  return (
    <div className="pt-10 sm:pt-14">
      <header>
        <p className="label-xs">The verified corpus</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {searching ? "Search results" : "Every claim with a verdict"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          {searching ? (
            <>
              Ranked by cosine similarity against your query &mdash; the same vector search the
              submission pipeline runs, without recording anything.
            </>
          ) : (
            <>
              These are the claims a submission can be matched against. Each one has a verdict, a
              source and a credibility score; a claim only enters this list once a fact-checker
              has ruled on it.
            </>
          )}
        </p>
      </header>

      <div className="mt-7">
        <Suspense fallback={<div className="panel h-48 animate-pulse" />}>
          <CorpusControls categories={categories} />
        </Suspense>
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-4">
        <p className="text-sm text-muted">
          {searching ? (
            <>
              <span className="nums text-ink">{results.length}</span> closest match
              {results.length === 1 ? "" : "es"}
            </>
          ) : (
            <>
              <span className="nums text-ink">{browse.total.toLocaleString()}</span> claim
              {browse.total === 1 ? "" : "s"}
              {(verdict || category) && " matching these filters"}
            </>
          )}
        </p>
        {!searching && totalPages > 1 && (
          <p className="nums text-xs text-muted">
            page {page} of {totalPages.toLocaleString()}
          </p>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState searching={searching} />
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((claim, index) => (
            <li key={claim.claimId} className="flex">
              <div className="flex-1">
                <ClaimCard claim={claim} rank={searching ? index + 1 : undefined} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!searching && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} params={params} />
      )}
    </div>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="panel mt-4 p-10 text-center">
      <p className="text-sm text-ink-soft">
        {searching
          ? "Nothing in the corpus is close to that."
          : "No claims match these filters."}
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
        {searching
          ? "That is the useful answer, not a failure -- it means a submission like this would go to a fact-checker rather than be answered from stale work."
          : "Try widening the verdict or topic filter. If the corpus is empty, run `npm run db:setup`."}
      </p>
      <Link
        href="/corpus"
        className="mt-4 inline-block rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
      >
        Reset filters
      </Link>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return query ? `/corpus?${query}` : "/corpus";
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
        >
          Previous
        </Link>
      ) : (
        <span className="rounded-lg border border-line/50 px-3 py-2 text-sm text-muted/50">
          Previous
        </span>
      )}
      <span className="nums px-3 text-xs text-muted">
        {page} / {totalPages.toLocaleString()}
      </span>
      {page < totalPages ? (
        <Link
          href={href(page + 1)}
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
        >
          Next
        </Link>
      ) : (
        <span className="rounded-lg border border-line/50 px-3 py-2 text-sm text-muted/50">Next</span>
      )}
    </nav>
  );
}
