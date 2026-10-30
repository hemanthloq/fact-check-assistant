import { SetupBanner } from "@/components/setup-banner";
import { AdminCharts } from "@/components/admin-charts";
import { StatTile, HeroFigure } from "@/components/charts";
import { requireRole } from "@/lib/auth";
import { getAdminStats } from "@/lib/analytics";
import { checkDatabase } from "@/lib/db";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <div className="pt-10">
        <SetupBanner detail={health.detail} />
      </div>
    );
  }

  await requireRole("admin");
  const stats = await getAdminStats();
  const { totals } = stats;

  return (
    <div className="pt-10 sm:pt-14">
      <header>
        <p className="label-xs">Admin</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Every figure here is computed by the database &mdash; the four analytics views and the
          credibility function, not application code summing rows in memory.
        </p>
      </header>

      {/* The one number this project exists to move. */}
      <div className="mt-7">
        <HeroFigure
          label="Submissions answered without a human"
          value={totals.userSubmissions > 0 ? `${(totals.matchRate * 100).toFixed(0)}%` : "--"}
          note={
            totals.userSubmissions > 0
              ? `${totals.instantMatches.toLocaleString()} of ${totals.userSubmissions.toLocaleString()} reader submissions were answered from a verdict that already existed. The rest went to the review queue, and each ruling makes the next match more likely.`
              : "No reader submissions yet. Submit a claim on the home page and this starts filling in."
          }
          spark={stats.activity.map((day) => day.instant_matches)}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Verified corpus"
          value={totals.corpusSize.toLocaleString()}
          note="claims with a verdict, searchable"
        />
        <StatTile
          label="Awaiting review"
          value={totals.pending.toLocaleString()}
          note="no corpus claim was close enough"
          tone={totals.pending > 0 ? "var(--color-verdict-mixed)" : undefined}
        />
        <StatTile
          label="Mean verdict confidence"
          value={totals.avgCredibility === null ? "--" : totals.avgCredibility.toFixed(3)}
          note="source reliability, recency, certainty"
        />
        <StatTile
          label="Mean match similarity"
          value={
            totals.avgMatchSimilarity === null
              ? "--"
              : `${(totals.avgMatchSimilarity * 100).toFixed(1)}%`
          }
          note="across every instant answer given"
        />
      </div>

      <AdminCharts stats={stats} />

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <section className="panel p-5">
          <h3 className="text-sm font-medium">Fact-checkers</h3>
          <p className="mt-1 text-xs text-muted">
            From <code className="text-ink-soft">v_reviewer_workload</code>. Turnaround is the mean
            gap between a claim being submitted and its verdict being filed.
          </p>
          {stats.reviewers.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No fact-checkers yet.</p>
          ) : (
            <table className="mt-4 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 font-medium">
                    Reviewer
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Reviews
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    In queue
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Turnaround
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.reviewers.map((reviewer) => (
                  <tr key={reviewer.id} className="border-b border-line/50 last:border-0">
                    <td className="py-2">
                      <span className="block text-ink">{reviewer.display_name}</span>
                      <span className="block text-[0.65rem] text-muted">{reviewer.email}</span>
                    </td>
                    <td className="nums py-2 text-right text-ink-soft">
                      {reviewer.reviews_completed}
                    </td>
                    <td className="nums py-2 text-right text-ink-soft">
                      {reviewer.pending_assigned}
                    </td>
                    <td className="nums py-2 text-right text-ink-soft">
                      {reviewer.avg_turnaround_hours === null
                        ? "--"
                        : `${Number(reviewer.avg_turnaround_hours).toFixed(1)} h`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel p-5">
          <h3 className="text-sm font-medium">Sources</h3>
          <p className="mt-1 text-xs text-muted">
            Reliability is half of every credibility score. Editing one fires a trigger that
            re-scores every claim citing it.
          </p>
          {stats.sources.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No sources cited yet.</p>
          ) : (
            <table className="mt-4 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Reliability
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Citations
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.sources.map((source) => (
                  <tr key={source.id} className="border-b border-line/50 last:border-0">
                    <td className="py-2">
                      <span className="block text-ink">{source.name}</span>
                      <span className="block text-[0.65rem] text-muted">{source.domain}</span>
                    </td>
                    <td className="nums py-2 text-right text-ink-soft">
                      {Number(source.reliability).toFixed(2)}
                    </td>
                    <td className="nums py-2 text-right text-ink-soft">{source.citations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel mt-4 p-5">
        <h3 className="text-sm font-medium">Where these numbers come from</h3>
        <ul className="mt-3 grid gap-x-8 gap-y-2 text-xs text-ink-soft sm:grid-cols-2">
          <Source name="v_verified_claims" what="the corpus, each claim with its latest verdict" />
          <Source name="v_daily_activity" what="submissions per day, split by outcome" />
          <Source name="v_category_breakdown" what="verdict mix per topic" />
          <Source name="v_reviewer_workload" what="reviews, queue depth, turnaround" />
          <Source name="fn_credibility_score" what="the confidence figure, per claim" />
          <Source name="width_bucket()" what="the similarity histogram's bins" />
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[0.7rem] text-muted">
          Counts of {totals.factChecks.toLocaleString()} fact-checks across{" "}
          {totals.categories} categories and {totals.sources} sources, from {totals.users} accounts
          ({totals.factCheckers} fact-checkers).
        </p>
      </section>
    </div>
  );
}

function Source({ name, what }: { name: string; what: string }) {
  return (
    <li className="flex gap-2">
      <code className="shrink-0 text-brand-bright">{name}</code>
      <span className="text-muted">{what}</span>
    </li>
  );
}
