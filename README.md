# Fact-Check Assistant

Claims that have already been debunked keep circulating in new wording, and keyword search
misses them. This system checks a submitted claim against a corpus of **already-verified**
claims by meaning rather than by text. If something close enough already has a verdict, the
reader gets it instantly. If nothing does, the claim goes to a human fact-checker — and their
ruling joins the corpus, so the next person to ask the same thing in different words gets an
instant answer.

Fact-checking as a **matching** problem, not a re-verification problem.

**Stack:** Next.js 15 (App Router, TypeScript) · PostgreSQL + pgvector · sentence-transformers
`all-MiniLM-L6-v2` running locally in-process.

---

## Quickstart

```bash
npm install
cp .env.example .env.local        # then edit DATABASE_URL + AUTH_SECRET
npm run liar:fetch                # download the ~12,800-claim LIAR corpus
npm run db:setup                  # migrate + seed (embeds the corpus; takes a few minutes)
npm run dev                       # http://localhost:3000
```

### No Postgres installed?

Two options, neither of which needs a server:

```bash
npm run test:db      # runs the real migrations + 56 feature tests against in-process Postgres
npm run db:local     # starts a Postgres on 127.0.0.1:5433 that the app can actually use
```

`npm run db:local` boots **PGlite** — PostgreSQL 18 compiled to WASM, with pgvector — and
exposes it on a TCP port speaking the real Postgres wire protocol, so `pg`, `psql` and the app
connect to it exactly as they would to a server. Point `DATABASE_URL` at it, set
`PG_POOL_MAX=1` (PGlite serves one connection at a time), and seed as usual.

It is a development convenience, not the deployment target: one connection at a time means it
cannot exercise the concurrency the `FOR UPDATE` locking exists for.

### A real Postgres with pgvector

```bash
docker run -d --name fca-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=factcheck \
  pgvector/pgvector:pg17
```

Hosted **Neon** and **Supabase** both ship pgvector; add `?sslmode=require` to the URL.

### Demo accounts

Created by `npm run db:seed`. Password for all three: `demo1234`.

| Email | Role | Can do |
|---|---|---|
| `reader@demo.local` | Reader | Submit claims, read verdicts |
| `priya@demo.local` | Fact-checker | Work the review queue, file verdicts |
| `admin@demo.local` | Admin | Everything, plus the analytics dashboard |

Readers don't need an account at all — anonymous submission works.

---

## The pipeline

```
claim submitted
      │
      ▼
 ┌──────────────┐   all-MiniLM-L6-v2, in-process, no API cost
 │   embed      │   → vector(384)
 └──────┬───────┘
        ▼
 ┌──────────────────────┐  cosine KNN over the corpus (HNSW index)
 │ vector search        │  + full-text fallback if nothing clears the bar
 └──────┬───────────────┘
        │
   ┌────┴─────┐
   │          │
 ≥ 0.83    < 0.83
   │          │
   ▼          ▼
verdict    queued for a fact-checker
returned   → their ruling is embedded and
instantly    added to the corpus ──┐
                                   │
        corpus grows ◄─────────────┘
```

Only submissions the corpus cannot answer cost a person any time. Everything else is answered
from work somebody already did.

**Thresholds** live in [`src/lib/thresholds.ts`](src/lib/thresholds.ts) and are *measured* —
see [Calibration](#calibration).

---

## Database design

One PostgreSQL, with the embedding as a `vector(384)` column on `claims` rather than a row in a
separate vector service.

| Table | Purpose |
|---|---|
| `users` | Reader / fact-checker / admin accounts |
| `claims` | Every submission, and the corpus it grows into. Holds `embedding vector(384)` and a generated `search_vector tsvector` |
| `fact_checks` | Verdict history per claim — newest wins, older rulings stay on the record |
| `sources` | Publishers, with the `reliability` weight that feeds credibility |
| `categories` | Topic tags |
| `claim_categories` | Many-to-many junction |

### Why one database and not two

- **A claim and its vector cannot disagree.** With a separate vector store, every write is a
  two-phase problem — a verdict committed in Postgres while the vector write fails leaves a
  claim that is in the corpus but unsearchable. Here it is one row in one transaction.
- **Search and filter in one query.** "Closest claims, health topics only, reviewed, with
  source reliability" is a join, not an application-side intersection of two systems' results.
- **One thing to run, deploy and back up.**

The honest limit: a dedicated vector database earns its place at a scale this project does not
reach — tens of millions of vectors, or when the embedding workload must scale independently of
the relational one. At ~13,000 claims, HNSW inside Postgres answers in single-digit ms.

### Claim lifecycle

`pending` → `reviewed` (a fact-check was filed; a trigger does this)
`pending` → `rejected` (not a checkable factual claim)
`matched` — answered from the corpus. **Deliberately never searchable**: only `reviewed` claims
are searched, so a duplicate submission can never become a second, verdict-less answer to a
later query. It is still stored, because it is what makes the match rate measurable.

---

## The five advanced features

Each is here because the design needs it.

| # | Feature | Where |
|---|---|---|
| 1 | **Vector similarity search** — cosine KNN on `claims.embedding`, HNSW index, partial (`WHERE status = 'reviewed'`) so pending and duplicate rows stay out of the graph | `fn_match_claims()` in [`006_functions.sql`](db/migrations/006_functions.sql) |
| 2 | **Full-text search** — GIN over a generated `tsvector`, `websearch_to_tsquery`; runs only when the vector path finds nothing, and catches rare figures or bill numbers embeddings under-weight | `fn_search_claims_fts()` in [`006_functions.sql`](db/migrations/006_functions.sql) |
| 3 | **Stored function + procedure** — credibility scoring in PL/pgSQL; filing a verdict is one `CALL` that locks the claim, upserts the source, writes the ruling and tags topics | [`006_functions.sql`](db/migrations/006_functions.sql), [`008_procedures.sql`](db/migrations/008_procedures.sql) |
| 4 | **Triggers** — three of them (below) | [`007_triggers.sql`](db/migrations/007_triggers.sql) |
| 5 | **Transactions** — queueing a claim is four statements that must agree, wrapped in `BEGIN`/`COMMIT` with a `FOR UPDATE` lock on the chosen reviewer | `withTransaction()` in [`src/lib/claims.ts`](src/lib/claims.ts) |

Plus four analytics **views** (`v_verified_claims`, `v_daily_activity`, `v_category_breakdown`,
`v_reviewer_workload`) — the dashboard reads views, it does not sum rows in application code.

### The triggers, and why each exists

- `fact_check_applied` — inserting a `fact_checks` row flips its claim to `reviewed` and writes
  `credibility_score`. In a trigger rather than the API, so a claim can never sit `pending` with
  a verdict attached no matter which client wrote the row (app, `psql`, seed script).
- `source_reliability_changed` — reliability is 50% of the credibility score, so editing a
  source re-scores every claim citing it instead of leaving stale numbers behind.
- `require_embedding_for_corpus` — a claim may not enter the corpus without an embedding, which
  would make it invisible to every future search.

### The credibility score

`fn_credibility_score(claim_id)` returns 0–1 from:

- **50% publisher reliability** — an established fact-checker outranks a random blog
- **30% recency** — exponential decay, two-year half-life
- **20% verdict certainty** — `half_true` is inherently a hedge; `true`/`false` are not

---

## Calibration

`MATCH_THRESHOLD = 0.83` is measured, not chosen by feel.

```bash
npm run calibrate     # regenerates docs/threshold-calibration.md
```

On a 400-claim LIAR sample: reworded duplicates scored **0.96** median (0.88 at the 5th
percentile) while the closest *different* claim sharing a topic reached only **0.729**. The
threshold is that worst false positive plus a 0.10 margin.

It is deliberately **not** the F1-optimal value (0.73), because the two errors are not
symmetric:

- **False negative** — a duplicate is escalated; a fact-checker spends a few minutes marking it
  a duplicate. The queue shows them how close the near miss was, so they start warm.
- **False positive** — a reader is shown somebody else's verdict as the answer to *their* claim.
  The tool confidently states something untrue, which is the one thing a fact-checking tool may
  not do.

The run also measures what text normalisation is worth: stripping conversational lead-ins
("Is it true that…", "Someone forwarded me this:") moves the median wrapped pair from 0.960 to
1.000. Readers really do paste claims that way, and those wrappers carry no factual content.

Full write-up, **including what the calibration cannot measure**, in
[`docs/threshold-calibration.md`](docs/threshold-calibration.md).

---

## Testing

```bash
npm run test:db      # 56 assertions over the real migrations
npm run typecheck
npm run lint
```

`test:db` applies the actual migration files to a real PostgreSQL engine (PGlite, with pgvector)
and asserts that every advanced feature behaves as claimed — the trigger publishes a claim, the
credibility score responds to a source's reliability changing, a reworded claim ranks its
original first and clears the threshold, an unrelated claim does not, the full-text fallback
rescues a query the vector path declined, the procedure refuses a verdict on an auto-matched
claim, a rolled-back transaction leaves no orphan. No server, no `DATABASE_URL`.

It cannot test genuine concurrency: PGlite is single-connection, so the `FOR UPDATE` locking is
exercised for correctness but not for contention.

---

## The corpus

Bootstrapped from the **LIAR dataset** (Wang, ACL 2017) — ~12,800 short political claims from
PolitiFact, each with a six-way truth rating that maps one-to-one onto this schema's
`verdict_type`.

Scraping live fact-check sites was the alternative and was rejected: it means building and
babysitting scraping infrastructure, respecting robots.txt and rate limits, and re-running it
whenever a layout changes. LIAR is a fixed, citable file — download once, embed once.

**One caveat, stated in the seeder's own output:** LIAR carries PolitiFact's rating but not the
date of each ruling, so review timestamps are synthesised across the past three years. That is
deliberate — the credibility score has a recency term, and identical timestamps would make it a
constant. The claim text and the verdicts are the real dataset.

If `db/seed/liar/` is absent, the seeder falls back to
[`db/seed/curated-claims.json`](db/seed/curated-claims.json) — ~24 claims written for this
project, with **fictional** sources (`example.org`) precisely so nothing there can be mistaken
for a real ruling by a real organisation.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run db:migrate` | Apply pending migrations (`--reset` drops the schema first) |
| `npm run db:seed` | Load the corpus (`--limit=N`, `--no-demo-traffic`) |
| `npm run db:setup` | `db:migrate --reset` + `db:seed` |
| `npm run db:local` | Zero-install Postgres on `127.0.0.1:5433` |
| `npm run liar:fetch` | Download the LIAR dataset |
| `npm run calibrate` | Re-measure the thresholds, rewrite the calibration doc |
| `npm run test:db` | Database feature tests |
| `npm run embed:warm` | Pre-download the embedding model (~23 MB) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |

---

## Layout

```
db/migrations/      numbered SQL — the schema is these files, nothing generates it
db/seed/            LIAR data (downloaded) + the offline fallback corpus
scripts/            migrate, seed, calibrate, test, local Postgres
src/lib/            db pool, embeddings, auth, the claim pipeline, analytics
src/app/            routes: /, /corpus, /claims/[id], /review, /admin, /about
src/components/     UI, including the hand-built SVG charts
docs/               generated calibration report
```

### Notable implementation details

- **Embeddings run in Node**, via `@huggingface/transformers` (transformers.js) loading the same
  `all-MiniLM-L6-v2` weights as the Python `sentence-transformers` package. Same 384-dimension
  output, interchangeable vectors, but no second service to deploy and no per-claim API cost.
  The model is held in a module-level promise, so the ~20 s load is paid once per process
  (`npm run embed:warm` pays it before a demo).
- **Submission is streamed as NDJSON** — one line per pipeline stage, flushed as it completes,
  so the progress the reader watches is the pipeline that actually ran rather than a CSS
  animation. Embedding dominates; the vector search is usually single-digit milliseconds.
- **`ts_headline` returns alphanumeric sentinels, not `<mark>`.** It passes the source text
  through verbatim, so emitting HTML from it would make any claim containing markup an injection
  vector. The client escapes the whole string, *then* swaps sentinels for tags.
- **Role checks are enforced server-side, twice.** Middleware verifies the session JWT at the
  edge as a cheap filter; every mutating route handler then calls `requireRole()`, which
  re-reads the role from `users`. A demoted account loses write access immediately rather than
  when its week-old token expires.
- **Chart colours are validated, not picked.** The four `--color-chart-*` steps were checked as
  a set against the panel surface for lightness band, chroma floor, colour-vision-deficiency
  separation and contrast. The brighter verdict tones used for badges fail the mark-contrast
  check and are not used for fills.

---

## Known limits

- **Recall against a claim the corpus has never seen is zero by definition.** That is what the
  review queue is for; the system's value compounds with corpus coverage.
- **Numeric near-misses are the dangerous case.** "Spending rose 12%" and "spending rose 21%"
  are semantically near-identical and the embedding will score them high. The threshold does
  not solve this — a human in the loop does. The calibration doc flags it explicitly.
- **English only**, and the corpus is US political claims. Another domain or language needs its
  own corpus and its own `npm run calibrate` run.
- **No image or video claims**, no live social-media ingestion — both out of scope.
