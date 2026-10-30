import "server-only";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "./db";
import { embed, normaliseClaim, toVectorLiteral } from "./embeddings";
import {
  LEXICAL_CONFIRM_THRESHOLD,
  MATCH_THRESHOLD,
  MAX_CLAIM_LENGTH,
  MIN_CLAIM_LENGTH,
  RELATED_THRESHOLD,
} from "./thresholds";
import type {
  ClaimStatus,
  CorpusMatch,
  PipelineStage,
  QueueItem,
  SubmissionResult,
  Verdict,
} from "./types";

export {
  MATCH_THRESHOLD,
  LEXICAL_CONFIRM_THRESHOLD,
  RELATED_THRESHOLD,
  MIN_CLAIM_LENGTH,
  MAX_CLAIM_LENGTH,
} from "./thresholds";

interface MatchRow {
  claim_id: number;
  claim_text: string;
  similarity: number | null;
  rank?: number | null;
  headline?: string | null;
  verdict: Verdict;
  explanation: string | null;
  source_url: string | null;
  source_name: string | null;
  source_reliability: number | null;
  credibility_score: number | null;
  reviewed_at: string;
  categories: string[] | null;
}

function toMatch(row: MatchRow): CorpusMatch {
  return {
    claimId: row.claim_id,
    claimText: row.claim_text,
    similarity: row.similarity === null ? null : Number(row.similarity),
    rank: row.rank === undefined || row.rank === null ? null : Number(row.rank),
    headline: row.headline ?? null,
    verdict: row.verdict,
    explanation: row.explanation,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    sourceReliability: row.source_reliability === null ? null : Number(row.source_reliability),
    credibilityScore: row.credibility_score,
    reviewedAt: row.reviewed_at,
    categories: row.categories ?? [],
  };
}

export class ClaimInputError extends Error {}

export function validateClaimText(raw: string): string {
  const text = normaliseClaim(raw ?? "");
  if (text.length < MIN_CLAIM_LENGTH) {
    throw new ClaimInputError(
      `A claim needs at least ${MIN_CLAIM_LENGTH} characters so there is something to match on.`,
    );
  }
  if (text.length > MAX_CLAIM_LENGTH) {
    throw new ClaimInputError(
      `Keep it under ${MAX_CLAIM_LENGTH} characters - paste the single claim, not the whole article.`,
    );
  }
  return text;
}

/**
 * THE CLAIM PIPELINE.
 *
 *   submit -> embed -> vector search -> match?      -> answer instantly
 *                                   -> no match?    -> full-text fallback
 *                                   -> still none?  -> queue for a human
 *
 * The branch point is the whole point of the system: only submissions that nothing in the
 * corpus can answer cost a fact-checker any time. Everything else is answered from work
 * somebody already did.
 */
export interface SubmitOptions {
  /**
   * Called the moment each stage finishes, before the next one starts. The streaming route
   * handler uses this to push stages to the browser as they complete, so the pipeline the
   * reader watches is the pipeline that actually ran -- not a CSS animation timed to look busy.
   */
  onStage?: (stage: PipelineStage) => void | Promise<void>;
}

export async function submitClaim(
  rawText: string,
  submittedBy: number | null,
  options: SubmitOptions = {},
): Promise<SubmissionResult> {
  const text = validateClaimText(rawText);
  const stages: PipelineStage[] = [];
  const emit = async (stage: PipelineStage) => {
    stages.push(stage);
    await options.onStage?.(stage);
  };

  // --- Stage 1: embed -------------------------------------------------------------------
  const tEmbed = Date.now();
  const vector = await embed(text);
  const literal = toVectorLiteral(vector);
  await emit({
    key: "embed",
    label: "Generate embedding",
    ms: Date.now() - tEmbed,
    detail: `${vector.length}-dim vector via all-MiniLM-L6-v2 (local)`,
    ran: true,
  });

  const corpusSize =
    (
      await queryOne<{ n: number }>(
        `SELECT count(*)::INT AS n FROM claims WHERE status = 'reviewed' AND embedding IS NOT NULL`,
      )
    )?.n ?? 0;

  // --- Stage 2: vector similarity search (ADVANCED FEATURE 1) ---------------------------
  const tVector = Date.now();
  const vectorRows = await query<MatchRow>(`SELECT * FROM fn_match_claims($1::vector(384), 5)`, [
    literal,
  ]);
  const vectorHits = vectorRows.map(toMatch);
  const vectorMs = Date.now() - tVector;
  const best = vectorHits[0] ?? null;
  const bestSimilarity = best?.similarity ?? null;

  await emit({
    key: "vector",
    label: "Vector similarity search",
    ms: vectorMs,
    detail:
      bestSimilarity === null
        ? "corpus is empty - nothing to compare against"
        : `cosine over ${corpusSize.toLocaleString()} claims - closest ${(bestSimilarity * 100).toFixed(1)}%`,
    ran: true,
  });

  // --- Match found: answer instantly, no human touches it ------------------------------
  if (best && bestSimilarity !== null && bestSimilarity >= MATCH_THRESHOLD) {
    await emit({
      key: "fulltext",
      label: "Full-text fallback",
      ms: 0,
      detail: "skipped - vector search already cleared the threshold",
      ran: false,
    });
    const tPersist = Date.now();
    const claimId = await recordMatchedSubmission(text, literal, submittedBy, best, bestSimilarity);
    await emit({
      key: "persist",
      label: "Record submission",
      ms: Date.now() - tPersist,
      detail: `logged as matched to claim #${best.claimId}`,
      ran: true,
    });
    return {
      outcome: "matched",
      claimId,
      text,
      match: best,
      nearMatches: vectorHits.slice(1).filter((m) => (m.similarity ?? 0) >= RELATED_THRESHOLD),
      threshold: MATCH_THRESHOLD,
      stages,
      corpusSize,
      queuePosition: null,
    };
  }

  // --- Stage 3: full-text fallback (ADVANCED FEATURE 2) --------------------------------
  const tFts = Date.now();
  const ftsRows = await query<MatchRow>(
    `SELECT * FROM fn_search_claims_fts($1, $2::vector(384), 5)`,
    [text, literal],
  );
  const ftsHits = ftsRows.map(toMatch);
  const lexicalBest = ftsHits.find((hit) => (hit.similarity ?? 0) >= LEXICAL_CONFIRM_THRESHOLD);
  await emit({
    key: "fulltext",
    label: "Full-text fallback",
    ms: Date.now() - tFts,
    detail:
      ftsHits.length === 0
        ? "no lexical overlap with the corpus either"
        : `${ftsHits.length} keyword hit${ftsHits.length === 1 ? "" : "s"}` +
          (lexicalBest
            ? ` - one confirmed at ${((lexicalBest.similarity ?? 0) * 100).toFixed(1)}% similarity`
            : " - none cleared the semantic floor"),
    ran: true,
  });

  if (lexicalBest) {
    const tPersist = Date.now();
    const similarity = lexicalBest.similarity ?? LEXICAL_CONFIRM_THRESHOLD;
    const claimId = await recordMatchedSubmission(
      text,
      literal,
      submittedBy,
      lexicalBest,
      similarity,
    );
    await emit({
      key: "persist",
      label: "Record submission",
      ms: Date.now() - tPersist,
      detail: `logged as matched to claim #${lexicalBest.claimId}`,
      ran: true,
    });
    return {
      outcome: "matched_lexical",
      claimId,
      text,
      match: lexicalBest,
      nearMatches: vectorHits.filter(
        (m) => m.claimId !== lexicalBest.claimId && (m.similarity ?? 0) >= RELATED_THRESHOLD,
      ),
      threshold: LEXICAL_CONFIRM_THRESHOLD,
      stages,
      corpusSize,
      queuePosition: null,
    };
  }

  // --- No match: queue it for a human --------------------------------------------------
  const tPersist = Date.now();
  const queued = await queueClaim(text, literal, submittedBy);
  await emit({
    key: "persist",
    label: "Queue for review",
    ms: Date.now() - tPersist,
    detail: queued.alreadyQueued
      ? `identical claim was already queued as #${queued.claimId}`
      : `claim #${queued.claimId} assigned to a fact-checker`,
    ran: true,
  });

  return {
    outcome: queued.alreadyQueued ? "already_queued" : "queued",
    claimId: queued.claimId,
    text,
    match: null,
    nearMatches: vectorHits.filter((m) => (m.similarity ?? 0) >= RELATED_THRESHOLD),
    threshold: MATCH_THRESHOLD,
    stages,
    corpusSize,
    queuePosition: queued.queuePosition,
  };
}

/**
 * Logs a submission that the corpus answered. The row is stored with status='matched', which
 * keeps it OUT of the searchable corpus - only reviewed claims are ever searched, so a
 * duplicate submission can never become a second, verdict-less answer to a later query.
 * It is still worth storing: it is what makes the "instant answers vs. escalations" analytics
 * (and therefore the whole argument for this design) measurable.
 */
async function recordMatchedSubmission(
  text: string,
  literal: string,
  submittedBy: number | null,
  match: CorpusMatch,
  similarity: number,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO claims (text, status, embedding, submitted_by, matched_claim_id, match_similarity)
     VALUES ($1, 'matched', $2::vector(384), $3, $4, $5)
     RETURNING id`,
    [text, literal, submittedBy, match.claimId, similarity],
  );
  return row!.id;
}

/**
 * ADVANCED FEATURE 5 - transaction.
 *
 * Four statements that have to agree with each other: is this already queued, who has the
 * shortest queue, insert the claim, assign it. Wrapped in BEGIN/COMMIT with a FOR UPDATE
 * lock on the chosen reviewer, so two readers submitting at the same instant cannot both be
 * handed to the same fact-checker on the basis of the same stale queue count.
 */
async function queueClaim(
  text: string,
  literal: string,
  submittedBy: number | null,
): Promise<{ claimId: number; alreadyQueued: boolean; queuePosition: number | null }> {
  return withTransaction(async (client: PoolClient) => {
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM claims
       WHERE status = 'pending' AND lower(btrim(text)) = lower(btrim($1))
       LIMIT 1`,
      [text],
    );
    if (existing.rows.length > 0) {
      const claimId = existing.rows[0].id;
      return { claimId, alreadyQueued: true, queuePosition: await position(client, claimId) };
    }

    // Pick the least-loaded fact-checker, then take a row lock on them. The lock has to be a
    // second statement because Postgres rejects FOR UPDATE alongside an aggregate.
    const candidate = await client.query<{ id: number | null }>(`SELECT fn_next_reviewer() AS id`);
    let assignedTo: number | null = candidate.rows[0]?.id ?? null;
    if (assignedTo !== null) {
      const locked = await client.query<{ id: number }>(
        `SELECT id FROM users WHERE id = $1 AND role = 'fact_checker' FOR UPDATE`,
        [assignedTo],
      );
      if (locked.rows.length === 0) assignedTo = null; // demoted mid-flight
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO claims (text, status, embedding, submitted_by, assigned_to)
       VALUES ($1, 'pending', $2::vector(384), $3, $4)
       RETURNING id`,
      [text, literal, submittedBy, assignedTo],
    );
    const claimId = inserted.rows[0].id;
    return { claimId, alreadyQueued: false, queuePosition: await position(client, claimId) };
  });
}

async function position(client: PoolClient, claimId: number): Promise<number | null> {
  const row = await client.query<{ n: number }>(
    `SELECT count(*)::INT AS n FROM claims
     WHERE status = 'pending'
       AND submitted_at <= (SELECT submitted_at FROM claims WHERE id = $1)`,
    [claimId],
  );
  return row.rows[0]?.n ?? null;
}

/** Ad-hoc semantic search over the corpus - the same vector path, without recording anything. */
export async function searchCorpus(rawQuery: string, limit = 10): Promise<CorpusMatch[]> {
  const text = normaliseClaim(rawQuery);
  if (text.length < 3) return [];
  const literal = toVectorLiteral(await embed(text));
  const rows = await query<MatchRow>(`SELECT * FROM fn_match_claims($1::vector(384), $2)`, [
    literal,
    limit,
  ]);
  return rows.map(toMatch);
}

export interface ClaimDetail {
  id: number;
  text: string;
  status: ClaimStatus;
  submittedAt: string;
  reviewedAt: string | null;
  credibilityScore: number | null;
  matchSimilarity: number | null;
  matchedClaimId: number | null;
  reviewNote: string | null;
  origin: string;
  submittedByName: string | null;
  assignedToName: string | null;
  categories: string[];
  history: {
    id: number;
    verdict: Verdict;
    explanation: string | null;
    source_url: string | null;
    source_name: string | null;
    source_reliability: number | null;
    reviewer_name: string | null;
    reviewed_at: string;
  }[];
}

export async function getClaim(id: number): Promise<ClaimDetail | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT c.id, c.text, c.status, c.submitted_at, c.reviewed_at, c.credibility_score,
            c.match_similarity, c.matched_claim_id, c.review_note, c.origin,
            su.display_name AS submitted_by_name,
            au.display_name AS assigned_to_name,
            COALESCE(
              (SELECT array_agg(ct.name ORDER BY ct.name)
               FROM claim_categories cc JOIN categories ct ON ct.id = cc.category_id
               WHERE cc.claim_id = c.id),
              ARRAY[]::TEXT[]
            ) AS categories,
            COALESCE(
              (SELECT json_agg(h ORDER BY h.reviewed_at DESC, h.id DESC)
               FROM (
                 SELECT fc.id, fc.verdict, fc.explanation, fc.source_url, fc.reviewed_at,
                        s.name AS source_name, s.reliability AS source_reliability,
                        ru.display_name AS reviewer_name
                 FROM fact_checks fc
                 LEFT JOIN sources s ON s.id = fc.source_id
                 LEFT JOIN users   ru ON ru.id = fc.reviewed_by
                 WHERE fc.claim_id = c.id
               ) h),
              '[]'::json
            ) AS history
     FROM claims c
     LEFT JOIN users su ON su.id = c.submitted_by
     LEFT JOIN users au ON au.id = c.assigned_to
     WHERE c.id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id as number,
    text: row.text as string,
    status: row.status as ClaimStatus,
    submittedAt: String(row.submitted_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    credibilityScore: (row.credibility_score as number | null) ?? null,
    matchSimilarity: row.match_similarity === null ? null : Number(row.match_similarity),
    matchedClaimId: (row.matched_claim_id as number | null) ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
    origin: row.origin as string,
    submittedByName: (row.submitted_by_name as string | null) ?? null,
    assignedToName: (row.assigned_to_name as string | null) ?? null,
    categories: (row.categories as string[]) ?? [],
    history: (row.history as ClaimDetail["history"]) ?? [],
  };
}

/**
 * The review queue. Each item carries its closest corpus neighbour, so a fact-checker can see
 * at a glance WHY the matcher gave up - "nothing even close" and "0.74, just under the bar"
 * are very different review tasks.
 */
export async function listQueue(limit = 50): Promise<QueueItem[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT c.id, c.text, c.submitted_at,
            su.display_name AS submitted_by,
            au.display_name AS assigned_to,
            n.similarity    AS top_similarity,
            n.text          AS top_text
     FROM claims c
     LEFT JOIN users su ON su.id = c.submitted_by
     LEFT JOIN users au ON au.id = c.assigned_to
     LEFT JOIN LATERAL (
       SELECT r.text, (1 - (r.embedding <=> c.embedding))::REAL AS similarity
       FROM claims r
       WHERE r.status = 'reviewed' AND r.embedding IS NOT NULL AND c.embedding IS NOT NULL
       ORDER BY r.embedding <=> c.embedding
       LIMIT 1
     ) n ON TRUE
     WHERE c.status = 'pending'
     ORDER BY c.submitted_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id as number,
    text: row.text as string,
    submittedAt: String(row.submitted_at),
    submittedBy: (row.submitted_by as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null,
    topNeighbourSimilarity: row.top_similarity === null ? null : Number(row.top_similarity),
    topNeighbourText: (row.top_text as string | null) ?? null,
  }));
}

/** ADVANCED FEATURE 3+4 in one call: the procedure files the verdict, the trigger publishes it. */
export async function assignVerdict(input: {
  claimId: number;
  reviewerId: number;
  verdict: Verdict;
  explanation: string | null;
  sourceUrl: string | null;
  categoryIds: number[];
}): Promise<void> {
  await query(`CALL sp_assign_verdict($1, $2, $3::verdict_type, $4, $5, $6::INT[])`, [
    input.claimId,
    input.reviewerId,
    input.verdict,
    input.explanation,
    input.sourceUrl,
    input.categoryIds.length > 0 ? input.categoryIds : null,
  ]);
}

export async function rejectClaim(claimId: number, reviewerId: number, reason: string | null) {
  await query(`CALL sp_reject_claim($1, $2, $3)`, [claimId, reviewerId, reason]);
}

export async function listCategories(): Promise<{ id: number; name: string; slug: string }[]> {
  return query(`SELECT id, name, slug FROM categories ORDER BY name`);
}

/** Paginated corpus browser, optionally filtered by verdict / category / substring. */
export async function browseCorpus(opts: {
  verdict?: Verdict | null;
  category?: string | null;
  contains?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CorpusMatch[]; total: number }> {
  const limit = Math.min(opts.limit ?? 24, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [opts.verdict ?? null, opts.category ?? null, opts.contains ?? null];

  const filters = `
    WHERE ($1::verdict_type IS NULL OR v.verdict = $1::verdict_type)
      AND ($2::TEXT IS NULL OR $2 = ANY (v.categories))
      AND ($3::TEXT IS NULL OR v.text ILIKE '%' || $3 || '%')`;

  const totalRow = await queryOne<{ n: number }>(
    `SELECT count(*)::INT AS n FROM v_verified_claims v ${filters}`,
    params,
  );

  const rows = await query<MatchRow>(
    `SELECT v.id AS claim_id, v.text AS claim_text, NULL::REAL AS similarity,
            v.verdict, v.explanation, v.source_url, v.source_name, v.source_reliability,
            v.credibility_score, v.reviewed_at, v.categories
     FROM v_verified_claims v
     ${filters}
     ORDER BY v.reviewed_at DESC, v.id DESC
     LIMIT $4 OFFSET $5`,
    [...params, limit, offset],
  );

  return { rows: rows.map(toMatch), total: totalRow?.n ?? 0 };
}
