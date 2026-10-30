import Link from "next/link";
import { MATCH_THRESHOLD } from "@/lib/thresholds";

export const metadata = { title: "How it works" };

const TABLES = [
  {
    name: "users",
    purpose: "Reader / fact-checker / admin accounts",
    columns: ["id PK", "email UNIQUE", "display_name", "password_hash", "role user_role"],
  },
  {
    name: "claims",
    purpose: "Every submission, and the corpus it grows into",
    columns: [
      "id PK",
      "text",
      "status claim_status",
      "embedding vector(384)",
      "submitted_by FK",
      "assigned_to FK",
      "matched_claim_id FK",
      "match_similarity",
      "credibility_score",
      "search_vector GENERATED",
    ],
    highlight: true,
  },
  {
    name: "fact_checks",
    purpose: "Verdict history for a claim -- newest wins, older rulings stay",
    columns: ["id PK", "claim_id FK", "verdict verdict_type", "explanation", "source_id FK", "reviewed_by FK"],
  },
  {
    name: "sources",
    purpose: "Publishers, with the reliability weight that feeds credibility",
    columns: ["id PK", "name", "domain UNIQUE", "reliability 0..1"],
  },
  {
    name: "categories",
    purpose: "Topic tags",
    columns: ["id PK", "name UNIQUE", "slug UNIQUE"],
  },
  {
    name: "claim_categories",
    purpose: "Many-to-many junction -- a claim can be both Health and Economy",
    columns: ["claim_id FK", "category_id FK", "PK(claim_id, category_id)"],
  },
];

const FEATURES = [
  {
    n: 1,
    name: "Vector similarity search",
    where: "fn_match_claims()",
    file: "db/migrations/006_functions.sql",
    body: "A cosine-distance KNN query over claims.embedding, served by an HNSW index. The KNN scan is isolated in a CTE so the ORDER BY / LIMIT sits directly on the claims scan -- the only shape the index can serve. The index is partial (WHERE status = 'reviewed'), so pending and duplicate rows never enter the graph.",
  },
  {
    n: 2,
    name: "Full-text search",
    where: "fn_search_claims_fts()",
    file: "db/migrations/006_functions.sql",
    body: "A GIN index over a generated tsvector column, queried with websearch_to_tsquery. It runs only when the vector path finds nothing above threshold, and catches the case embeddings are weakest at: a rare figure or bill number that carries the whole claim. Hits still have to clear a semantic floor, so a shared keyword alone cannot trigger a match.",
  },
  {
    n: 3,
    name: "Stored functions & procedure",
    where: "fn_credibility_score(), sp_assign_verdict()",
    file: "db/migrations/006, 008",
    body: "Credibility is 50% publisher reliability, 30% recency (exponential decay, two-year half-life) and 20% verdict certainty, computed in PL/pgSQL. Filing a verdict is one CALL that locks the claim, upserts the cited domain into sources, writes the ruling and tags the topics.",
  },
  {
    n: 4,
    name: "Triggers",
    where: "fact_check_applied, source_reliability_changed, require_embedding_for_corpus",
    file: "db/migrations/007_triggers.sql",
    body: "Inserting a fact_check flips its claim to 'reviewed' and writes the credibility score -- so a claim can never sit pending with a verdict attached, whichever client wrote the row. Editing a source's reliability re-scores every claim citing it. And a claim cannot enter the corpus without an embedding, which would make it invisible to every future search.",
  },
  {
    n: 5,
    name: "Transactions",
    where: "withTransaction() + FOR UPDATE",
    file: "src/lib/claims.ts, db/migrations/008",
    body: "Queueing a claim is four statements that have to agree: check for a duplicate, pick the least-loaded reviewer, insert, assign. Wrapped in BEGIN/COMMIT with a row lock on the chosen reviewer, so simultaneous submissions cannot both be handed to the same person on the same stale count.",
  },
];

export default function AboutPage() {
  return (
    <div className="pt-10 pb-10 sm:pt-14">
      <header className="max-w-2xl">
        <p className="label-xs">Architecture</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          How it works
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
          The system treats fact-checking as a <strong className="text-ink">matching</strong>{" "}
          problem rather than a re-verification problem. A claim that has already been checked
          should not need checking again just because it arrived in different words &mdash; and a
          claim nobody has checked should not get a guessed answer.
        </p>
      </header>

      <Section title="The pipeline" id="pipeline">
        <PipelineDiagram />
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-soft">
          The branch in the middle is the whole design. Above{" "}
          <span className="nums text-ink">{MATCH_THRESHOLD.toFixed(2)}</span> cosine similarity the
          stored verdict is returned and no human is involved. Below it, the system asserts
          nothing: the claim is queued, a fact-checker rules on it, and that ruling joins the
          corpus so the next person asking the same thing in different words gets an instant
          answer. The corpus is the thing that compounds.
        </p>
      </Section>

      <Section title="Why one database, not two" id="storage">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <h3 className="text-sm font-medium">The requirement</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              A SQL store for the relational data &mdash; accounts, claims, verdicts, topics
              &mdash; and a vector store for semantic search.
            </p>
          </div>
          <div className="panel p-5">
            <h3 className="text-sm font-medium">The decision</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Both, in <strong className="text-ink">one PostgreSQL</strong>, using the{" "}
              <code className="text-brand-bright">pgvector</code> extension &mdash; the embedding
              is a <code className="text-brand-bright">vector(384)</code> column on{" "}
              <code className="text-brand-bright">claims</code>, not a row in a separate service.
            </p>
          </div>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          <Reason title="A claim and its vector cannot disagree">
            With a separate vector service, every write is a two-phase problem: a verdict
            committed in Postgres while the vector write fails leaves a claim that is in the
            corpus but unsearchable. Here it is one row in one transaction.
          </Reason>
          <Reason title="Search and filter in one query">
            &ldquo;Closest claims, but only health topics, only reviewed, with their source
            reliability&rdquo; is a join, not an application-side intersection of two result sets
            from two systems.
          </Reason>
          <Reason title="One thing to run and back up">
            For a semester timeline, a second service to deploy, monitor and restore is cost
            without a matching benefit at this corpus size.
          </Reason>
        </ul>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted">
          The honest limit: a dedicated vector database earns its place at a scale this project
          does not reach &mdash; tens of millions of vectors, or when the embedding workload needs
          to scale separately from the relational one. At ~13,000 claims, HNSW inside Postgres
          answers in single-digit milliseconds.
        </p>
      </Section>

      <Section title="Schema" id="schema">
        <div className="grid gap-3 md:grid-cols-2">
          {TABLES.map((table) => (
            <div
              key={table.name}
              className={`panel p-4 ${table.highlight ? "border-brand/30" : ""}`}
            >
              <div className="flex items-baseline gap-2">
                <code className={`text-sm ${table.highlight ? "text-brand-bright" : "text-ink"}`}>
                  {table.name}
                </code>
                {table.highlight && (
                  <span className="rounded-full border border-brand/30 px-2 py-0.5 text-[0.6rem] text-brand-bright">
                    SQL + vector in one row
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{table.purpose}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {table.columns.map((column) => (
                  <li
                    key={column}
                    className="nums rounded border border-line bg-void px-1.5 py-0.5 text-[0.65rem] text-muted"
                  >
                    {column}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="The five advanced features" id="features">
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-ink-soft">
          Each one is here because the design needs it, not to tick a box.
        </p>
        <ol className="space-y-3">
          {FEATURES.map((feature) => (
            <li key={feature.n} className="panel p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="nums text-xs text-brand-bright">
                  {String(feature.n).padStart(2, "0")}
                </span>
                <h3 className="text-sm font-medium">{feature.name}</h3>
                <code className="text-[0.7rem] text-ink-soft">{feature.where}</code>
                <span className="nums ml-auto text-[0.65rem] text-muted">{feature.file}</span>
              </div>
              <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-ink-soft">
                {feature.body}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Where the corpus comes from" id="corpus">
        <div className="panel max-w-3xl p-5">
          <p className="text-sm leading-relaxed text-ink-soft">
            The corpus is bootstrapped from the{" "}
            <strong className="text-ink">LIAR dataset</strong> (Wang, ACL 2017): roughly 12,800
            short political claims from PolitiFact, each carrying a six-way truth rating that maps
            one-to-one onto this schema&rsquo;s{" "}
            <code className="text-brand-bright">verdict_type</code>.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Scraping live fact-check sites was the alternative, and was rejected: it means building
            and babysitting scraping infrastructure, respecting robots.txt and rate limits, and
            re-running it whenever a page layout changes. LIAR is a fixed, citable file &mdash;
            download once, embed once, and the corpus is real data with real verdicts.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            One caveat the seeder states in its own output: LIAR carries PolitiFact&rsquo;s rating
            but not the date of each ruling, so review timestamps are synthesised across the past
            three years. That is deliberate &mdash; the credibility score has a recency term, and
            identical timestamps would make it a constant. The claim text and verdicts are the
            real dataset.
          </p>
        </div>
      </Section>

      <Section title="Choosing the threshold" id="threshold">
        <div className="panel max-w-3xl p-5">
          <p className="text-sm leading-relaxed text-ink-soft">
            <span className="nums text-ink">{MATCH_THRESHOLD.toFixed(2)}</span> is measured, not
            chosen by feel. On a 400-claim sample, reworded duplicates scored{" "}
            <span className="nums text-ink">0.96</span> at the median, while the closest{" "}
            <em>different</em> claim sharing a topic reached only{" "}
            <span className="nums text-ink">0.729</span>. The threshold sits a margin above that
            worst false positive.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            It is deliberately not the F1-optimal value, because the two errors are not
            symmetric. A missed duplicate costs a fact-checker a few minutes. A false match tells
            a reader something untrue &mdash; the one thing a fact-checking tool may not do.
          </p>
          <p className="mt-3 text-xs text-muted">
            Reproduce it with <code className="text-ink-soft">npm run calibrate</code>; the full
            write-up, including what the calibration cannot measure, is in{" "}
            <code className="text-ink-soft">docs/threshold-calibration.md</code>.
          </p>
        </div>
      </Section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-lg bg-gradient-to-r from-brand to-cyan px-4 py-2.5 text-sm font-medium text-void transition-all hover:brightness-110"
        >
          Try it on a claim
        </Link>
        <Link
          href="/corpus"
          className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
        >
          Browse the corpus
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Reason({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="panel p-4">
      <h4 className="text-xs font-medium text-ink">{title}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{children}</p>
    </li>
  );
}

/**
 * The claim pipeline, drawn rather than described.
 *
 * Inline SVG with no JS: the point is the single branch after the search stage, so the two
 * outcome paths get different colours (green = answered from the corpus, amber = a person is
 * needed) matching the convention used everywhere else in the app, and the feedback arrow from
 * review back into the corpus is drawn because that loop is the reason the system improves.
 */
function PipelineDiagram() {
  return (
    <div className="panel overflow-x-auto p-5">
      <svg
        viewBox="0 0 760 240"
        className="h-auto w-full min-w-[640px]"
        role="img"
        aria-label="Claim pipeline: a submitted claim is embedded, then searched against the corpus. Above the similarity threshold the stored verdict is returned immediately. Below it, the claim is queued for a fact-checker, whose ruling is embedded and added back into the corpus."
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,1 L8,5 L0,9 z" fill="var(--color-line-bright)" />
          </marker>
          <marker id="arrow-good" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,1 L8,5 L0,9 z" fill="var(--color-chart-good)" />
          </marker>
          <marker id="arrow-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,1 L8,5 L0,9 z" fill="var(--color-chart-warn)" />
          </marker>
        </defs>

        <Box x={8} y={92} w={118} label="Claim submitted" sub="reader pastes text" />
        <Arrow d="M130,116 H158" />
        <Box x={162} y={92} w={118} label="Embed" sub="384-dim vector" accent />
        <Arrow d="M284,116 H312" />
        <Box x={316} y={92} w={126} label="Search corpus" sub="cosine + full-text" accent />

        {/* The branch */}
        <path
          d="M446,110 C468,110 468,48 490,48"
          fill="none"
          stroke="var(--color-chart-good)"
          strokeWidth={2}
          markerEnd="url(#arrow-good)"
        />
        <path
          d="M446,122 C468,122 468,186 490,186"
          fill="none"
          stroke="var(--color-chart-warn)"
          strokeWidth={2}
          markerEnd="url(#arrow-warn)"
        />
        <text x={452} y={78} fontSize={9.5} fill="var(--color-chart-good)" className="nums">
          &ge; threshold
        </text>
        <text x={452} y={160} fontSize={9.5} fill="var(--color-chart-warn)" className="nums">
          &lt; threshold
        </text>

        <Box
          x={498}
          y={24}
          w={150}
          label="Verdict returned"
          sub="instant, no human"
          tone="var(--color-chart-good)"
        />
        <Box
          x={498}
          y={162}
          w={150}
          label="Queued for review"
          sub="fact-checker rules"
          tone="var(--color-chart-warn)"
        />

        {/* Feedback loop: a ruling grows the corpus. */}
        <path
          d="M648,186 C706,186 740,186 740,116 C740,60 700,48 652,48"
          fill="none"
          stroke="var(--color-line-bright)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          markerEnd="url(#arrow)"
        />
        <text x={690} y={112} fontSize={9} fill="var(--color-muted)" textAnchor="middle">
          ruling joins
        </text>
        <text x={690} y={124} fontSize={9} fill="var(--color-muted)" textAnchor="middle">
          the corpus
        </text>
      </svg>
    </div>
  );
}

function Box({
  x,
  y,
  w,
  label,
  sub,
  accent,
  tone,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  sub: string;
  accent?: boolean;
  tone?: string;
}) {
  const stroke = tone ?? (accent ? "var(--color-brand)" : "var(--color-line-bright)");
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={48}
        rx={9}
        fill="var(--color-panel-2)"
        stroke={stroke}
        strokeWidth={1}
      />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={11.5} fill="var(--color-ink)">
        {label}
      </text>
      <text x={x + w / 2} y={y + 35} textAnchor="middle" fontSize={9.5} fill="var(--color-muted)">
        {sub}
      </text>
    </g>
  );
}

function Arrow({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--color-line-bright)"
      strokeWidth={1.5}
      markerEnd="url(#arrow)"
    />
  );
}
