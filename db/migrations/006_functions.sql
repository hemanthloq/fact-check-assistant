-- 006_functions.sql
-- ADVANCED FEATURE 3: stored routines. The two search paths and the credibility model
-- live in the database, not in TypeScript -- the app passes a vector in and gets ranked
-- rows back, so the ranking rules cannot be reimplemented differently by a second client.

-- ---------------------------------------------------------------------------
-- Credibility score: how much should a reader trust THIS verdict?
--   50% publisher reliability -- a PolitiFact ruling outranks a random blog
--   30% recency               -- exponential decay, 2-year half-life
--   20% verdict certainty     -- 'half_true' is inherently a hedge; 'true'/'false' are not
-- Returns NULL for a claim with no fact-check yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_credibility_score(p_claim_id INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_verdict     verdict_type;
  v_reviewed_at TIMESTAMPTZ;
  v_reliability NUMERIC;
  v_certainty   NUMERIC;
  v_recency     NUMERIC;
  v_age_days    NUMERIC;
BEGIN
  SELECT fc.verdict, fc.reviewed_at, COALESCE(s.reliability, 0.50)
    INTO v_verdict, v_reviewed_at, v_reliability
  FROM fact_checks fc
  LEFT JOIN sources s ON s.id = fc.source_id
  WHERE fc.claim_id = p_claim_id
  ORDER BY fc.reviewed_at DESC, fc.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_certainty := CASE v_verdict
    WHEN 'true'          THEN 1.00
    WHEN 'pants_on_fire' THEN 1.00
    WHEN 'false'         THEN 0.95
    WHEN 'mostly_true'   THEN 0.80
    WHEN 'mostly_false'  THEN 0.80
    WHEN 'half_true'     THEN 0.55
    ELSE 0.50
  END;

  v_age_days := GREATEST(EXTRACT(EPOCH FROM (now() - v_reviewed_at)) / 86400.0, 0);
  v_recency  := exp(-0.00094946 * v_age_days);   -- ln(2) / 730 days

  RETURN ROUND(
    LEAST(GREATEST(0.50 * v_reliability + 0.30 * v_recency + 0.20 * v_certainty, 0), 1),
    3
  );
END $$;

-- ---------------------------------------------------------------------------
-- ADVANCED FEATURE 1: vector similarity search.
-- The KNN scan is isolated in a CTE so the ORDER BY <=> / LIMIT sits directly on the
-- `claims` scan -- that is the shape the HNSW index can serve. Joining the view first
-- would force a sequential scan + sort over the whole corpus.
-- `<=>` is cosine distance, so similarity = 1 - distance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_match_claims(
  p_embedding VECTOR(384),
  p_limit     INTEGER DEFAULT 5
)
RETURNS TABLE (
  claim_id          INTEGER,
  claim_text        TEXT,
  similarity        REAL,
  verdict           verdict_type,
  explanation       TEXT,
  source_url        TEXT,
  source_name       TEXT,
  credibility_score NUMERIC,
  source_reliability NUMERIC,
  reviewed_at       TIMESTAMPTZ,
  categories        TEXT[]
)
LANGUAGE sql STABLE AS $$
  WITH knn AS (
    SELECT c.id, (1 - (c.embedding <=> p_embedding))::REAL AS similarity
    FROM claims c
    WHERE c.status = 'reviewed' AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_embedding
    LIMIT p_limit
  )
  SELECT v.id, v.text, k.similarity, v.verdict, v.explanation, v.source_url,
         v.source_name, v.credibility_score, v.source_reliability, v.reviewed_at, v.categories
  FROM knn k
  JOIN v_verified_claims v ON v.id = k.id
  ORDER BY k.similarity DESC;
$$;

-- ---------------------------------------------------------------------------
-- ADVANCED FEATURE 2: full-text search fallback.
-- Runs when the vector path finds nothing above threshold. Catches the case embeddings
-- are weakest at: a rare proper noun or figure that carries the whole claim
-- ("Bill 2347", "Rafale", "$47 billion") where the sentence otherwise reads generic.
-- websearch_to_tsquery accepts reader-style input (quoted phrases, OR, -negation).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_search_claims_fts(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION fn_search_claims_fts(
  p_query     TEXT,
  p_embedding VECTOR(384) DEFAULT NULL,
  p_limit     INTEGER DEFAULT 5
)
RETURNS TABLE (
  claim_id          INTEGER,
  claim_text        TEXT,
  rank              REAL,
  similarity        REAL,
  headline          TEXT,
  verdict           verdict_type,
  explanation       TEXT,
  source_url        TEXT,
  source_name       TEXT,
  credibility_score NUMERIC,
  source_reliability NUMERIC,
  reviewed_at       TIMESTAMPTZ,
  categories        TEXT[]
)
LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq),
  hits AS (
    SELECT c.id,
           ts_rank_cd(c.search_vector, q.tsq) AS rank,
           -- Lexical hits still get scored semantically when the caller passes the query
           -- embedding: FTS proposes the candidates, cosine similarity confirms them.
           CASE WHEN p_embedding IS NULL OR c.embedding IS NULL THEN NULL
                ELSE (1 - (c.embedding <=> p_embedding))::REAL END AS similarity,
           -- Alphanumeric sentinels, not raw <mark>: ts_headline does not escape the source
           -- text, so emitting HTML here would make any claim containing markup an injection
           -- vector. The client escapes the whole string, then swaps these for <mark>.
           ts_headline('english', c.text, q.tsq,
                       'StartSel=FCAMARKSTART, StopSel=FCAMARKEND, MaxFragments=1, MaxWords=28, MinWords=8') AS headline
    FROM claims c, q
    WHERE c.status = 'reviewed'
      AND q.tsq IS NOT NULL
      AND c.search_vector @@ q.tsq
    ORDER BY rank DESC
    LIMIT p_limit
  )
  SELECT v.id, v.text, h.rank, h.similarity, h.headline, v.verdict, v.explanation,
         v.source_url, v.source_name, v.credibility_score, v.source_reliability,
         v.reviewed_at, v.categories
  FROM hits h
  JOIN v_verified_claims v ON v.id = h.id
  ORDER BY h.rank DESC;
$$;

-- ---------------------------------------------------------------------------
-- Round-robin-ish reviewer assignment: whoever currently has the shortest queue.
-- Called inside the submission transaction, so a burst of submissions spreads out
-- instead of all landing on user id 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_next_reviewer()
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT u.id
  FROM users u
  LEFT JOIN claims c ON c.assigned_to = u.id AND c.status = 'pending'
  WHERE u.role = 'fact_checker'
  GROUP BY u.id
  ORDER BY COUNT(c.id) ASC, u.id ASC
  LIMIT 1;
$$;
