import { mkdirSync, existsSync, writeFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./env";

/**
 * Downloads the LIAR dataset (Wang, ACL 2017): ~12,800 short political claims from
 * PolitiFact, each already carrying a six-way truth rating.
 *
 * This is the whole bootstrapping story. The alternative -- scraping live fact-check sites --
 * means building and babysitting scraping infrastructure, respecting robots.txt and rate
 * limits, and re-running it whenever a layout changes. LIAR is a fixed, citable, academically
 * standard file: download once, embed once, and the corpus is real data with real verdicts.
 */

const TARGET_DIR = path.join(projectRoot, "db", "seed", "liar");

const SPLITS = ["train", "valid", "test"] as const;

// Primary: the original release, mirrored as plain TSV. Fallback: the authors' own zip host.
const MIRRORS = [
  (split: string) =>
    `https://raw.githubusercontent.com/thiagorainmaker77/liar_dataset/master/${split}.tsv`,
  (split: string) =>
    `https://raw.githubusercontent.com/MeghaSharmaa/Fake-News-Detection-LIAR-Dataset/master/${split}.tsv`,
];

async function fetchSplit(split: string): Promise<string | null> {
  for (const mirror of MIRRORS) {
    const url = mirror(split);
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) continue;
      const text = await response.text();
      // Sanity check the shape before trusting it: 14 tab-separated columns, no header.
      const first = text.split("\n")[0]?.split("\t") ?? [];
      if (first.length !== 14) {
        console.warn(`    ${url} -> unexpected column count (${first.length}), skipping mirror`);
        continue;
      }
      console.log(`    ${split}.tsv <- ${url}`);
      return text;
    } catch (error) {
      console.warn(`    ${url} -> ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return null;
}

async function main() {
  mkdirSync(TARGET_DIR, { recursive: true });
  console.log(`\n  Fetching LIAR dataset into db/seed/liar/\n`);

  let total = 0;
  let missing = 0;

  for (const split of SPLITS) {
    const target = path.join(TARGET_DIR, `${split}.tsv`);
    if (existsSync(target) && statSync(target).size > 1000) {
      const lines = readFileSync(target, "utf8").trim().split("\n").length;
      console.log(`    ${split}.tsv already present (${lines.toLocaleString()} rows)`);
      total += lines;
      continue;
    }
    const text = await fetchSplit(split);
    if (!text) {
      console.warn(`    could not fetch ${split}.tsv from any mirror`);
      missing += 1;
      continue;
    }
    writeFileSync(target, text, "utf8");
    total += text.trim().split("\n").length;
  }

  if (total === 0) {
    console.error(
      "\n  No LIAR data downloaded. `npm run db:seed` will fall back to the bundled\n" +
        "  curated corpus in db/seed/curated-claims.json, which is smaller but works offline.\n",
    );
    process.exit(1);
  }

  console.log(
    `\n  ${total.toLocaleString()} labelled claims ready` +
      (missing > 0 ? ` (${missing} split(s) unavailable)` : "") +
      `\n  Next: npm run db:seed\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
