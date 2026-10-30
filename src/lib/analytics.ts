import "server-only";
import { query, queryOne } from "./db";
import type { Verdict } from "./types";

export interface Totals {
  corpusSize: number;
  pending: number;
  rejected: number;
  userSubmissions: number;
  instantMatches: number;
  /** Share of reader submissions the corpus answered without a human. The headline number. */
  matchRate: number;
  avgCredibility: number | null;
  avgMatchSimilarity: number | null;
  users: number;
  factCheckers: number;
  sources: number;
  categories: number;
  factChecks: number;
}

export interface AdminStats {
  totals: Totals;
  verdictMix: { verdict: Verdict; label: string; count: number }[];
  categories: {
    name: string;
    slug: string;
    total_claims: number;
    true_ish: number;
    mixed: number;
    false_ish: number;
    avg_credibility: number | null;
  }[];
  reviewers: {
    id: number;
    display_name: string;
    email: string;
    reviews_completed: number;
    pending_assigned: number;
    avg_turnaround_hours: number | null;
  }[];
  activity: {
    day: string;
    submissions: number;
    instant_matches: number;
    awaiting_review: number;
  }[];
  similarityBuckets: { bucket: string; count: number }[];
  sources: { id: number; name: string; domain: string; reliability: number; citations: number }[];
}

const VERDICT_LABELS: Record<Verdict, string> = {
  true: "True",
  mostly_true: "Mostly true",
  half_true: "Half true",
  mostly_false: "Mostly false",
  false: "False",
  pants_on_fire: "Pants on fire",
};

export async function getAdminStats(): Promise<AdminStats> {
  // One round trip per widget, run concurrently on separate pool connections.
  const [totals, verdictMix, categories, reviewers, activity, similarityBuckets, sources] =
    await Promise.all([
      queryOne<Record<string, number | null>>(`
        SELECT
          (SELECT count(*) FROM claims WHERE status = 'reviewed')                      AS corpus_size,
          (SELECT count(*) FROM claims WHERE status = 'pending')                       AS pending,
          (SELECT count(*) FROM claims WHERE status = 'rejected')                      AS rejected,
          (SELECT count(*) FROM claims WHERE origin = 'user')                          AS user_submissions,
          (SELECT count(*) FROM claims WHERE status = 'matched')                        AS instant_matches,
          (SELECT avg(credibility_score) FROM claims WHERE status = 'reviewed')         AS avg_credibility,
          (SELECT avg(match_similarity) FROM claims WHERE status = 'matched')           AS avg_match_similarity,
          (SELECT count(*) FROM users)                                                  AS users,
          (SELECT count(*) FROM users WHERE role = 'fact_checker')                      AS fact_checkers,
          (SELECT count(*) FROM sources)                                                AS sources,
          (SELECT count(*) FROM categories)                                             AS categories,
          (SELECT count(*) FROM fact_checks)                                             AS fact_checks
      `),

      query<{ verdict: Verdict; count: number }>(`
        SELECT verdict, count(*)::INT AS count
        FROM v_verified_claims
        GROUP BY verdict
      `),

      query<AdminStats["categories"][number]>(`
        SELECT name, slug, total_claims, true_ish, mixed, false_ish, avg_credibility
        FROM v_category_breakdown
        ORDER BY total_claims DESC
        LIMIT 12
      `),

      query<AdminStats["reviewers"][number]>(`
        SELECT id, display_name, email, reviews_completed, pending_assigned, avg_turnaround_hours
        FROM v_reviewer_workload
        ORDER BY reviews_completed DESC, display_name
      `),

      // generate_series keeps days with zero traffic in the series, so the chart does not
      // silently compress a quiet week into a straight line between two busy days.
      query<AdminStats["activity"][number]>(`
        WITH days AS (
          SELECT generate_series(
            (current_date - INTERVAL '29 days')::DATE, current_date, INTERVAL '1 day'
          )::DATE AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD')                   AS day,
               COALESCE(a.submissions, 0)::INT                AS submissions,
               COALESCE(a.instant_matches, 0)::INT            AS instant_matches,
               COALESCE(a.awaiting_review, 0)::INT            AS awaiting_review
        FROM days d
        LEFT JOIN v_daily_activity a ON a.day = d.day
        ORDER BY d.day
      `),

      // generate_series keeps EMPTY bins in the result. Without it the chart receives only the
      // bins that had matches and spaces them evenly, so the x-axis silently stops being a
      // similarity scale -- two bars three bins apart would render side by side.
      query<{ bucket: string; count: number }>(`
        WITH bins AS (SELECT generate_series(1, 8) AS b)
        SELECT to_char(0.6 + (bins.b - 1) * 0.05, '0.00') || '-' ||
               to_char(0.6 + bins.b * 0.05, '0.00')        AS bucket,
               COALESCE(hits.n, 0)::INT                     AS count
        FROM bins
        LEFT JOIN (
          SELECT width_bucket(match_similarity, 0.6, 1.0, 8) AS b, count(*) AS n
          FROM claims
          WHERE status = 'matched' AND match_similarity IS NOT NULL
          GROUP BY 1
        ) hits ON hits.b = bins.b
        ORDER BY bins.b
      `),

      query<AdminStats["sources"][number]>(`
        SELECT s.id, s.name, s.domain, s.reliability,
               count(fc.id)::INT AS citations
        FROM sources s
        LEFT JOIN fact_checks fc ON fc.source_id = s.id
        GROUP BY s.id, s.name, s.domain, s.reliability
        ORDER BY citations DESC, s.name
        LIMIT 15
      `),
    ]);

  const userSubmissions = Number(totals?.user_submissions ?? 0);
  const instantMatches = Number(totals?.instant_matches ?? 0);

  return {
    totals: {
      corpusSize: Number(totals?.corpus_size ?? 0),
      pending: Number(totals?.pending ?? 0),
      rejected: Number(totals?.rejected ?? 0),
      userSubmissions,
      instantMatches,
      matchRate: userSubmissions > 0 ? instantMatches / userSubmissions : 0,
      avgCredibility: totals?.avg_credibility === null ? null : Number(totals?.avg_credibility),
      avgMatchSimilarity:
        totals?.avg_match_similarity === null ? null : Number(totals?.avg_match_similarity),
      users: Number(totals?.users ?? 0),
      factCheckers: Number(totals?.fact_checkers ?? 0),
      sources: Number(totals?.sources ?? 0),
      categories: Number(totals?.categories ?? 0),
      factChecks: Number(totals?.fact_checks ?? 0),
    },
    verdictMix: (Object.keys(VERDICT_LABELS) as Verdict[]).map((verdict) => ({
      verdict,
      label: VERDICT_LABELS[verdict],
      count: Number(verdictMix.find((row) => row.verdict === verdict)?.count ?? 0),
    })),
    categories,
    reviewers,
    activity,
    similarityBuckets: similarityBuckets.map((row) => ({
      bucket: row.bucket?.replace(/\s/g, "") ?? "",
      count: Number(row.count),
    })),
    sources,
  };
}

/** Lightweight counts for the public landing page. */
export async function getPublicStats(): Promise<{
  corpusSize: number;
  pending: number;
  instantMatches: number;
  matchRate: number;
}> {
  const row = await queryOne<Record<string, number | null>>(`
    SELECT
      (SELECT count(*) FROM claims WHERE status = 'reviewed')  AS corpus_size,
      (SELECT count(*) FROM claims WHERE status = 'pending')   AS pending,
      (SELECT count(*) FROM claims WHERE status = 'matched')   AS instant_matches,
      (SELECT count(*) FROM claims WHERE origin = 'user')      AS user_submissions
  `);
  const submissions = Number(row?.user_submissions ?? 0);
  const matches = Number(row?.instant_matches ?? 0);
  return {
    corpusSize: Number(row?.corpus_size ?? 0),
    pending: Number(row?.pending ?? 0),
    instantMatches: matches,
    matchRate: submissions > 0 ? matches / submissions : 0,
  };
}
