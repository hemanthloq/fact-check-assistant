import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

/**
 * node-postgres hands back NUMERIC and BIGINT as strings to avoid silent precision loss.
 * Every numeric in this schema is a small score or a row count, so parsing them once here
 * keeps `typeof row.credibility_score === "number"` true all the way to the UI.
 */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number.parseFloat(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number.parseInt(v, 10)));

declare global {
  var __fcaPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres instance.",
    );
  }
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // Hosted Postgres (Neon, Supabase, Render) terminates plaintext connections.
    ssl: /\bsslmode=require\b/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * The pool is created on first use, not at module load.
 *
 * Two reasons it has to be lazy. `next build` imports every route module to analyse it, and
 * a build should not require a reachable database or a populated DATABASE_URL. And ES imports
 * are hoisted, so a script that calls loadEnv() before importing this module would otherwise
 * still hit a pool built from an empty environment.
 *
 * The global cache is for Next.js dev mode, which re-evaluates modules on every hot reload --
 * without it each reload would leak a pool until Postgres refused new connections.
 */
export function getPool(): Pool {
  global.__fcaPool ??= createPool();
  return global.__fcaPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * ADVANCED FEATURE 5 -- transactions.
 *
 * Runs `fn` against a single dedicated connection inside BEGIN/COMMIT, rolling back on any
 * throw. This matters because claim submission is multi-statement: look for a duplicate,
 * lock the least-loaded reviewer, insert the claim, assign it. Without a transaction a crash
 * between the insert and the assignment would leave an orphaned claim that never surfaces in
 * anybody's queue -- invisible to readers and fact-checkers alike.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* connection already broken -- the pool will discard it */
    });
    throw error;
  } finally {
    client.release();
  }
}

/** True when Postgres is reachable and pgvector is installed -- used by the health banner. */
export async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const row = await queryOne<{ has_vector: boolean; claim_count: number }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector,
              (SELECT count(*) FROM claims WHERE status = 'reviewed') AS claim_count`,
    );
    if (!row) return { ok: false, detail: "no response from database" };
    if (!row.has_vector) return { ok: false, detail: "pgvector extension is not installed" };
    return { ok: true, detail: `${row.claim_count} verified claims in corpus` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "unknown error" };
  }
}
