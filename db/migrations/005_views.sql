-- 005_views.sql -- read models. The app never re-derives "what is the current verdict";
-- it asks the view, so the latest-fact-check rule lives in exactly one place.

-- A claim plus its most recent fact-check, flattened. This *is* the corpus.
CREATE OR REPLACE VIEW v_verified_claims AS
SELECT
  c.id,
  c.text,
  c.credibility_score,
  c.origin,
  c.submitted_at,
  c.reviewed_at,
  fc.id            AS fact_check_id,
  fc.verdict,
  fc.explanation,
  fc.source_url,
  s.name           AS source_name,
  s.reliability    AS source_reliability,
  fc.reviewed_by   AS reviewer_id,
  u.display_name   AS reviewer_name,
  COALESCE(cat.names, ARRAY[]::TEXT[]) AS categories
FROM claims c
-- LATERAL + LIMIT 1: picks the newest fact-check per claim without a window function,
-- and lets the planner use idx_fact_checks_claim_id per row.
JOIN LATERAL (
  SELECT f.* FROM fact_checks f
  WHERE f.claim_id = c.id
  ORDER BY f.reviewed_at DESC, f.id DESC
  LIMIT 1
) fc ON TRUE
LEFT JOIN sources s ON s.id = fc.source_id
LEFT JOIN users   u ON u.id = fc.reviewed_by
LEFT JOIN LATERAL (
  SELECT array_agg(ct.name ORDER BY ct.name) AS names
  FROM claim_categories cc
  JOIN categories ct ON ct.id = cc.category_id
  WHERE cc.claim_id = c.id
) cat ON TRUE
WHERE c.status = 'reviewed';

-- Fact-checker leaderboard / load balancing input for the admin dashboard.
CREATE OR REPLACE VIEW v_reviewer_workload AS
SELECT
  u.id,
  u.display_name,
  u.email,
  COUNT(DISTINCT fc.id)                                              AS reviews_completed,
  COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'pending')            AS pending_assigned,
  ROUND(AVG(EXTRACT(EPOCH FROM (fc.reviewed_at - cl.submitted_at))
            / 3600.0)::NUMERIC, 2)                                    AS avg_turnaround_hours
FROM users u
LEFT JOIN fact_checks fc ON fc.reviewed_by = u.id
LEFT JOIN claims      cl ON cl.id = fc.claim_id
LEFT JOIN claims      c  ON c.assigned_to = u.id
WHERE u.role IN ('fact_checker', 'admin')
GROUP BY u.id, u.display_name, u.email;

-- Verdict mix per topic -- powers the admin dashboard's stacked breakdown.
CREATE OR REPLACE VIEW v_category_breakdown AS
SELECT
  ct.id,
  ct.name,
  ct.slug,
  COUNT(*)                                                      AS total_claims,
  COUNT(*) FILTER (WHERE v.verdict IN ('true', 'mostly_true'))  AS true_ish,
  COUNT(*) FILTER (WHERE v.verdict = 'half_true')               AS mixed,
  COUNT(*) FILTER (WHERE v.verdict IN ('mostly_false', 'false', 'pants_on_fire')) AS false_ish,
  ROUND(AVG(v.credibility_score), 3)                            AS avg_credibility
FROM categories ct
JOIN claim_categories cc ON cc.category_id = ct.id
JOIN v_verified_claims v ON v.id = cc.claim_id
GROUP BY ct.id, ct.name, ct.slug;

-- How much work the matcher is saving: instant answers vs. escalations, per day.
CREATE OR REPLACE VIEW v_daily_activity AS
SELECT
  date_trunc('day', submitted_at)::DATE                   AS day,
  COUNT(*)                                                AS submissions,
  COUNT(*) FILTER (WHERE status = 'matched')              AS instant_matches,
  COUNT(*) FILTER (WHERE status = 'pending')              AS awaiting_review,
  COUNT(*) FILTER (WHERE status = 'reviewed')             AS reviewed,
  ROUND(AVG(match_similarity) FILTER (WHERE status = 'matched')::NUMERIC, 3) AS avg_match_similarity
FROM claims
WHERE origin = 'user'
GROUP BY 1;
