-- 010_provenance.sql
-- Recursive traversal of the one self-reference in the schema: claims.matched_claim_id.
--
-- A matched submission points at the corpus claim that answered it. That target is normally
-- a 'reviewed' claim and the walk ends after one hop -- but nothing in the schema guarantees
-- depth 1, and the chain is the honest answer to "whose ruling am I actually being shown?".
-- A plain join answers that only for a fixed number of hops; WITH RECURSIVE answers it for
-- however many the data holds.

-- Walks from a claim up to the ruling that ultimately answers it.
-- depth 0 is the claim asked about; the last row is the claim that owns the verdict.
CREATE OR REPLACE FUNCTION fn_claim_provenance(p_claim_id INTEGER)
RETURNS TABLE (
  depth            INTEGER,
  claim_id         INTEGER,
  claim_text       TEXT,
  status           claim_status,
  match_similarity REAL,
  submitted_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    -- anchor: the claim itself
    SELECT 0 AS depth, c.id, c.text, c.status, c.match_similarity, c.submitted_at,
           c.matched_claim_id
    FROM claims c
    WHERE c.id = p_claim_id

    UNION ALL

    -- recursive step: follow matched_claim_id to the claim that answered it.
    -- The depth cap is a cycle guard: claims_no_self_match rules out A -> A, but not a
    -- longer ring, and a recursive CTE over a cycle does not terminate on its own.
    SELECT ch.depth + 1, c.id, c.text, c.status, c.match_similarity, c.submitted_at,
           c.matched_claim_id
    FROM chain ch
    JOIN claims c ON c.id = ch.matched_claim_id
    WHERE ch.depth < 16
  )
  SELECT depth, id, claim_text, status, match_similarity, submitted_at
  FROM (SELECT depth, id, text AS claim_text, status, match_similarity, submitted_at
        FROM chain) t
  ORDER BY depth;
$$;

-- How much human work each corpus ruling has saved: one row per reviewed claim, counting the
-- submissions that were answered from it. Recursive so a duplicate that was itself answered
-- from a duplicate still credits the ruling at the root of the chain.
CREATE OR REPLACE VIEW v_ruling_reuse AS
WITH RECURSIVE descent AS (
  -- anchor: every reviewed claim is the root of its own reuse tree
  SELECT c.id AS root_id, c.id AS node_id, 0 AS depth
  FROM claims c
  WHERE c.status = 'reviewed'

  UNION ALL

  -- recursive step: pull in everything that matched against a node already in the tree
  SELECT d.root_id, c.id, d.depth + 1
  FROM descent d
  JOIN claims c ON c.matched_claim_id = d.node_id
  WHERE d.depth < 16
)
SELECT
  root_id                                   AS claim_id,
  COUNT(*) FILTER (WHERE depth > 0)::INT    AS answered_submissions,
  COALESCE(MAX(depth), 0)::INT              AS chain_depth
FROM descent
GROUP BY root_id;
