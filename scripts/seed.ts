import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { loadEnv, projectRoot } from "./env";
import { loadLiar, describeLiarRow, type LiarRow } from "./lib/liar";
import { paraphrase } from "./lib/paraphrase";
import { reword } from "./lib/reword";

loadEnv();

import { embedBatch, toVectorLiteral, warmUp } from "../src/lib/embeddings";
import { VERDICT_META, type Verdict } from "../src/lib/types";

const SEED_DIR = path.join(projectRoot, "db", "seed");
const EMBED_BATCH = 64;
const PUBLISH_CHUNK = 1000;

const DEMO_PASSWORD = "demo1234";

const CATEGORY_NAMES = [
  "Politics",
  "Health",
  "Economy",
  "Science",
  "Technology",
  "Environment",
  "Education",
  "Elections",
  "Immigration",
  "Energy",
  "Crime",
  "Media",
];

const USERS = [
  { email: "admin@demo.local", name: "Asha Menon", role: "admin" },
  { email: "priya@demo.local", name: "Priya Raman", role: "fact_checker" },
  { email: "daniel@demo.local", name: "Daniel Osei", role: "fact_checker" },
  { email: "reader@demo.local", name: "Sam Varma", role: "reader" },
];

/**
 * Claims with no counterpart in the corpus, used to seed the review queue so the
 * fact-checker dashboard is not empty on a fresh install. Written for this project.
 */
const NOVEL_CLAIMS = [
  "The state transport department has quietly withdrawn the student bus concession for the coming academic year.",
  "A new city ordinance will require every residential building above four floors to install rooftop solar by 2027.",
  "Hospitals in the district have been directed to stop issuing paper prescriptions from next month.",
  "The metro authority is planning to raise the minimum fare to thirty rupees after the monsoon.",
  "A recently approved pesticide has been linked to declining pollinator counts in the northern districts.",
  "The university has decided to make attendance optional for all postgraduate programmes.",
];

type Stage = {
  text: string;
  verdict: Verdict;
  explanation: string;
  categories: string[];
  sourceDomain: string;
};

function log(message: string) {
  process.stdout.write(`  ${message}\n`);
}

function progress(done: number, total: number, startedAt: number) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = done / Math.max(elapsed, 0.001);
  const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
  const bar = "#".repeat(Math.round(pct / 2.5)).padEnd(40, ".");
  process.stdout.write(
    `\r  [${bar}] ${pct}%  ${done.toLocaleString()}/${total.toLocaleString()}  ` +
      `${rate.toFixed(0)}/s  eta ${eta}s   `,
  );
  if (done >= total) process.stdout.write("\n");
}

/**
 * LIAR carries no review date, so one is synthesised, spread deterministically over the past
 * three years. This is called out in the seed output and the README because the credibility
 * score has a recency term: flat timestamps would make that term constant and invisible,
 * while a fake *precise* date would be worse. Nothing downstream treats these as real dates.
 */
/**
 * Keeps the first 55-75% of a claim's words -- the "I only pasted part of what I saw" case.
 * Produces genuine near-misses on both sides of the threshold, which is what gives the
 * dashboard's similarity histogram something to show.
 */
function fragment(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const keep = Math.max(5, Math.floor(words.length * (0.55 + (Math.abs(h) % 21) / 100)));
  const cut = words.slice(0, keep).join(" ").replace(/[,;:]$/, "");
  // claims.text has a CHECK for >= 12 characters; fall back rather than fail the insert.
  return cut.length >= 20 ? cut : text;
}

function syntheticReviewDate(text: string): Date {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const daysAgo = (Math.abs(h) % 1095) + 7;
  return new Date(Date.now() - daysAgo * 86_400_000);
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : Number.POSITIVE_INFINITY;
  const skipTraffic = args.includes("--no-demo-traffic");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /\bsslmode=require\b/.test(process.env.DATABASE_URL!)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();

  const { rows: check } = await client.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'claims'`,
  );
  if (check[0].n === 0) {
    console.error("\n  No `claims` table found. Run `npm run db:migrate` first.\n");
    process.exit(1);
  }

  log("");
  log("=== 1/6  reference data ===========================================");

  for (const name of CATEGORY_NAMES) {
    await client.query(
      `INSERT INTO categories (name, slug) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
      [name, name.toLowerCase().replace(/\s+/g, "-")],
    );
  }
  log(`${CATEGORY_NAMES.length} categories`);

  // PolitiFact is the genuine origin of every LIAR label, so it is credited as such.
  const SOURCES: { name: string; domain: string; reliability: number }[] = [
    { name: "PolitiFact (via LIAR dataset)", domain: "politifact.com", reliability: 0.92 },
  ];

  const curatedPath = path.join(SEED_DIR, "curated-claims.json");
  const curated = existsSync(curatedPath)
    ? (JSON.parse(readFileSync(curatedPath, "utf8")) as {
        sources: { name: string; domain: string; reliability: number }[];
        claims: {
          text: string;
          verdict: Verdict;
          explanation: string;
          source: string;
          categories: string[];
        }[];
      })
    : null;

  const liarRows = loadLiar(SEED_DIR);
  const useLiar = liarRows.length > 0;

  if (!useLiar && curated) SOURCES.push(...curated.sources);
  for (const source of SOURCES) {
    await client.query(
      `INSERT INTO sources (name, domain, reliability) VALUES ($1, $2, $3)
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, reliability = EXCLUDED.reliability`,
      [source.name, source.domain, source.reliability],
    );
  }
  log(`${SOURCES.length} source${SOURCES.length === 1 ? "" : "s"}`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const user of USERS) {
    await client.query(
      `INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, $4::user_role)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role`,
      [user.email, user.name, passwordHash, user.role],
    );
  }
  log(`${USERS.length} demo accounts (password: ${DEMO_PASSWORD})`);

  const { rows: reviewers } = await client.query<{ id: number }>(
    `SELECT id FROM users WHERE role IN ('fact_checker', 'admin') ORDER BY id`,
  );
  const { rows: readerRow } = await client.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'reader' ORDER BY id LIMIT 1`,
  );
  const readerId = readerRow[0]?.id ?? null;

  // ---------------------------------------------------------------------------------------
  log("");
  log("=== 2/6  corpus source ============================================");

  let stage: Stage[];
  let origin: "liar" | "seed";

  if (useLiar) {
    origin = "liar";
    const selected = Number.isFinite(limit) ? liarRows.slice(0, limit) : liarRows;
    stage = selected.map((row: LiarRow) => ({
      text: row.text,
      verdict: row.verdict,
      explanation: describeLiarRow(row, VERDICT_META[row.verdict].label),
      categories: row.categories,
      sourceDomain: "politifact.com",
    }));
    log(`LIAR dataset: ${stage.length.toLocaleString()} unique claims with PolitiFact ratings`);
    if (Number.isFinite(limit)) log(`(--limit=${limit} applied; drop it to load all)`);
  } else {
    origin = "seed";
    if (!curated) {
      console.error("\n  No LIAR data and no curated-claims.json. Nothing to seed.\n");
      process.exit(1);
    }
    stage = curated.claims.map((claim) => ({
      text: claim.text,
      verdict: claim.verdict,
      explanation: claim.explanation,
      categories: claim.categories,
      sourceDomain: claim.source,
    }));
    log(`LIAR not found -- using the bundled SYNTHETIC demo corpus (${stage.length} claims).`);
    log(`Run \`npm run liar:fetch\` then re-seed for the real ~12,800-claim dataset.`);
  }

  // ---------------------------------------------------------------------------------------
  log("");
  log("=== 3/6  embeddings ===============================================");
  log("loading all-MiniLM-L6-v2 (first run downloads ~23 MB)...");
  await warmUp();

  await client.query(`
    CREATE UNLOGGED TABLE IF NOT EXISTS _seed_stage (
      text        TEXT PRIMARY KEY,
      embedding   VECTOR(384) NOT NULL,
      verdict     verdict_type NOT NULL,
      explanation TEXT,
      source_id   INTEGER,
      reviewed_at TIMESTAMPTZ NOT NULL,
      reviewer_id INTEGER,
      categories  TEXT[] NOT NULL,
      chunk       INTEGER NOT NULL
    )
  `);
  await client.query(`TRUNCATE _seed_stage`);

  const { rows: sourceRows } = await client.query<{ id: number; domain: string }>(
    `SELECT id, domain FROM sources`,
  );
  const sourceId = new Map(sourceRows.map((r) => [r.domain, r.id]));

  const startedEmbed = Date.now();
  for (let i = 0; i < stage.length; i += EMBED_BATCH) {
    const batch = stage.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((row) => row.text));

    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((row, j) => {
      const base = params.length;
      values.push(
        `($${base + 1}, $${base + 2}::vector(384), $${base + 3}::verdict_type, $${base + 4}, ` +
          `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::TEXT[], $${base + 9})`,
      );
      params.push(
        row.text,
        toVectorLiteral(vectors[j]),
        row.verdict,
        row.explanation,
        sourceId.get(row.sourceDomain) ?? null,
        syntheticReviewDate(row.text),
        reviewers[(i + j) % Math.max(reviewers.length, 1)]?.id ?? null,
        row.categories,
        Math.floor((i + j) / PUBLISH_CHUNK),
      );
    });

    await client.query(
      `INSERT INTO _seed_stage
         (text, embedding, verdict, explanation, source_id, reviewed_at, reviewer_id, categories, chunk)
       VALUES ${values.join(", ")}
       ON CONFLICT (text) DO NOTHING`,
      params,
    );

    progress(Math.min(i + EMBED_BATCH, stage.length), stage.length, startedEmbed);
  }
  log(`embedded in ${((Date.now() - startedEmbed) / 1000).toFixed(1)}s`);

  // ---------------------------------------------------------------------------------------
  log("");
  log("=== 4/6  publishing into the corpus ===============================");
  log("claims go in as 'pending'; inserting each fact_check fires the trigger that");
  log("flips status to 'reviewed' and writes credibility_score -- same path a human review takes.");

  const { rows: chunkRow } = await client.query<{ n: number }>(
    `SELECT COALESCE(max(chunk), 0)::INT AS n FROM _seed_stage`,
  );
  const chunks = chunkRow[0].n;
  const startedPublish = Date.now();

  for (let chunk = 0; chunk <= chunks; chunk += 1) {
    await client.query("BEGIN");
    // Claims and their fact-checks are inserted in one statement, joined on text (the stage
    // table's primary key), so there is no id round-tripping and no chance of a claim landing
    // without its verdict.
    await client.query(
      `WITH ins AS (
         INSERT INTO claims (text, status, embedding, origin, submitted_at)
         SELECT s.text, 'pending', s.embedding, $1, s.reviewed_at - INTERVAL '2 days'
         FROM _seed_stage s
         WHERE s.chunk = $2
           AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.text = s.text)
         RETURNING id, text
       )
       INSERT INTO fact_checks (claim_id, verdict, explanation, source_id, reviewed_by, reviewed_at)
       SELECT i.id, s.verdict, s.explanation, s.source_id, s.reviewer_id, s.reviewed_at
       FROM ins i JOIN _seed_stage s ON s.text = i.text`,
      [origin, chunk],
    );
    await client.query(
      `INSERT INTO claim_categories (claim_id, category_id)
       SELECT c.id, cat.id
       FROM _seed_stage s
       JOIN claims c ON c.text = s.text AND c.origin = $1
       JOIN categories cat ON cat.name = ANY (s.categories)
       WHERE s.chunk = $2
       ON CONFLICT DO NOTHING`,
      [origin, chunk],
    );
    await client.query("COMMIT");
    progress(
      Math.min((chunk + 1) * PUBLISH_CHUNK, stage.length),
      stage.length,
      startedPublish,
    );
  }
  log(`published in ${((Date.now() - startedPublish) / 1000).toFixed(1)}s`);
  await client.query(`DROP TABLE IF EXISTS _seed_stage`);

  // ---------------------------------------------------------------------------------------
  log("");
  log("=== 5/6  demo traffic & examples ==================================");

  // Review queue: claims nothing in the corpus can answer.
  const novelVectors = await embedBatch(NOVEL_CLAIMS);
  for (let i = 0; i < NOVEL_CLAIMS.length; i += 1) {
    await client.query(
      `INSERT INTO claims (text, status, embedding, submitted_by, assigned_to, submitted_at)
       SELECT $1, 'pending', $2::vector(384), $3, fn_next_reviewer(), now() - ($4 || ' hours')::INTERVAL
       WHERE NOT EXISTS (SELECT 1 FROM claims WHERE lower(btrim(text)) = lower(btrim($1)))`,
      [NOVEL_CLAIMS[i], toVectorLiteral(novelVectors[i]), readerId, (i + 1) * 7],
    );
  }
  log(`${NOVEL_CLAIMS.length} claims queued for review`);

  if (!skipTraffic) {
    // Reader submissions, replayed through the real matcher so the dashboard reports a measured
    // match rate rather than an invented one.
    //
    // The rewriting matters. An earlier version wrapped each claim in a conversational lead-in
    // ("Is it true that ...") -- but normaliseClaim() strips exactly those, so every submission
    // collapsed onto its original and matched at 1.000. A 100% match rate and a histogram with a
    // single spike at the top is a demo that proves nothing. So the traffic is a deliberate mix
    // of how claims actually arrive:
    //   - reworded   : the words inside the claim change (normalisation cannot undo it)
    //   - fragment   : somebody pasted only part of what they saw
    //   - novel      : nothing in the corpus covers it
    // Fragments are the interesting case: they land either side of the threshold, which is what
    // makes the similarity distribution on the dashboard worth looking at.
    const { rows: samples } = await client.query<{ id: number; text: string }>(
      `SELECT id, text FROM claims WHERE status = 'reviewed' ORDER BY random() LIMIT 80`,
    );

    const prompts = samples.map((row, index) => {
      if (index % 4 === 3) return fragment(row.text);
      // Reword the claim, and wrap half of them the way a forwarded message arrives --
      // unless reword() already had to add a frame of its own, in which case a second
      // wrapper would read like nothing a person would type.
      const rewritten = reword(row.text);
      return index % 2 === 0 && !rewritten.framed ? paraphrase(rewritten.text) : rewritten.text;
    });
    const promptVectors = await embedBatch(prompts);

    let matched = 0;
    let escalated = 0;
    for (let i = 0; i < prompts.length; i += 1) {
      const literal = toVectorLiteral(promptVectors[i]);
      const { rows: hit } = await client.query<{ claim_id: number; similarity: number }>(
        `SELECT claim_id, similarity FROM fn_match_claims($1::vector(384), 1)`,
        [literal],
      );
      const similarity = hit[0] ? Number(hit[0].similarity) : 0;
      const threshold = Number(process.env.MATCH_THRESHOLD ?? 0.83);
      // Spread across all 30 days. An earlier version used (i * 10) % 30, which only ever
      // produced days 0, 10 and 20 -- the daily chart showed three spikes and no trend.
      const submittedAt = `now() - '${i % 30} days ${(i * 7) % 24} hours'::INTERVAL`;

      if (hit[0] && similarity >= threshold) {
        await client.query(
          `INSERT INTO claims (text, status, embedding, submitted_by, matched_claim_id,
                               match_similarity, submitted_at)
           VALUES ($1, 'matched', $2::vector(384), $3, $4, $5, ${submittedAt})`,
          [prompts[i], literal, readerId, hit[0].claim_id, similarity],
        );
        matched += 1;
      } else {
        await client.query(
          `INSERT INTO claims (text, status, embedding, submitted_by, assigned_to, submitted_at)
           SELECT $1, 'pending', $2::vector(384), $3, fn_next_reviewer(), ${submittedAt}
           WHERE NOT EXISTS (SELECT 1 FROM claims WHERE lower(btrim(text)) = lower(btrim($1)))`,
          [prompts[i], literal, readerId],
        );
        escalated += 1;
      }
    }
    log(
      `${prompts.length} reader submissions replayed: ${matched} answered instantly, ` +
        `${escalated} escalated (${Math.round((matched / prompts.length) * 100)}% match rate)`,
    );
  }

  // Landing page examples, derived from whatever corpus is actually loaded.
  await client.query(`TRUNCATE demo_prompts RESTART IDENTITY`);
  const { rows: exampleSources } = await client.query<{ id: number; text: string }>(
    `SELECT c.id, c.text
     FROM claims c
     WHERE c.status = 'reviewed'
       AND length(c.text) BETWEEN 60 AND 180
       -- Skip claims that are themselves quotations or lean on a parenthetical gloss:
       -- they are fine in the corpus, but as a landing-page example they read as a
       -- fragment of someone else's sentence rather than something a reader would paste.
       AND c.text NOT LIKE '%"%'
       AND c.text NOT LIKE '%(%'
       AND c.text ~ '^[A-Z]'
     ORDER BY random()
     LIMIT 24`,
  );
  // Prefer claims the lexicon could actually rewrite -- an example that reaches the page
  // as a frame around unchanged text demonstrates far less than one with changed words.
  const examplePicks = [...exampleSources]
    .sort((a, b) => Number(reword(a.text).framed) - Number(reword(b.text).framed))
    .slice(0, 4);

  for (const row of examplePicks) {
    // reword() then paraphrase(): the rewording is what survives normalisation and actually
    // exercises semantic matching; the lead-in makes it read like a real submission. Skip the
    // lead-in when reword() fell back to a frame, so the two never stack.
    const rewritten = reword(row.text);
    await client.query(
      `INSERT INTO demo_prompts (prompt, kind, source_claim_id) VALUES ($1, 'paraphrase', $2)`,
      [rewritten.framed ? rewritten.text : paraphrase(rewritten.text), row.id],
    );
  }
  await client.query(
    `INSERT INTO demo_prompts (prompt, kind) VALUES ($1, 'novel'), ($2, 'novel')`,
    [
      "The health ministry has approved a new vaccine that is administered as a single nasal dose.",
      "Three coastal districts will be declared no-construction zones starting next year.",
    ],
  );
  log(`${examplePicks.length + 2} landing-page examples`);

  // ---------------------------------------------------------------------------------------
  log("");
  log("=== 6/6  summary ==================================================");
  const { rows: summary } = await client.query<{ label: string; value: string }>(`
    SELECT 'verified corpus'   AS label, count(*)::TEXT AS value FROM claims WHERE status = 'reviewed'
    UNION ALL SELECT 'awaiting review', count(*)::TEXT FROM claims WHERE status = 'pending'
    UNION ALL SELECT 'instant matches', count(*)::TEXT FROM claims WHERE status = 'matched'
    UNION ALL SELECT 'fact-checks',     count(*)::TEXT FROM fact_checks
    UNION ALL SELECT 'category tags',   count(*)::TEXT FROM claim_categories
    UNION ALL SELECT 'avg credibility', COALESCE(round(avg(credibility_score), 3)::TEXT, 'n/a')
                FROM claims WHERE status = 'reviewed'
  `);
  for (const row of summary) log(`${row.label.padEnd(18)} ${row.value}`);

  if (useLiar) {
    log("");
    log("note: LIAR carries PolitiFact's verdict but no review date, so review timestamps");
    log("      are synthesised across the past 3 years to exercise the recency term in the");
    log("      credibility score. Verdicts and claim text are the real dataset.");
  }

  log("");
  log("Sign in at /login with any of:");
  for (const user of USERS) log(`  ${user.email.padEnd(20)} ${user.role.padEnd(13)} ${DEMO_PASSWORD}`);
  log("");

  await client.end();
}

main().catch((error) => {
  console.error("\n", error);
  process.exit(1);
});
