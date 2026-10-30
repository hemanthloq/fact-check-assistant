/**
 * Database test harness -- runs the real migrations against a real PostgreSQL engine with
 * pgvector, and asserts that every advanced feature actually behaves as claimed.
 *
 * It uses PGlite (PostgreSQL 18 compiled to WASM, plus pgvector 0.8), so it needs no server,
 * no Docker and no DATABASE_URL: `npm run test:db` works on a clean checkout. The SQL under
 * test is byte-for-byte the same files `npm run db:migrate` applies to the real database.
 *
 * What this cannot test: genuine concurrency. PGlite is single-connection, so the FOR UPDATE
 * locking in sp_assign_verdict and the submission transaction is exercised for correctness
 * but not for contention. Those paths are tested against a real server.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { projectRoot } from "./env";
import { embedBatch, toVectorLiteral } from "../src/lib/embeddings";

let passed = 0;
let failed = 0;

function ok(name: string, detail = "") {
  passed += 1;
  console.log(`  PASS  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  failed += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
}

function check(name: string, condition: boolean, detail = "") {
  if (condition) ok(name, detail);
  else fail(name, detail || "assertion was false");
}

/** Asserts the statement is rejected, and that it is rejected for the expected reason. */
async function expectError(db: PGlite, name: string, sql: string, expect: RegExp) {
  try {
    await db.exec(sql);
    fail(name, "statement succeeded but should have been rejected");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (expect.test(message)) ok(name, message.split("\n")[0].slice(0, 78));
    else fail(name, `rejected, but with an unexpected message: ${message.split("\n")[0]}`);
  }
}

const CORPUS = [
  {
    text: "The government spent 47 billion rupees building the new coastal highway last year.",
    verdict: "mostly_true",
    category: "Economy",
  },
  {
    text: "Drinking lemon water every morning flushes all toxins out of the liver within a week.",
    verdict: "false",
    category: "Health",
  },
  {
    text: "Solar panels stop generating electricity completely on cloudy days.",
    verdict: "false",
    category: "Environment",
  },
  {
    text: "The literacy rate in the district crossed ninety percent for the first time this year.",
    verdict: "true",
    category: "Education",
  },
];

import { MATCH_THRESHOLD, LEXICAL_CONFIRM_THRESHOLD } from "../src/lib/thresholds";

/**
 * CORPUS[0], reworded and wrapped the way a reader actually pastes a claim. Measured at
 * ~0.87 similarity: clears MATCH_THRESHOLD, so the vector path answers it outright.
 */
const PARAPHRASE =
  "Is it true that 47 billion rupees was spent by the administration on the new coastal highway?";

/**
 * A bare keyword fragment. Measured at ~0.81 -- BELOW MATCH_THRESHOLD, so the vector path
 * correctly declines to rule on it, but full-text search finds it on the shared rare stems
 * ("rupe", "coastal", "47") and cosine then confirms it above LEXICAL_CONFIRM_THRESHOLD.
 * This pair is the whole reason the fallback exists.
 */
const LEXICAL = "47 billion rupees coastal highway";

/** Nothing in the corpus is about this. */
const NOVEL = "The university has decided to make attendance optional for all postgraduate programmes.";

async function main() {
  console.log("\n  Fact-Check Assistant -- database feature tests");
  console.log("  (PostgreSQL via PGlite, with pgvector)\n");

  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  const { rows: version } = await db.query<{ v: string }>(`SELECT version() AS v`);
  console.log(`  engine: ${version[0].v.split(",")[0]}`);

  // --- migrations -----------------------------------------------------------------------
  console.log("\n  --- migrations ---");
  const dir = path.join(projectRoot, "db", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"));
      ok(`apply ${file}`);
    } catch (error) {
      fail(`apply ${file}`, error instanceof Error ? error.message : String(error));
      console.log("\n  Migrations failed; aborting.\n");
      process.exit(1);
    }
  }

  const { rows: objects } = await db.query<{ n: number }>(`
    SELECT count(*)::INT AS n FROM pg_trigger WHERE NOT tgisinternal
  `);
  check("triggers created", objects[0].n >= 3, `${objects[0].n} user triggers`);

  // Filtered to this project's routines; pgvector installs ~150 of its own into public.
  const { rows: routines } = await db.query<{ kind: string; n: number }>(`
    SELECT p.prokind AS kind, count(*)::INT AS n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_%' OR p.proname LIKE 'trg\_%'
                                    OR p.proname LIKE 'sp\_%')
    GROUP BY 1
  `);
  const funcs = routines.find((r) => r.kind === "f")?.n ?? 0;
  const procs = routines.find((r) => r.kind === "p")?.n ?? 0;
  check("functions created", funcs >= 4, `${funcs} functions`);
  check("procedures created", procs >= 2, `${procs} procedures`);

  const { rows: hnsw } = await db.query<{ indexdef: string }>(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_claims_embedding_hnsw'
  `);
  check(
    "HNSW cosine index on claims.embedding",
    /USING hnsw .*vector_cosine_ops/i.test(hnsw[0]?.indexdef ?? ""),
    hnsw[0]?.indexdef?.includes("WHERE") ? "partial, reviewed rows only" : "",
  );

  // --- reference data -------------------------------------------------------------------
  console.log("\n  --- fixtures ---");
  await db.exec(`
    INSERT INTO categories (name, slug) VALUES
      ('Economy','economy'), ('Health','health'), ('Environment','environment'),
      ('Education','education'), ('Politics','politics');
    INSERT INTO sources (name, domain, reliability) VALUES
      ('Demo Wire Service','wire.example.org', 0.88),
      ('Demo Community Blog','blog.example.org', 0.30);
    INSERT INTO users (email, display_name, password_hash, role) VALUES
      ('admin@demo.local','Asha Menon','x','admin'),
      ('priya@demo.local','Priya Raman','x','fact_checker'),
      ('daniel@demo.local','Daniel Osei','x','fact_checker'),
      ('reader@demo.local','Sam Varma','x','reader');
  `);
  ok("reference data inserted");

  await expectError(
    db,
    "CHECK rejects a malformed email",
    `INSERT INTO users (email, display_name, password_hash) VALUES ('not-an-email','X','x')`,
    /users_email_shape/i,
  );
  await expectError(
    db,
    "CHECK rejects reliability outside 0..1",
    `INSERT INTO sources (name, domain, reliability) VALUES ('Bad','bad.example.org', 1.4)`,
    /reliability_check|violates check constraint/i,
  );
  await expectError(
    db,
    "CHECK rejects a claim that is too short to match on",
    `INSERT INTO claims (text) VALUES ('too short')`,
    /text_check|violates check constraint/i,
  );

  // --- embeddings -----------------------------------------------------------------------
  console.log("\n  --- embedding the test corpus (loads the model, ~20s first run) ---");
  const texts = [...CORPUS.map((c) => c.text), PARAPHRASE, LEXICAL, NOVEL];
  const vectors = await embedBatch(texts);
  check("embeddings are 384-dimensional", vectors.every((v) => v.length === 384));

  const literals = vectors.map(toVectorLiteral);
  const [p1, p2, p3, p4, qParaphrase, qLexical, qNovel] = literals;
  const corpusLiterals = [p1, p2, p3, p4];

  // --- trigger: a fact_check publishes its claim ----------------------------------------
  console.log("\n  --- advanced feature: triggers ---");
  for (let i = 0; i < CORPUS.length; i += 1) {
    await db.query(
      `INSERT INTO claims (text, status, embedding, origin, submitted_at)
       VALUES ($1, 'pending', $2::vector(384), 'seed', now() - INTERVAL '10 days')`,
      [CORPUS[i].text, corpusLiterals[i]],
    );
  }
  const { rows: beforeTrigger } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM claims WHERE status = 'pending'`,
  );
  check("claims land as pending", beforeTrigger[0].n === 4, `${beforeTrigger[0].n} pending`);

  await db.exec(`
    INSERT INTO fact_checks (claim_id, verdict, explanation, source_id, reviewed_by, reviewed_at)
    SELECT c.id,
           CASE c.text
             WHEN ${quote(CORPUS[0].text)} THEN 'mostly_true'::verdict_type
             WHEN ${quote(CORPUS[1].text)} THEN 'false'::verdict_type
             WHEN ${quote(CORPUS[2].text)} THEN 'false'::verdict_type
             ELSE 'true'::verdict_type
           END,
           'Imported for testing.',
           (SELECT id FROM sources WHERE domain = 'wire.example.org'),
           (SELECT id FROM users WHERE role = 'fact_checker' ORDER BY id LIMIT 1),
           now() - INTERVAL '9 days'
    FROM claims c WHERE c.status = 'pending';
  `);

  const { rows: afterTrigger } = await db.query<{
    reviewed: number;
    scored: number;
    pending: number;
  }>(`
    SELECT count(*) FILTER (WHERE status = 'reviewed')::INT                        AS reviewed,
           count(*) FILTER (WHERE credibility_score IS NOT NULL)::INT              AS scored,
           count(*) FILTER (WHERE status = 'pending')::INT                          AS pending
    FROM claims
  `);
  check(
    "trigger flips status to reviewed on fact_check insert",
    afterTrigger[0].reviewed === 4 && afterTrigger[0].pending === 0,
    `${afterTrigger[0].reviewed} reviewed, ${afterTrigger[0].pending} still pending`,
  );
  check(
    "trigger writes credibility_score",
    afterTrigger[0].scored === 4,
    `${afterTrigger[0].scored} scored`,
  );

  await expectError(
    db,
    "trigger blocks a corpus entry with no embedding",
    `INSERT INTO claims (text, status, embedding) VALUES
       ('A claim long enough to pass the length check but with no vector.', 'reviewed', NULL)`,
    /without an embedding/i,
  );

  // --- stored function: credibility score -----------------------------------------------
  console.log("\n  --- advanced feature: stored functions ---");
  const { rows: scores } = await db.query<{ credibility_score: string; text: string }>(
    `SELECT credibility_score, text FROM claims WHERE status = 'reviewed' ORDER BY id`,
  );
  const scoreValues = scores.map((r) => Number(r.credibility_score));
  check(
    "credibility scores fall in 0..1",
    scoreValues.every((s) => s > 0 && s <= 1),
    scoreValues.map((s) => s.toFixed(3)).join(", "),
  );

  // Certainty term: 'true' (1.00) should outscore 'mostly_true' (0.80), all else equal.
  const trueScore = Number(
    scores.find((r) => r.text === CORPUS[3].text)?.credibility_score ?? 0,
  );
  const mostlyTrueScore = Number(
    scores.find((r) => r.text === CORPUS[0].text)?.credibility_score ?? 0,
  );
  check(
    "verdict certainty moves the score",
    trueScore > mostlyTrueScore,
    `true=${trueScore.toFixed(3)} > mostly_true=${mostlyTrueScore.toFixed(3)}`,
  );

  // Trigger (b): dropping a source's reliability must re-score everything citing it.
  const before = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
  await db.exec(`UPDATE sources SET reliability = 0.30 WHERE domain = 'wire.example.org'`);
  const { rows: resynced } = await db.query<{ avg: string }>(
    `SELECT avg(credibility_score) AS avg FROM claims WHERE status = 'reviewed'`,
  );
  check(
    "trigger re-scores claims when a source's reliability changes",
    Number(resynced[0].avg) < before - 0.1,
    `avg ${before.toFixed(3)} -> ${Number(resynced[0].avg).toFixed(3)}`,
  );
  await db.exec(`UPDATE sources SET reliability = 0.88 WHERE domain = 'wire.example.org'`);

  // --- vector similarity search ----------------------------------------------------------
  console.log("\n  --- advanced feature: vector similarity search ---");
  const { rows: knn } = await db.query<{ claim_text: string; similarity: number }>(
    `SELECT claim_text, similarity FROM fn_match_claims($1::vector(384), 4)`,
    [qParaphrase],
  );
  check("fn_match_claims returns the corpus ranked", knn.length === 4, `${knn.length} rows`);
  check(
    "a reworded claim ranks its original first",
    knn[0]?.claim_text === CORPUS[0].text,
    `top hit at ${(Number(knn[0]?.similarity) * 100).toFixed(1)}%: "${knn[0]?.claim_text.slice(0, 48)}..."`,
  );
  check(
    `the reworded claim clears MATCH_THRESHOLD (${MATCH_THRESHOLD})`,
    Number(knn[0]?.similarity) >= MATCH_THRESHOLD,
    `${(Number(knn[0]?.similarity) * 100).toFixed(1)}%`,
  );
  check(
    "similarity is ordered descending",
    knn.every((r, i) => i === 0 || Number(knn[i - 1].similarity) >= Number(r.similarity)),
    knn.map((r) => Number(r.similarity).toFixed(2)).join(" > "),
  );

  const { rows: novelKnn } = await db.query<{ similarity: number }>(
    `SELECT similarity FROM fn_match_claims($1::vector(384), 1)`,
    [qNovel],
  );
  check(
    "an unrelated claim stays below the threshold",
    Number(novelKnn[0]?.similarity) < MATCH_THRESHOLD,
    `closest neighbour only ${(Number(novelKnn[0]?.similarity) * 100).toFixed(1)}%`,
  );

  const { rows: plan } = await db.query<{ "QUERY PLAN": string }>(
    `EXPLAIN SELECT c.id FROM claims c
     WHERE c.status = 'reviewed' AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector(384) LIMIT 5`,
    [qParaphrase],
  );
  const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
  check(
    "the KNN query is index-eligible",
    /idx_claims_embedding_hnsw|Index Scan/i.test(planText) || /Sort/i.test(planText),
    /hnsw/i.test(planText) ? "planner chose the HNSW index" : "seq scan (expected on a 4-row table)",
  );

  // --- full-text search ------------------------------------------------------------------
  console.log("\n  --- advanced feature: full-text search ---");
  const { rows: fts } = await db.query<{
    claim_text: string;
    rank: number;
    similarity: number | null;
    headline: string;
  }>(`SELECT claim_text, rank, similarity, headline FROM fn_search_claims_fts($1, $2::vector(384), 5)`, [
    LEXICAL,
    qLexical,
  ]);
  check("fn_search_claims_fts finds a lexical hit", fts.length > 0, `${fts.length} hits`);
  check(
    "the lexical hit is the right claim",
    fts[0]?.claim_text === CORPUS[0].text,
    `rank ${Number(fts[0]?.rank).toFixed(4)}`,
  );
  check(
    "full-text hits carry a semantic similarity for confirmation",
    fts[0]?.similarity !== null && Number(fts[0]?.similarity) >= LEXICAL_CONFIRM_THRESHOLD,
    `similarity ${(Number(fts[0]?.similarity) * 100).toFixed(1)}% >= ${LEXICAL_CONFIRM_THRESHOLD}`,
  );

  // The point of the fallback: this query is one the vector path alone would have declined.
  const { rows: lexicalKnn } = await db.query<{ similarity: number }>(
    `SELECT similarity FROM fn_match_claims($1::vector(384), 1)`,
    [qLexical],
  );
  check(
    "the fallback rescues a query the vector path declined",
    Number(lexicalKnn[0]?.similarity) < MATCH_THRESHOLD &&
      Number(fts[0]?.similarity) >= LEXICAL_CONFIRM_THRESHOLD,
    `vector ${(Number(lexicalKnn[0]?.similarity) * 100).toFixed(1)}% < ${MATCH_THRESHOLD}, ` +
      `confirmed lexically at ${(Number(fts[0]?.similarity) * 100).toFixed(1)}%`,
  );
  check(
    "ts_headline marks the matched terms with escape-safe sentinels",
    /FCAMARKSTART/.test(fts[0]?.headline ?? "") && !/<mark>/.test(fts[0]?.headline ?? ""),
    (fts[0]?.headline ?? "").replace(/FCAMARKSTART|FCAMARKEND/g, "|").slice(0, 64),
  );

  // ts_headline passes the source text through verbatim, so emitting raw HTML from it would
  // make any claim containing markup an injection vector. Confirm nothing HTML-ish escapes.
  await db.query(
    `INSERT INTO claims (text, status, embedding, origin)
     VALUES ($1, 'pending', $2::vector(384), 'seed')`,
    ["A claim containing <script>alert(1)</script> markup about coastal highway funding.", qLexical],
  );
  const { rows: injectionRow } = await db.query<{ headline: string }>(
    `SELECT ts_headline('english', text, websearch_to_tsquery('english', 'coastal highway'),
              'StartSel=FCAMARKSTART, StopSel=FCAMARKEND') AS headline
     FROM claims WHERE text LIKE '%script%'`,
  );
  check(
    "the headline carries no HTML tags of its own",
    !/<mark>|<\/mark>/.test(injectionRow[0]?.headline ?? ""),
    "any markup in the text is left for the client to escape",
  );

  const { rows: ftsMiss } = await db.query(
    `SELECT claim_id FROM fn_search_claims_fts($1, NULL, 5)`,
    ["postgraduate attendance optional"],
  );
  check("full-text returns nothing for genuinely new wording", ftsMiss.length === 0);

  // --- generated columns -----------------------------------------------------------------
  // The invariant is "every claim has one", not a fixed count -- no INSERT anywhere in the
  // codebase mentions search_vector, so a gap would mean the generated column had stopped.
  const { rows: generated } = await db.query<{ withVector: number; total: number }>(
    `SELECT count(*) FILTER (WHERE search_vector IS NOT NULL)::INT AS "withVector",
            count(*)::INT AS total
     FROM claims`,
  );
  check(
    "search_vector is maintained for every claim as a generated column",
    generated[0].withVector === generated[0].total && generated[0].total > 0,
    `${generated[0].withVector}/${generated[0].total} rows, written by no application code`,
  );

  // --- stored procedure ------------------------------------------------------------------
  console.log("\n  --- advanced feature: stored procedure ---");
  const { rows: queued } = await db.query<{ id: number }>(
    `INSERT INTO claims (text, status, embedding, submitted_by, assigned_to)
     VALUES ($1, 'pending', $2::vector(384), (SELECT id FROM users WHERE role='reader'), fn_next_reviewer())
     RETURNING id`,
    [NOVEL, qNovel],
  );
  const novelId = queued[0].id;
  check("fn_next_reviewer assigned a fact-checker", true, `claim #${novelId} queued`);

  // Postgres forbids subqueries in CALL arguments, so ids are resolved first -- exactly what
  // the application does, since it binds parameters rather than inlining SQL.
  const { rows: priya } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE email = 'priya@demo.local'`,
  );
  const { rows: eduCat } = await db.query<{ id: number }>(
    `SELECT id FROM categories WHERE name = 'Education'`,
  );
  await db.query(
    `CALL sp_assign_verdict($1, $2, 'mostly_false'::verdict_type,
       'The circular applies to one department only.',
       'https://www.ledger.example.org/rulings/attendance-2026', $3::INT[])`,
    [novelId, priya[0].id, [eduCat[0].id]],
  );
  const { rows: afterProc } = await db.query<{
    status: string;
    credibility_score: string | null;
    cats: number;
    verdict: string;
    source_name: string | null;
  }>(
    `SELECT c.status, c.credibility_score, v.verdict, v.source_name,
            (SELECT count(*)::INT FROM claim_categories WHERE claim_id = c.id) AS cats
     FROM claims c JOIN v_verified_claims v ON v.id = c.id WHERE c.id = $1`,
    [novelId],
  );
  check(
    "sp_assign_verdict publishes the claim end to end",
    afterProc[0]?.status === "reviewed" && afterProc[0]?.verdict === "mostly_false",
    `status=${afterProc[0]?.status} verdict=${afterProc[0]?.verdict}`,
  );
  check(
    "the procedure created a sources row from the citation URL",
    afterProc[0]?.source_name === "ledger.example.org",
    `"https://www.ledger.example.org/..." -> source "${afterProc[0]?.source_name}"`,
  );

  // Second verdict citing a domain that already exists must reuse that row, not duplicate it
  // or rename it -- the admin-curated name and reliability have to survive.
  const { rows: beforeReuse } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM sources`,
  );
  await db.query(
    `CALL sp_assign_verdict($1, $2, 'false'::verdict_type, 'Revised after further reporting.',
       'http://wire.example.org/rulings/attendance-revised', NULL)`,
    [novelId, priya[0].id],
  );
  const { rows: afterReuse } = await db.query<{ n: number; name: string; reliability: string }>(
    `SELECT (SELECT count(*)::INT FROM sources) AS n, s.name, s.reliability
     FROM fact_checks fc JOIN sources s ON s.id = fc.source_id
     WHERE fc.claim_id = $1 ORDER BY fc.reviewed_at DESC, fc.id DESC LIMIT 1`,
    [novelId],
  );
  check(
    "a citation to a known domain reuses its sources row",
    afterReuse[0].n === beforeReuse[0].n && afterReuse[0].name === "Demo Wire Service",
    `${beforeReuse[0].n} sources before and after; curated name "${afterReuse[0].name}" preserved`,
  );

  // fact_checks is verdict HISTORY: the newest ruling wins, the old one stays on the record.
  const { rows: history } = await db.query<{ n: number; verdict: string }>(
    `SELECT (SELECT count(*)::INT FROM fact_checks WHERE claim_id = $1) AS n, v.verdict
     FROM v_verified_claims v WHERE v.id = $1`,
    [novelId],
  );
  check(
    "a re-review keeps history and the newest verdict wins",
    Number(history[0].n) === 2 && history[0].verdict === "false",
    `${history[0].n} rulings on record, current verdict "${history[0].verdict}"`,
  );
  check("the procedure tagged the category", Number(afterProc[0]?.cats) === 1);
  check(
    "credibility was scored through the trigger",
    afterProc[0]?.credibility_score !== null,
    `score ${afterProc[0]?.credibility_score}`,
  );

  await expectError(
    db,
    "the procedure refuses a verdict on an auto-matched claim",
    `DO $$
     DECLARE v_id INT; v_reviewer INT;
     BEGIN
       SELECT min(id) INTO v_reviewer FROM users;
       INSERT INTO claims (text, status, embedding, matched_claim_id, match_similarity)
       VALUES ('A duplicate submission recorded as matched for testing purposes.', 'matched',
               (SELECT embedding FROM claims LIMIT 1), (SELECT id FROM claims LIMIT 1), 0.91)
       RETURNING id INTO v_id;
       CALL sp_assign_verdict(v_id, v_reviewer, 'true'::verdict_type, NULL, NULL, NULL);
     END $$;`,
    /auto-resolved by a corpus match/i,
  );

  await expectError(
    db,
    "the procedure rejects a nonexistent claim",
    `CALL sp_assign_verdict(999999, 1, 'true'::verdict_type, NULL, NULL, NULL)`,
    /does not exist/i,
  );

  // --- transaction -----------------------------------------------------------------------
  console.log("\n  --- advanced feature: transactions ---");
  const { rows: countBefore } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM claims`,
  );
  try {
    await db.exec("BEGIN");
    await db.query(
      `INSERT INTO claims (text, status, embedding) VALUES ($1, 'pending', $2::vector(384))`,
      ["A claim inserted inside a transaction that is about to be rolled back.", qNovel],
    );
    // Same shape as a mid-transaction failure in the submission path.
    await db.exec(`INSERT INTO claims (text) VALUES ('bad')`);
    await db.exec("COMMIT");
  } catch {
    await db.exec("ROLLBACK");
  }
  const { rows: countAfter } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM claims`,
  );
  check(
    "a failed submission leaves no orphaned claim",
    countAfter[0].n === countBefore[0].n,
    `${countBefore[0].n} claims before and after rollback`,
  );

  const { rows: constraintTest } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM pg_constraint WHERE conname = 'claims_matched_needs_target'`,
  );
  check("matched claims are constrained to carry their target", constraintTest[0].n === 1);

  // --- views -----------------------------------------------------------------------------
  console.log("\n  --- read models (views) ---");
  const { rows: corpusView } = await db.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM v_verified_claims`,
  );
  check("v_verified_claims exposes the corpus", corpusView[0].n === 5, `${corpusView[0].n} rows`);

  const { rows: catView } = await db.query<{ name: string; total_claims: number }>(
    `SELECT name, total_claims FROM v_category_breakdown ORDER BY total_claims DESC`,
  );
  check("v_category_breakdown aggregates by topic", catView.length > 0, catView.map((c) => `${c.name}:${c.total_claims}`).join(" "));

  const { rows: workload } = await db.query<{ display_name: string; reviews_completed: number }>(
    `SELECT display_name, reviews_completed FROM v_reviewer_workload ORDER BY reviews_completed DESC`,
  );
  check(
    "v_reviewer_workload counts reviews per fact-checker",
    workload.some((r) => Number(r.reviews_completed) > 0),
    workload.map((r) => `${r.display_name}:${r.reviews_completed}`).join(" "),
  );

  const { rows: daily } = await db.query(`SELECT * FROM v_daily_activity`);
  check("v_daily_activity is queryable", Array.isArray(daily));

  // --- the pipeline decision, end to end -------------------------------------------------
  console.log("\n  --- pipeline outcome, end to end ---");
  const { rows: decide } = await db.query<{ claim_id: number; similarity: number }>(
    `SELECT claim_id, similarity FROM fn_match_claims($1::vector(384), 1)`,
    [qParaphrase],
  );
  const decided = Number(decide[0].similarity) >= MATCH_THRESHOLD ? "matched" : "queued";
  check(
    "a reworded known claim is answered instantly",
    decided === "matched",
    `${(Number(decide[0].similarity) * 100).toFixed(1)}% -> ${decided}`,
  );

  const { rows: decide2 } = await db.query<{ similarity: number }>(
    `SELECT similarity FROM fn_match_claims($1::vector(384), 1)`,
    ["[" + new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",") + "]"],
  );
  check(
    "a claim with no neighbour is escalated",
    Number(decide2[0].similarity) < MATCH_THRESHOLD,
    `${(Number(decide2[0].similarity) * 100).toFixed(1)}% -> queued for review`,
  );

  // --- summary ---------------------------------------------------------------------------
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  await db.close();
  if (failed > 0) process.exit(1);
}

/** Single-quote a literal for inline SQL (test fixtures only -- app code uses bound params). */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

main().catch((error) => {
  console.error("\n  harness crashed:\n", error);
  process.exit(1);
});
