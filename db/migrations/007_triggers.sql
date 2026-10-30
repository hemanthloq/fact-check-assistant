-- 007_triggers.sql
-- ADVANCED FEATURE 4: triggers.

-- (a) When a fact-check lands, the claim becomes part of the corpus. Doing this in a
--     trigger instead of the API means a claim can never sit in 'pending' with a verdict
--     attached, no matter which client wrote the row (app, psql, seed script).
CREATE OR REPLACE FUNCTION trg_fact_check_applied()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE claims
  SET status            = 'reviewed',
      reviewed_at       = NEW.reviewed_at,
      credibility_score = fn_credibility_score(NEW.claim_id),
      assigned_to       = COALESCE(assigned_to, NEW.reviewed_by)
  WHERE id = NEW.claim_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fact_check_applied ON fact_checks;
CREATE TRIGGER fact_check_applied
  AFTER INSERT ON fact_checks
  FOR EACH ROW EXECUTE FUNCTION trg_fact_check_applied();

-- (b) Editing a source's reliability must not leave stale credibility scores behind:
--     the score is 50% source reliability. Re-score every claim that cites that source.
CREATE OR REPLACE FUNCTION trg_resync_credibility_on_source_change()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE claims c
  SET credibility_score = fn_credibility_score(c.id)
  WHERE c.status = 'reviewed'
    AND EXISTS (SELECT 1 FROM fact_checks fc
                WHERE fc.claim_id = c.id AND fc.source_id = NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS source_reliability_changed ON sources;
CREATE TRIGGER source_reliability_changed
  AFTER UPDATE OF reliability ON sources
  FOR EACH ROW
  WHEN (OLD.reliability IS DISTINCT FROM NEW.reliability)
  EXECUTE FUNCTION trg_resync_credibility_on_source_change();

-- (c) Guard rail: a claim may only enter the corpus with an embedding, otherwise the
--     vector index would silently skip it and it would be invisible to every future search.
CREATE OR REPLACE FUNCTION trg_require_embedding_for_corpus()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'reviewed' AND NEW.embedding IS NULL THEN
    RAISE EXCEPTION
      'claim % cannot be marked reviewed without an embedding (it would be unsearchable)',
      NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS require_embedding_for_corpus ON claims;
CREATE TRIGGER require_embedding_for_corpus
  BEFORE INSERT OR UPDATE OF status, embedding ON claims
  FOR EACH ROW EXECUTE FUNCTION trg_require_embedding_for_corpus();
