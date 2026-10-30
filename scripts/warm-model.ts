import { loadEnv } from "./env";
import { embed, EMBEDDING_MODEL } from "../src/lib/embeddings";

/**
 * Downloads and caches the embedding model ahead of time, so a live demo never stalls for
 * 20 seconds on the very first claim somebody submits.
 */
async function main() {
  loadEnv({ requireDatabase: false }); // the model does not need a database
  const started = Date.now();
  console.log(`\n  loading ${EMBEDDING_MODEL} ...`);
  const vector = await embed("Warm-up claim used only to force the model to load.");
  console.log(`  ready: ${vector.length} dimensions in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
