-- 003_tables.sql -- core relational schema.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE,
  display_name  TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'reader',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_shape CHECK (email LIKE '%_@_%._%')
);

-- Publishers of fact-checks. `reliability` is an admin-curated weight that feeds
-- directly into the credibility score (see 006_functions.sql).
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  name        TEXT         NOT NULL,
  domain      TEXT         NOT NULL UNIQUE,
  reliability NUMERIC(3, 2) NOT NULL DEFAULT 0.50
                CHECK (reliability >= 0 AND reliability <= 1),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS claims (
  id                SERIAL PRIMARY KEY,
  text              TEXT         NOT NULL CHECK (length(btrim(text)) >= 12),
  status            claim_status NOT NULL DEFAULT 'pending',

  -- 384 dimensions = sentence-transformers/all-MiniLM-L6-v2 output size.
  embedding         VECTOR(384),

  submitted_by      INTEGER      REFERENCES users(id)  ON DELETE SET NULL,
  assigned_to       INTEGER      REFERENCES users(id)  ON DELETE SET NULL,

  -- Set only for status='matched': which corpus claim answered this submission, and how close it was.
  matched_claim_id  INTEGER      REFERENCES claims(id) ON DELETE SET NULL,
  match_similarity  REAL         CHECK (match_similarity IS NULL
                                        OR (match_similarity >= -1 AND match_similarity <= 1)),

  -- Written by the trigger in 007, computed by fn_credibility_score().
  credibility_score NUMERIC(4, 3) CHECK (credibility_score IS NULL
                                         OR (credibility_score >= 0 AND credibility_score <= 1)),

  -- Free-text note from the reviewer; the only place a rejection reason is recorded.
  review_note       TEXT,

  origin            TEXT         NOT NULL DEFAULT 'user'
                                 CHECK (origin IN ('user', 'liar', 'seed')),
  submitted_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ,

  -- Generated column: Postgres keeps the lexeme vector in sync with `text` on every write,
  -- so the full-text fallback can never drift out of date.
  search_vector     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,

  CONSTRAINT claims_matched_needs_target CHECK (
    (status <> 'matched') OR (matched_claim_id IS NOT NULL AND match_similarity IS NOT NULL)
  ),
  CONSTRAINT claims_no_self_match CHECK (matched_claim_id IS NULL OR matched_claim_id <> id)
);

CREATE TABLE IF NOT EXISTS fact_checks (
  id          SERIAL PRIMARY KEY,
  claim_id    INTEGER      NOT NULL REFERENCES claims(id)   ON DELETE CASCADE,
  verdict     verdict_type NOT NULL,
  explanation TEXT,
  source_url  TEXT,
  source_id   INTEGER      REFERENCES sources(id) ON DELETE SET NULL,
  reviewed_by INTEGER      REFERENCES users(id)   ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Many-to-many: a claim about vaccine funding is both 'health' and 'politics'.
CREATE TABLE IF NOT EXISTS claim_categories (
  claim_id    INTEGER NOT NULL REFERENCES claims(id)      ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  PRIMARY KEY (claim_id, category_id)
);
