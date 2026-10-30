import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadEnv, projectRoot } from "./env";

loadEnv();

const MIGRATIONS_DIR = path.join(projectRoot, "db", "migrations");

async function main() {
  const reset = process.argv.includes("--reset");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /\bsslmode=require\b/.test(process.env.DATABASE_URL!)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();
  const { rows: who } = await client.query<{ db: string; version: string }>(
    `SELECT current_database() AS db, version() AS version`,
  );
  console.log(`  connected to ${who[0].db} (${who[0].version.split(",")[0]})`);

  if (reset) {
    console.log("  --reset: dropping and recreating schema public");
    await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: done } = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );
  const applied = new Set(done.map((r) => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  - ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // Each migration is its own transaction: a syntax error halfway through a file leaves
    // the schema exactly as it was, instead of half-migrated.
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`  + ${file}`);
      ran += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`\n  FAILED on ${file}:\n`);
      console.error(error instanceof Error ? error.message : error);
      if (error instanceof Error && /extension "vector" is not available/i.test(error.message)) {
        console.error(
          "\n  Your Postgres server does not have pgvector installed.\n" +
            "  Options: use a hosted Postgres with pgvector built in (Neon, Supabase),\n" +
            "  run `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17`,\n" +
            "  or install the extension locally. See README.md -> Setup.\n",
        );
      }
      await client.end();
      process.exit(1);
    }
  }

  const { rows: objects } = await client.query<{ kind: string; n: number }>(`
    SELECT 'tables' AS kind, count(*)::INT AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    UNION ALL
    SELECT 'views', count(*)::INT FROM information_schema.views WHERE table_schema = 'public'
    UNION ALL
    SELECT 'functions', count(*)::INT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT 'procedures', count(*)::INT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'p'
    UNION ALL
    SELECT 'triggers', count(*)::INT FROM pg_trigger WHERE NOT tgisinternal
    UNION ALL
    SELECT 'indexes', count(*)::INT FROM pg_indexes WHERE schemaname = 'public'
  `);

  console.log(
    `\n  ${ran} migration${ran === 1 ? "" : "s"} applied. Schema now has:\n` +
      objects.map((o) => `    ${String(o.n).padStart(3)} ${o.kind}`).join("\n"),
  );
  console.log("\n  Next: npm run db:seed\n");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
