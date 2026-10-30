/**
 * Threshold calibration.
 *
 * MATCH_THRESHOLD decides whether a reader gets an instant verdict or waits for a human, so
 * it should not be a number somebody liked the look of. This script measures it against the
 * real corpus and writes up the result in docs/threshold-calibration.md.
 *
 * Run: npm run calibrate   (needs `npm run liar:fetch` first)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./env";
import { loadLiar } from "./lib/liar";
import { paraphrase } from "./lib/paraphrase";
import { reword } from "./lib/reword";
import { embedBatch, normaliseClaim } from "../src/lib/embeddings";

const SAMPLE = 400;
const BATCH = 64;
/** Safety margin above the worst observed false-positive, in cosine points. */
const MARGIN = 0.1;

const cos = (a: number[], b: number[]) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
};

async function embedAll(
  label: string,
  texts: string[],
  opts?: { normalise?: boolean },
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH), opts)));
    process.stdout.write(`\r  ${label}: ${Math.min(i + BATCH, texts.length)}/${texts.length}    `);
  }
  process.stdout.write("\n");
  return out;
}

interface Q {
  n: number;
  min: number;
  p05: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
  mean: number;
}

function quantiles(values: number[]): Q {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    min: sorted[0],
    p05: at(0.05),
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

const fmt = (n: number) => n.toFixed(3);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function renderTable(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows
    .map((row) => "  " + row.map((cell, c) => (cell ?? "").padEnd(widths[c])).join("  "))
    .join("\n");
}

async function main() {
  console.log("\n  Threshold calibration\n");

  const rows = loadLiar(path.join(projectRoot, "db", "seed"));
  if (rows.length < 100) {
    console.error(`  Needs the LIAR dataset -- run \`npm run liar:fetch\` (found ${rows.length} rows).\n`);
    process.exit(1);
  }

  // Deterministic sample so re-runs are comparable.
  const usable = rows.filter((r) => r.text.length >= 60 && r.text.length <= 220);
  const step = Math.max(1, Math.floor(usable.length / SAMPLE));
  const sample = Array.from({ length: SAMPLE }, (_, i) => usable[(i * step) % usable.length]);
  const originals = sample.map((r) => r.text);

  console.log(`  corpus   ${rows.length.toLocaleString()} LIAR claims`);
  console.log(`  sample   ${sample.length} claims, 60-220 chars\n`);

  // --- build the three positive arms -----------------------------------------------------
  // A: conversational wrapper only. This is how readers paste claims, and normaliseClaim()
  //    is designed to strip it -- so A measures what that preprocessing step is worth.
  const wrapped = originals.map((t) => paraphrase(t));
  // B: the words inside the claim change. Normalisation cannot undo this, so B is the real
  //    measurement of the matcher's tolerance for rewording.
  const rewordings = originals.map((t) => reword(t));
  const reworded = rewordings.map((r) => r.text);
  // C: both at once -- the realistic worst case for a forwarded, reworded claim.
  const both = rewordings.map((r, i) => paraphrase(r.text) || reworded[i]);

  // How often does normalisation collapse a wrapped claim back onto the original? If it does,
  // the pair proves nothing about semantic matching, and saying so is the honest move.
  const collapsed = originals.filter(
    (text, i) => normaliseClaim(wrapped[i]) === normaliseClaim(text),
  ).length;

  console.log("  --- embedding (4 passes over the sample) ---");
  const vOriginal = await embedAll("originals   ", originals);
  const vWrappedRaw = await embedAll("wrapped raw ", wrapped, { normalise: false });
  const vWrapped = await embedAll("wrapped norm", wrapped);
  const vReworded = await embedAll("reworded    ", reworded);
  const vBoth = await embedAll("both        ", both);

  const simWrappedRaw = originals.map((_, i) => cos(vOriginal[i], vWrappedRaw[i]));
  const simWrapped = originals.map((_, i) => cos(vOriginal[i], vWrapped[i]));
  const simReworded = originals.map((_, i) => cos(vOriginal[i], vReworded[i]));
  const simBoth = originals.map((_, i) => cos(vOriginal[i], vBoth[i]));

  // --- negatives -------------------------------------------------------------------------
  // Hard: two DIFFERENT claims that share a topic category. This is the dangerous case --
  // a false match here means showing a reader a verdict about something else entirely.
  const byCategory = new Map<string, number[]>();
  sample.forEach((row, i) => {
    for (const category of row.categories) {
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(i);
    }
  });
  const hardNegatives: { sim: number; a: number; b: number }[] = [];
  for (const indices of byCategory.values()) {
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i + 1; j < Math.min(i + 4, indices.length); j += 1) {
        const [a, b] = [indices[i], indices[j]];
        if (a !== b) hardNegatives.push({ sim: cos(vOriginal[a], vOriginal[b]), a, b });
      }
    }
  }
  const easyNegatives: number[] = [];
  for (let i = 0; i < sample.length; i += 1) {
    for (const mult of [97, 211, 353]) {
      const j = (i * mult + 41) % sample.length;
      if (i !== j) easyNegatives.push(cos(vOriginal[i], vOriginal[j]));
    }
  }

  const qWrappedRaw = quantiles(simWrappedRaw);
  const qWrapped = quantiles(simWrapped);
  const qReworded = quantiles(simReworded);
  const qBoth = quantiles(simBoth);
  const qHard = quantiles(hardNegatives.map((h) => h.sim));
  const qEasy = quantiles(easyNegatives);
  const qDivergence = quantiles(rewordings.map((r) => r.lexicalDivergence));

  console.log("\n  --- similarity distributions ---");
  const distRows: string[][] = [
    ["pair type", "n", "min", "p05", "p25", "median", "p95", "max"],
    ...(
      [
        ["A  wrapped, no normalisation", qWrappedRaw],
        ["A  wrapped, normalised", qWrapped],
        ["B  reworded (words changed)", qReworded],
        ["C  wrapped + reworded", qBoth],
        ["N  same topic, diff claim", qHard],
        ["N  unrelated", qEasy],
      ] as [string, Q][]
    ).map(([label, q]) => [
      label,
      String(q.n),
      fmt(q.min),
      fmt(q.p05),
      fmt(q.p25),
      fmt(q.median),
      fmt(q.p95),
      fmt(q.max),
    ]),
  ];
  console.log(renderTable(distRows));

  console.log(
    `\n  normalisation lifts wrapped claims ${fmt(qWrappedRaw.median)} -> ${fmt(qWrapped.median)} ` +
      `(+${fmt(qWrapped.median - qWrappedRaw.median)} median)`,
  );
  console.log(
    `  ...but it collapses ${collapsed}/${originals.length} (${pct(collapsed / originals.length)}) of them exactly onto\n` +
      `  the original, so arm A cannot measure semantic matching. Arm B is the honest number.`,
  );
  console.log(
    `  arm B changes ${pct(qDivergence.median)} of content words (median), ${pct(qDivergence.p95)} at p95.`,
  );

  // --- sweep -----------------------------------------------------------------------------
  // Recall is measured on arm C (the hardest positive arm); precision counts a false positive
  // whenever any negative pair clears the threshold.
  const positives = simBoth;
  const negatives = [...hardNegatives.map((h) => h.sim), ...easyNegatives];

  interface Sweep {
    threshold: number;
    recallB: number;
    recallC: number;
    precision: number;
    f1: number;
    hardFp: number;
  }
  const sweep: Sweep[] = [];
  for (let t = 0.5; t <= 0.96001; t += 0.01) {
    const threshold = Number(t.toFixed(2));
    const tp = positives.filter((s) => s >= threshold).length;
    const fp = negatives.filter((s) => s >= threshold).length;
    const hardFp = hardNegatives.filter((h) => h.sim >= threshold).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recallC = tp / positives.length;
    sweep.push({
      threshold,
      recallB: simReworded.filter((s) => s >= threshold).length / simReworded.length,
      recallC,
      precision,
      f1: precision + recallC > 0 ? (2 * precision * recallC) / (precision + recallC) : 0,
      hardFp,
    });
  }

  console.log("\n  --- threshold sweep ---");
  const sweepRows: string[][] = [
    ["thresh", "recall B", "recall C", "precision", "F1", "same-topic false matches"],
    ...sweep
      .filter((r) => Math.round(r.threshold * 100) % 2 === 0)
      .map((r) => [
        fmt(r.threshold),
        pct(r.recallB),
        pct(r.recallC),
        pct(r.precision),
        fmt(r.f1),
        String(r.hardFp),
      ]),
  ];
  console.log(renderTable(sweepRows));

  // --- choose ----------------------------------------------------------------------------
  // The two errors are not symmetric. A missed duplicate costs a fact-checker a few minutes;
  // a false match tells a reader something untrue. So the floor is set by the worst negative
  // observed, plus a margin -- not by F1.
  const floor = Math.max(qHard.max, qEasy.max);
  const recommended = Number(Math.min(0.95, Math.max(0.6, floor + MARGIN)).toFixed(2));
  const atRecommended = sweep.reduce((best, row) =>
    Math.abs(row.threshold - recommended) < Math.abs(best.threshold - recommended) ? row : best,
  );
  const bestF1 = sweep.reduce((a, b) => (b.f1 > a.f1 ? b : a));

  console.log("\n  --- recommendation ---");
  console.log(`  worst false-positive pair observed   ${fmt(floor)}  (same-topic max ${fmt(qHard.max)})`);
  console.log(`  + ${fmt(MARGIN)} margin                        -> ${fmt(recommended)}`);
  console.log(
    `  at that threshold: recall B ${pct(atRecommended.recallB)}, recall C ${pct(atRecommended.recallC)}, ` +
      `${atRecommended.hardFp} same-topic false matches`,
  );
  console.log(`  (best F1 would be ${fmt(bestF1.threshold)}, which this deliberately does not use)`);
  console.log(`\n  -> MATCH_THRESHOLD=${fmt(recommended)}\n`);

  // Worst hard negatives, for the report -- these are the pairs the threshold must stay above.
  const worstPairs = [...hardNegatives].sort((a, b) => b.sim - a.sim).slice(0, 3);

  // --- report ----------------------------------------------------------------------------
  const docsDir = path.join(projectRoot, "docs");
  mkdirSync(docsDir, { recursive: true });

  const md = `# Threshold calibration

Generated by \`npm run calibrate\` on ${new Date().toISOString().slice(0, 10)}.

\`MATCH_THRESHOLD\` is the cosine similarity a corpus claim must reach before the system
answers a reader outright instead of routing the claim to a human. It is the most
consequential constant in the project, so it is measured rather than guessed.

## Method

Sample: **${sample.length}** claims drawn deterministically from the ${rows.length.toLocaleString()}-claim LIAR corpus,
restricted to 60-220 characters (the band real submissions fall in).
Model: sentence-transformers **all-MiniLM-L6-v2**, mean pooling, L2-normalised, 384 dimensions.

Three positive arms, because "the same claim, differently worded" is not one thing:

| arm | construction | what it measures |
|---|---|---|
| **A** | claim vs. the same claim wrapped in a conversational lead-in ("Is it true that ...?") | the value of \`normaliseClaim()\` |
| **B** | claim vs. the same claim with its **words** changed (synonym lexicon, number reformatting, clause reordering) | tolerance for genuine rewording |
| **C** | both at once | realistic worst case for a forwarded claim |

Two negative sets:

| set | construction | requirement |
|---|---|---|
| same topic, different claim | two different claims sharing a category | **must not match** -- a false match here shows a reader a verdict about something else |
| unrelated | arbitrary claim pairs | must not match |

### A caveat that matters

Arm A is **not** a valid recall measurement. \`normaliseClaim()\` strips exactly the lead-ins
that arm A adds, so ${collapsed} of ${originals.length} pairs (${pct(collapsed / originals.length)}) normalise to byte-identical text and
score 1.000 by construction. That is a correct result for the preprocessing step and a
meaningless one for the matcher. **Arm B and C are the numbers to read.**

## Similarity distributions

| pair type | n | min | p05 | p25 | median | p95 | max |
|---|---|---|---|---|---|---|---|
| A - wrapped, no normalisation | ${qWrappedRaw.n} | ${fmt(qWrappedRaw.min)} | ${fmt(qWrappedRaw.p05)} | ${fmt(qWrappedRaw.p25)} | ${fmt(qWrappedRaw.median)} | ${fmt(qWrappedRaw.p95)} | ${fmt(qWrappedRaw.max)} |
| A - wrapped, normalised | ${qWrapped.n} | ${fmt(qWrapped.min)} | ${fmt(qWrapped.p05)} | ${fmt(qWrapped.p25)} | ${fmt(qWrapped.median)} | ${fmt(qWrapped.p95)} | ${fmt(qWrapped.max)} |
| **B - reworded** | ${qReworded.n} | ${fmt(qReworded.min)} | **${fmt(qReworded.p05)}** | ${fmt(qReworded.p25)} | **${fmt(qReworded.median)}** | ${fmt(qReworded.p95)} | ${fmt(qReworded.max)} |
| **C - wrapped + reworded** | ${qBoth.n} | ${fmt(qBoth.min)} | **${fmt(qBoth.p05)}** | ${fmt(qBoth.p25)} | **${fmt(qBoth.median)}** | ${fmt(qBoth.p95)} | ${fmt(qBoth.max)} |
| N - same topic, diff claim | ${qHard.n} | ${fmt(qHard.min)} | ${fmt(qHard.p05)} | ${fmt(qHard.p25)} | ${fmt(qHard.median)} | ${fmt(qHard.p95)} | **${fmt(qHard.max)}** |
| N - unrelated | ${qEasy.n} | ${fmt(qEasy.min)} | ${fmt(qEasy.p05)} | ${fmt(qEasy.p25)} | ${fmt(qEasy.median)} | ${fmt(qEasy.p95)} | ${fmt(qEasy.max)} |

Arm B changes ${pct(qDivergence.median)} of content words at the median and ${pct(qDivergence.p95)} at p95, so these are
not cosmetic edits.

The gap between the positive and negative distributions is what makes the whole approach
work: reworded duplicates sit at **${fmt(qBoth.median)}** (median, arm C) while the closest
same-topic non-duplicate reaches only **${fmt(qHard.max)}**.

### What normalisation is worth

Stripping conversational lead-ins moves the median wrapped pair from ${fmt(qWrappedRaw.median)} to
${fmt(qWrapped.median)}. Readers really do paste claims as "Is it true that ...?", those wrappers carry no
factual content, and against a one-sentence claim they are long enough to drag the vector.
Cheap step, real gain.

## Threshold sweep

Recall B / recall C are the share of reworded duplicates caught. "Same-topic false matches"
counts negative pairs that wrongly clear the bar.

| threshold | recall B | recall C | precision | F1 | same-topic false matches |
|---|---|---|---|---|---|
${sweep
  .filter((r) => Math.round(r.threshold * 100) % 2 === 0)
  .map(
    (r) =>
      `| ${fmt(r.threshold)} | ${pct(r.recallB)} | ${pct(r.recallC)} | ${pct(r.precision)} | ${fmt(r.f1)} | ${r.hardFp} |`,
  )
  .join("\n")}

### Closest false-positive pairs

The threshold has to stay above these:

${worstPairs
  .map(
    (p) =>
      `- **${fmt(p.sim)}** -- "${originals[p.a].slice(0, 95)}${originals[p.a].length > 95 ? "..." : ""}"\n  vs. "${originals[p.b].slice(0, 95)}${originals[p.b].length > 95 ? "..." : ""}"`,
  )
  .join("\n")}

## Chosen value

\`\`\`
MATCH_THRESHOLD=${fmt(recommended)}
\`\`\`

Derived as *worst observed false-positive similarity* (${fmt(floor)}) *+ ${fmt(MARGIN)} margin*, **not** from F1
(best F1 here is ${fmt(bestF1.threshold)}). The two errors are not symmetric:

- **False negative** - a duplicate is escalated, and a fact-checker spends a few minutes
  marking it a duplicate. Recoverable, and the queue shows them how close the near miss was.
- **False positive** - a reader is shown somebody else's verdict as the answer to *their*
  claim. The tool confidently states something untrue, which is the one thing a fact-checking
  tool may not do.

At ${fmt(recommended)} this sample yields **${atRecommended.hardFp} same-topic false matches** while still catching
${pct(atRecommended.recallC)} of arm-C duplicates. Claims landing under the bar are not discarded: they are shown
to the reader as "related, not close enough to rule on", and the review queue displays the
nearest-neighbour similarity so the fact-checker starts warm rather than cold.

## Caveats

- Positives are **mechanically** reworded. A human rewriting a claim from memory changes more
  than a synonym lexicon does, so real-world recall will be lower than arm B or C suggests.
- Hard negatives are category-matched, not adversarial. Two claims about the same bill with
  different figures ("spending rose 12%" vs "spending rose 21%") would be a far harder test
  and are not represented here. That failure mode is the main argument for keeping a human in
  the loop rather than raising the threshold and trusting it.
- LIAR is English-language US political claims. A corpus in another domain or language should
  be re-measured before reusing this number.
- This measures the *matcher*, not the *corpus*. Recall against claims the corpus has never
  seen is zero by definition; that is what the review queue is for.
`;

  writeFileSync(path.join(docsDir, "threshold-calibration.md"), md, "utf8");
  console.log("  report written to docs/threshold-calibration.md\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
