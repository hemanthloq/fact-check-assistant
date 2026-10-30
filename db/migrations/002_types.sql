-- 002_types.sql -- enumerated domains, so invalid states are unrepresentable in the DB itself.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('reader', 'fact_checker', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- pending  : no close match found, waiting on a human fact-checker
-- reviewed : has a verdict -> part of the searchable corpus
-- matched  : resolved instantly against an existing reviewed claim (never enters the corpus)
-- rejected : not a checkable factual claim (opinion, gibberish, duplicate spam)
DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM ('pending', 'reviewed', 'matched', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mirrors the PolitiFact / LIAR truth scale so the bootstrapped corpus maps 1:1.
DO $$ BEGIN
  CREATE TYPE verdict_type AS ENUM (
    'true', 'mostly_true', 'half_true', 'mostly_false', 'false', 'pants_on_fire'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
