import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * sentence-transformers/all-MiniLM-L6-v2, run locally through transformers.js (ONNX).
 *
 * Same weights and same 384-dimension output as the Python `sentence-transformers`
 * package, so the vectors are interchangeable -- but it runs inside the Node process,
 * which means no second service to deploy and no per-call API cost. The model is ~23 MB
 * and is cached on disk after the first load.
 */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

declare global {
  var __fcaExtractor: Promise<FeatureExtractionPipeline> | undefined;
}

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  // The cast narrows transformers.js's giant task->pipeline overload union, which TypeScript
  // otherwise refuses to represent (TS2590) when the task name is a const rather than a literal.
  return pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: "fp32", // quantised weights measurably hurt short-sentence similarity
  }) as unknown as Promise<FeatureExtractionPipeline>;
}

// Loading the model takes a few seconds; hold one instance for the process lifetime.
function getExtractor(): Promise<FeatureExtractionPipeline> {
  global.__fcaExtractor ??= loadExtractor();
  return global.__fcaExtractor;
}

/** Warms the model so the first real submission isn't the one that pays the load cost. */
export async function warmUp(): Promise<void> {
  await getExtractor();
}

/**
 * Conversational wrappers readers put around a claim when they paste it. These carry no
 * factual content but they do move the sentence in vector space: measured on the LIAR corpus,
 * wrapping a claim in "Is it true that ...?" costs roughly 8-12 points of cosine similarity
 * against the claim it is quoting, which is enough to push a genuine duplicate under the
 * match threshold. Stripping them is the single highest-value preprocessing step in the
 * pipeline -- see `npm run calibrate` and docs/threshold-calibration.md.
 */
const LEAD_INS =
  /^(?:\s*(?:is\s+it\s+true\s+(?:that)?|did\s+you\s+know(?:\s+that)?|i\s+(?:keep\s+)?(?:read|hear|saw|see|seeing|hearing|reading)\s+(?:that\s+)?|apparently|allegedly|someone\s+(?:forwarded|sent|shared)\s+me\s+(?:this|that)|can\s+you\s+(?:please\s+)?(?:fact[-\s]?check|check|verify)\s*(?:this|that)?|(?:please\s+)?fact[-\s]?check|claim|rumour\s+has\s+it(?:\s+that)?|people\s+are\s+saying(?:\s+that)?|there\s+are\s+reports\s+that|breaking)\b[\s:,\-–—]*)+/i;

/** Trailing provenance a forward tends to pick up: "-- via WhatsApp", "(forwarded as received)". */
const TRAILING_ATTRIBUTION =
  /(?:\s*[-–—(]{1,2}\s*(?:via|source|forwarded(?:\s+from|\s+as\s+received)?|shared\s+by|sent\s+by)\b[^.?!]*\)?\s*)$/i;

/**
 * Light normalisation before embedding. Collapsing whitespace, removing the conversational
 * wrapper and dropping a trailing attribution keeps cosmetically different copies of the same
 * forwarded claim mapping to nearly the same point in vector space.
 *
 * This runs on submission, so the normalised form is what gets stored and shown back -- the
 * corpus holds claims, not the chat around them.
 */
export function normaliseClaim(text: string): string {
  let result = (text ?? "").replace(/\s+/g, " ").trim();
  result = result.replace(LEAD_INS, "");
  result = result.replace(TRAILING_ATTRIBUTION, "");
  result = result.replace(/\s*[?!]+\s*$/, "").trim();
  // Re-capitalise if stripping a lead-in left the sentence starting mid-phrase.
  if (result && /^[a-z]/.test(result) && !/^[a-z]+[A-Z]/.test(result)) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result;
}

/**
 * Mean-pooled, L2-normalised embedding. Normalised, so cosine distance == 1 - dot product.
 *
 * `normalise: false` skips the text clean-up and is only used by the calibration script, to
 * measure what that clean-up is worth. Everything in the serving path leaves it on.
 */
export async function embed(text: string, { normalise = true } = {}): Promise<number[]> {
  const extractor = await getExtractor();
  const input = normalise ? normaliseClaim(text) : text.replace(/\s+/g, " ").trim();
  const output = await extractor(input, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array | Float64Array, Number);
}

export async function embedBatch(texts: string[], { normalise = true } = {}): Promise<number[][]> {
  const extractor = await getExtractor();
  const prepared = normalise
    ? texts.map(normaliseClaim)
    : texts.map((t) => t.replace(/\s+/g, " ").trim());
  const output = await extractor(prepared, { pooling: "mean", normalize: true });
  const flat = Array.from(output.data as Float32Array | Float64Array, Number);
  const rows: number[][] = [];
  for (let i = 0; i < texts.length; i += 1) {
    rows.push(flat.slice(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS));
  }
  return rows;
}

/**
 * pgvector's text input format. Passed as a plain string parameter and cast with
 * `$1::vector(384)` in SQL, which avoids shipping 384 separate bind parameters.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n.toFixed(7) : "0")).join(",")}]`;
}

export function parseVectorLiteral(literal: string): number[] {
  return literal.replace(/^\[|\]$/g, "").split(",").map(Number);
}
