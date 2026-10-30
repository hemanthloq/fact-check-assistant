-- 004_indexes.sql -- the indexes that make the two search paths fast.

-- ADVANCED FEATURE 1 (index half): approximate-nearest-neighbour index for cosine distance.
-- HNSW rather than IVFFlat: IVFFlat needs representative rows present *before* the index is
-- built to pick good centroids, which breaks a "migrate then seed" workflow. HNSW builds
-- incrementally and stays correct on an empty table.
-- Partial index: only reviewed claims are ever searched, so pending/matched rows stay out of
-- the graph. Queries must repeat `WHERE status = 'reviewed'` for the planner to use it.
CREATE INDEX IF NOT EXISTS idx_claims_embedding_hnsw
  ON claims USING hnsw (embedding vector_cosine_ops)
  WHERE status = 'reviewed';

-- ADVANCED FEATURE 2 (index half): GIN over the generated tsvector for the lexical fallback.
CREATE INDEX IF NOT EXISTS idx_claims_search_vector
  ON claims USING gin (search_vector);

-- Trigram index backing the admin corpus browser's substring filter.
CREATE INDEX IF NOT EXISTS idx_claims_text_trgm
  ON claims USING gin (text gin_trgm_ops);

-- Review queue: "pending claims assigned to me, oldest first".
CREATE INDEX IF NOT EXISTS idx_claims_queue
  ON claims (status, submitted_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_claims_assigned_to ON claims (assigned_to);
CREATE INDEX IF NOT EXISTS idx_claims_submitted_by ON claims (submitted_by);
CREATE INDEX IF NOT EXISTS idx_claims_submitted_at ON claims (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_fact_checks_claim_id ON fact_checks (claim_id);
CREATE INDEX IF NOT EXISTS idx_fact_checks_reviewed_by ON fact_checks (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_fact_checks_verdict ON fact_checks (verdict);
CREATE INDEX IF NOT EXISTS idx_claim_categories_category ON claim_categories (category_id);

-- Exact-duplicate guard: a reader re-pasting a claim already sitting in the review queue
-- should join that queue item, not create a second one.
CREATE INDEX IF NOT EXISTS idx_claims_norm_text ON claims (lower(btrim(text)));
