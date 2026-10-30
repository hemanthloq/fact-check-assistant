import Link from "next/link";
import { ClaimForm, type DemoPrompt } from "@/components/claim-form";
import { SetupBanner } from "@/components/setup-banner";
import { getPublicStats } from "@/lib/analytics";
import { checkDatabase, query } from "@/lib/db";
import { MATCH_THRESHOLD } from "@/lib/thresholds";

// Counts change on every submission, so nothing here should be cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const health = await checkDatabase();

  let stats = { corpusSize: 0, pending: 0, instantMatches: 0, matchRate: 0 };
  let examples: DemoPrompt[] = [];

  if (health.ok) {
    [stats, examples] = await Promise.all([
      getPublicStats(),
      // Deliberately a mix: three rewordings of corpus claims and one genuinely new claim,
      // so the chips demonstrate BOTH branches of the pipeline. Ordering by kind alone put
      // every paraphrase first and the novel ones never survived the LIMIT.
      query<DemoPrompt>(
        `(SELECT id, prompt, kind FROM demo_prompts WHERE kind = 'paraphrase'
            ORDER BY random() LIMIT 3)
         UNION ALL
         (SELECT id, prompt, kind FROM demo_prompts WHERE kind = 'novel'
            ORDER BY random() LIMIT 1)`,
      ).catch(() => []),
    ]);
  }

  return (
    <div className="pt-10 sm:pt-16">
      {!health.ok && <SetupBanner detail={health.detail} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="min-w-0">
          <section>
            <p className="label-xs">Semantic fact-check matching</p>
            <h1 className="mt-3 max-w-2xl text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-4xl md:text-[2.75rem]">
              Has this claim{" "}
              <span className="bg-gradient-to-r from-brand-bright to-cyan bg-clip-text text-transparent">
                already been debunked
              </span>
              ?
            </h1>
            <p className="mt-4 max-w-xl text-[0.975rem] leading-relaxed text-ink-soft">
              Debunked claims keep circulating in new wording, and keyword search misses them.
              This checks your claim against{" "}
              <span className="nums text-ink">{stats.corpusSize.toLocaleString()}</span> already-verified
              claims by meaning. If one matches, you get its verdict immediately. If none does,
              a human fact-checker rules on it &mdash; and the answer joins the corpus.
            </p>
          </section>

          <section className="mt-8">
            <ClaimForm examples={examples} />
          </section>

          <HowItWorks />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="panel p-5">
            <h2 className="label-xs">Corpus right now</h2>
            <dl className="mt-4 space-y-4">
              <Stat
                label="Verified claims"
                value={stats.corpusSize.toLocaleString()}
                note="searchable, each with a verdict"
              />
              <div className="hairline" />
              <Stat
                label="Answered instantly"
                value={stats.instantMatches.toLocaleString()}
                note={
                  stats.instantMatches > 0
                    ? `${(stats.matchRate * 100).toFixed(0)}% of submissions, no human needed`
                    : "no submissions yet"
                }
                tone="var(--color-verdict-true)"
              />
              <div className="hairline" />
              <Stat
                label="Awaiting review"
                value={stats.pending.toLocaleString()}
                note="nothing in the corpus could answer these"
                tone="var(--color-verdict-mixed)"
              />
            </dl>
            <Link
              href="/corpus"
              className="mt-5 block rounded-lg border border-line px-3 py-2 text-center text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
            >
              Browse the corpus
            </Link>
          </div>

          <div className="panel p-5">
            <h2 className="label-xs">Match threshold</h2>
            <p className="nums mt-3 text-3xl font-semibold text-ink">
              {MATCH_THRESHOLD.toFixed(2)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Cosine similarity a stored claim must reach before its verdict is reused. Measured,
              not guessed: it sits a margin above the closest <em>wrong</em> match found in a
              400-claim calibration run.
            </p>
            <p className="mt-3 text-[0.7rem] text-muted">
              Under the bar, nothing is asserted &mdash; the claim goes to a person.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="nums mt-1 text-2xl font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
      <dd className="mt-0.5 text-[0.7rem] leading-snug text-muted">{note}</dd>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Embed the claim",
    body: "all-MiniLM-L6-v2 turns the sentence into a 384-dimension vector, in-process. No API call, no per-claim cost.",
    tag: "sentence-transformers",
  },
  {
    n: "02",
    title: "Search by meaning",
    body: "One cosine-distance query against the corpus, served by an HNSW index on a pgvector column. Different words, same claim, still found.",
    tag: "pgvector",
  },
  {
    n: "03",
    title: "Fall back to keywords",
    body: "If nothing clears the bar, Postgres full-text search looks for shared rare terms a figure or a bill number that embeddings alone can under-weight.",
    tag: "tsvector",
  },
  {
    n: "04",
    title: "Answer, or escalate",
    body: "Above the threshold the existing verdict is returned. Below it, the claim is queued for a fact-checker inside one transaction, and their ruling grows the corpus.",
    tag: "transaction + trigger",
  },
];

function HowItWorks() {
  return (
    <section className="mt-16" aria-labelledby="how">
      <h2 id="how" className="text-lg font-semibold tracking-tight">
        What happens when you press check
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
        Fact-checking treated as a matching problem rather than a re-verification problem. The
        branch at step four is what keeps a person from having to read every submission.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => (
          <li key={step.n} className="panel group p-5 transition-colors hover:border-line-bright">
            <div className="flex items-center gap-3">
              <span className="nums text-xs text-brand-bright">{step.n}</span>
              <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[0.65rem] text-muted">
                {step.tag}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium">{step.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{step.body}</p>
          </li>
        ))}
      </ol>

      <Link
        href="/about"
        className="mt-5 inline-block text-sm text-brand-bright underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand"
      >
        The database design behind it
      </Link>
    </section>
  );
}
