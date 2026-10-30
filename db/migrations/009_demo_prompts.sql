-- 009_demo_prompts.sql
-- Demo scaffolding, not part of the core domain model.
--
-- The landing page offers "try one of these" examples. Hard-coding them would be a lie: the
-- interesting behaviour is matching a claim that is WORDED DIFFERENTLY from anything in the
-- corpus, and a hard-coded string drifts out of sync with whatever corpus is actually loaded.
-- So the seeder derives these at load time by rewording real corpus entries and storing the
-- reworded text here, next to the claim it came from.
CREATE TABLE IF NOT EXISTS demo_prompts (
  id              SERIAL PRIMARY KEY,
  prompt          TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('paraphrase', 'novel')),
  -- NULL for 'novel' prompts, which exist to demonstrate the no-match -> review-queue branch.
  source_claim_id INTEGER REFERENCES claims(id) ON DELETE CASCADE,
  CONSTRAINT demo_prompts_paraphrase_has_source
    CHECK (kind <> 'paraphrase' OR source_claim_id IS NOT NULL)
);
