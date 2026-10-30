/**
 * Zero-install Postgres for development.
 *
 * Boots PGlite -- PostgreSQL 18 compiled to WASM, with pgvector and pg_trgm -- and exposes it
 * on a TCP port speaking the real Postgres wire protocol, so `pg`, `psql` and the app itself
 * connect to it exactly as they would to a server. Migrations are applied on startup.
 *
 *   npm run db:local        # then, in another terminal: npm run dev
 *
 * Use it to try the project or develop against it without installing anything. It is NOT the
 * deployment target: PGlite serves one connection at a time, so it cannot demonstrate the
 * concurrency the FOR UPDATE locking exists for, and the database lives in ./.pglite rather
 * than in a server you can back up. For anything beyond local work, point DATABASE_URL at a
 * real Postgres that has pgvector (see README).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { projectRoot } from "./env";

const PORT = Number(process.env.LOCAL_DB_PORT ?? 5433);
const DATA_DIR = path.join(projectRoot, ".pglite");

async function main() {
  const fresh = process.argv.includes("--fresh");

  console.log("\n  starting local Postgres (PGlite, WASM)...");
  const db = await PGlite.create({
    dataDir: fresh ? undefined : DATA_DIR,
    extensions: { vector, pg_trgm },
  });

  const { rows: version } = await db.query<{ v: string }>(`SELECT version() AS v`);
  console.log(`  ${version[0].v.split(",")[0]}`);
  console.log(`  storage: ${fresh ? "in-memory (--fresh)" : path.relative(projectRoot, DATA_DIR)}`);

  // Apply any migration this database has not seen yet.
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows: applied } = await db.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );
  const done = new Set(applied.map((row) => row.filename));

  const dir = path.join(projectRoot, "db", "migrations");
  let count = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
    await db.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    count += 1;
  }
  console.log(`  migrations: ${count} applied, ${done.size} already present`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();

  console.log(`\n  listening on 127.0.0.1:${PORT}`);
  console.log(`  put this in .env.local:\n`);
  console.log(`    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log(`    PG_POOL_MAX=1\n`);
  console.log(`  PG_POOL_MAX=1 matters: PGlite serves one connection at a time.`);
  console.log(`  Then: npm run db:seed   (in another terminal)\n`);
  console.log(`  Ctrl+C to stop.\n`);

  const shutdown = async () => {
    console.log("\n  stopping...");
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
