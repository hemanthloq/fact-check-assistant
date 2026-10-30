-- 008_procedures.sql
-- ADVANCED FEATURE 5: a true stored PROCEDURE (CALL-able, owns its own transaction
-- boundary) wrapping the whole reviewer action. One round trip does: row lock ->
-- source upsert -> verdict insert -> category tagging, and the trigger from 007 then
-- flips status and writes the credibility score. Either all of it happens or none of it.

CREATE OR REPLACE PROCEDURE sp_assign_verdict(
  p_claim_id     INTEGER,
  p_reviewer_id  INTEGER,
  p_verdict      verdict_type,
  p_explanation  TEXT,
  p_source_url   TEXT,
  p_category_ids INTEGER[] DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
  v_locked_id INTEGER;
  v_status    claim_status;
  v_domain    TEXT;
  v_source_id INTEGER;
BEGIN
  -- FOR UPDATE: two fact-checkers opening the same queue item cannot both file a verdict;
  -- the second one blocks here, then sees status='reviewed' and is told to refresh.
  SELECT id, status INTO v_locked_id, v_status
  FROM claims WHERE id = p_claim_id FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'claim % does not exist', p_claim_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status = 'matched' THEN
    RAISE EXCEPTION 'claim % was auto-resolved by a corpus match; nothing to review',
      p_claim_id USING ERRCODE = 'check_violation';
  END IF;

  -- Normalise the citation into a `sources` row so reliability weighting has something
  -- to attach to. Admins can then tune that one row and every score re-syncs (trigger b).
  IF p_source_url IS NOT NULL AND btrim(p_source_url) <> '' THEN
    v_domain := lower(regexp_replace(btrim(p_source_url),
                  '^(https?://)?(www\.)?([^/:?#]+).*$', '\3'));
    IF v_domain <> '' THEN
      INSERT INTO sources (name, domain)
      VALUES (v_domain, v_domain)
      ON CONFLICT (domain) DO UPDATE SET domain = EXCLUDED.domain
      RETURNING id INTO v_source_id;
    END IF;
  END IF;

  INSERT INTO fact_checks (claim_id, verdict, explanation, source_url, source_id, reviewed_by)
  VALUES (p_claim_id, p_verdict, NULLIF(btrim(p_explanation), ''),
          NULLIF(btrim(p_source_url), ''), v_source_id, p_reviewer_id);

  IF p_category_ids IS NOT NULL AND array_length(p_category_ids, 1) > 0 THEN
    INSERT INTO claim_categories (claim_id, category_id)
    SELECT p_claim_id, cid FROM unnest(p_category_ids) AS cid
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Not every submission is a checkable factual claim. Rejecting keeps it out of the
-- corpus (so it can never answer a future query) while preserving the audit trail --
-- no fact_checks row is written, because a rejection is not a ruling on the facts.
CREATE OR REPLACE PROCEDURE sp_reject_claim(
  p_claim_id    INTEGER,
  p_reviewer_id INTEGER,
  p_reason      TEXT DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE v_status claim_status;
BEGIN
  SELECT status INTO v_status FROM claims WHERE id = p_claim_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'claim % does not exist', p_claim_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'claim % is %, only pending claims can be rejected',
      p_claim_id, v_status USING ERRCODE = 'check_violation';
  END IF;

  UPDATE claims
  SET status      = 'rejected',
      reviewed_at = now(),
      assigned_to = p_reviewer_id,
      review_note = NULLIF(btrim(p_reason), '')
  WHERE id = p_claim_id;
END $$;
