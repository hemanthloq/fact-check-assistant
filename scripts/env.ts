import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Loads env files the same way `next dev` does, so `npm run db:setup` and the running app
 * always agree about which database they are pointing at.
 * Precedence: .env.local wins over .env (first loader to set a key keeps it).
 */
export function loadEnv({ requireDatabase = true }: { requireDatabase?: boolean } = {}): void {
  const root = path.resolve(__dirname, "..");
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (existsSync(full)) dotenv.config({ path: full, quiet: true });
  }
  if (requireDatabase && !process.env.DATABASE_URL) {
    console.error(
      "\n  DATABASE_URL is not set.\n" +
        "  Copy .env.example to .env.local and point DATABASE_URL at a Postgres instance\n" +
        "  that has the pgvector extension available.\n",
    );
    process.exit(1);
  }
}

export const projectRoot = path.resolve(__dirname, "..");
