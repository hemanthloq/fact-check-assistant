import Link from "next/link";
import { SetupBanner } from "@/components/setup-banner";
import { requireRole } from "@/lib/auth";
import { listQueue } from "@/lib/claims";
import { checkDatabase, queryOne } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { MATCH_THRESHOLD } from "@/lib/thresholds";

export const metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <div className="pt-10">
        <SetupBanner detail={health.detail} />
      </div>
    );
  }

  const session = await requireRole("fact_checker", "admin");
  const [queue, counts] = await Promise.all([
    listQueue(60),
    queryOne<{ mine: number; total: number; corpus: number }>(
      `SELECT count(*) FILTER (WHERE assigned_to = $1)::INT AS mine,
              count(*)::INT                                AS total,
              (SELECT count(*)::INT FROM claims WHERE status = 'reviewed') AS corpus
       FROM claims WHERE status = 'pending'`,
      [session.id],
    ),
  ]);

  const mine = queue.filter((item) => item.assignedTo === session.displayName);
  const others = queue.filter((item) => item.assignedTo !== session.displayName);

  return (
    <div className="pt-10 sm:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-xs">Fact-checker</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Review queue</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Only claims the corpus could not answer reach this page. Each one shows its closest
            stored neighbour, so you can see whether the matcher found nothing at all or stopped
            just short of the {(MATCH_THRESHOLD * 100).toFixed(0)}% bar.
          </p>
        </div>
        <dl className="flex gap-6">
          <div>
            <dt className="label-xs">Assigned to you</dt>
            <dd className="nums mt-1 text-2xl font-semibold text-brand-bright">
              {counts?.mine ?? 0}
            </dd>
          </div>
          <div>
            <dt className="label-xs">Queue total</dt>
            <dd className="nums mt-1 text-2xl font-semibold">{counts?.total ?? 0}</dd>
          </div>
          <div>
            <dt className="label-xs">In corpus</dt>
            <dd className="nums mt-1 text-2xl font-semibold text-verdict-true">
              {(counts?.corpus ?? 0).toLocaleString()}
            </dd>
          </div>
        </dl>
      </header>

      {queue.length === 0 ? (
        <div className="panel mt-8 p-12 text-center">
          <p className="text-sm text-ink-soft">The queue is empty.</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted">
            Every submission so far was answered from the corpus. That is the system working as
            intended &mdash; the queue only fills when somebody submits a claim nobody has
            checked before.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {mine.length > 0 && <QueueSection title="Yours" items={mine} />}
          {others.length > 0 && (
            <QueueSection
              title={mine.length > 0 ? "Everyone else's" : "Unclaimed and others'"}
              items={others}
              dim
            />
          )}
        </div>
      )}
    </div>
  );
}

function QueueSection({
  title,
  items,
  dim = false,
}: {
  title: string;
  items: Awaited<ReturnType<typeof listQueue>>;
  dim?: boolean;
}) {
  return (
    <section>
      <h2 className="label-xs">
        {title} <span className="nums ml-1 text-ink-soft">{items.length}</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const similarity = item.topNeighbourSimilarity ?? 0;
          const nearMiss = similarity >= MATCH_THRESHOLD - 0.12;
          return (
            <li key={item.id}>
              <Link
                href={`/review/${item.id}`}
                className={`panel group flex flex-col gap-3 p-4 transition-all hover:border-line-bright hover:bg-panel-2/50 sm:flex-row sm:items-center ${
                  dim ? "opacity-70 hover:opacity-100" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-ink-soft transition-colors group-hover:text-ink">
                    {item.text}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted">
                    <span className="nums">#{item.id}</span>
                    <span>{timeAgo(item.submittedAt)}</span>
                    <span>by {item.submittedBy ?? "anonymous"}</span>
                    {item.assignedTo && <span>&rarr; {item.assignedTo}</span>}
                  </div>
                </div>

                <div className="shrink-0 sm:w-56">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="label-xs" style={{ fontSize: "0.6rem" }}>
                      closest in corpus
                    </span>
                    <span
                      className="nums text-xs font-semibold"
                      style={{
                        color: nearMiss ? "var(--color-verdict-mixed)" : "var(--color-muted)",
                      }}
                    >
                      {(similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(1, similarity)) * 100}%`,
                        background: nearMiss
                          ? "var(--color-verdict-mixed)"
                          : "var(--color-line-bright)",
                      }}
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[0.65rem] leading-snug text-muted">
                    {nearMiss ? "near miss: " : ""}
                    {item.topNeighbourText ?? "nothing comparable in the corpus"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
