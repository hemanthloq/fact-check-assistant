/**
 * Matcher tuning constants.
 *
 * Kept in their own module (no `server-only`) so the calibration script, the test harness and
 * client components can all read the same numbers the pipeline runs on. If these lived in
 * claims.ts, every consumer would drag in the `pg` pool.
 *
 * These values are measured, not chosen by feel -- see docs/threshold-calibration.md,
 * regenerate with `npm run calibrate`.
 */

/**
 * Cosine similarity a corpus claim must reach before its verdict is returned as the answer to
 * a new submission.
 *
 * On a 400-claim LIAR sample: reworded duplicates score 0.96 (median) and 0.88 at the 5th
 * percentile, while the closest DIFFERENT claim sharing a topic reached only 0.729. The bar is
 * that worst false positive plus a 0.10 margin. It is deliberately NOT the F1-optimal value
 * (0.73) -- wrongly stamping an old verdict onto a new claim is a far worse failure for a
 * fact-checking tool than sending one extra item to a human.
 */
export const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 0.83);

/**
 * Lower bar for a claim surfaced by full-text search, because sharing a rare stem ("rupees",
 * "Rafale", "2347") is independent evidence on top of the cosine score. Set just above the
 * bulk of the same-topic negative distribution: only 1 of 1,473 such pairs reached 0.72, and
 * that pair would also have to share rare keywords to be a candidate at all.
 */
export const LEXICAL_CONFIRM_THRESHOLD = Number(process.env.LEXICAL_CONFIRM_THRESHOLD ?? 0.72);

/**
 * Below the match bar, but close enough to show as "related, not close enough to rule on".
 * Sits above the 95th percentile of same-topic pairs (0.415), so the related list is genuinely
 * on-topic rather than noise.
 */
export const RELATED_THRESHOLD = Number(process.env.RELATED_THRESHOLD ?? 0.45);

export const MIN_CLAIM_LENGTH = 12;
export const MAX_CLAIM_LENGTH = 1000;
