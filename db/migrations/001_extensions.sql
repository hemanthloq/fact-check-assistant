-- 001_extensions.sql
-- pgvector gives us the `vector` type + cosine-distance operators and ANN indexes.
-- pg_trgm is used for the admin corpus browser's fuzzy "contains" filter.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
