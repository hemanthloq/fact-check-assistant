import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Verdict } from "../../src/lib/types";

/**
 * LIAR dataset parser.
 *
 * Format: 14 tab-separated columns, no header row (Wang, "Liar, Liar Pants on Fire",
 * ACL 2017). Columns 9-13 are the speaker's prior truth-rating counts, which this project
 * does not use -- the verdict on the claim itself is all the corpus needs.
 */
const COLUMNS = [
  "id",
  "label",
  "statement",
  "subjects",
  "speaker",
  "speaker_job",
  "state",
  "party",
  "count_barely_true",
  "count_false",
  "count_half_true",
  "count_mostly_true",
  "count_pants_fire",
  "context",
] as const;

/** LIAR's six-way scale maps 1:1 onto verdict_type, with one rename. */
const LABEL_TO_VERDICT: Record<string, Verdict> = {
  true: "true",
  "mostly-true": "mostly_true",
  "half-true": "half_true",
  // LIAR's "barely-true" is PolitiFact's "Mostly False" rung under its older name.
  "barely-true": "mostly_false",
  false: "false",
  "pants-fire": "pants_on_fire",
};

/** LIAR subject slugs -> this project's category names. */
const SUBJECT_TO_CATEGORY: Record<string, string> = {
  health: "Health",
  "health-care": "Health",
  "public-health": "Health",
  medicaid: "Health",
  medicare: "Health",
  abortion: "Health",
  "medical-marijuana": "Health",
  drugs: "Health",

  economy: "Economy",
  jobs: "Economy",
  taxes: "Economy",
  "federal-budget": "Economy",
  "state-budget": "Economy",
  debt: "Economy",
  deficit: "Economy",
  income: "Economy",
  poverty: "Economy",
  trade: "Economy",
  wealth: "Economy",
  "job-accomplishments": "Economy",
  "economy-and-jobs": "Economy",
  "financial-regulation": "Economy",
  housing: "Economy",
  "small-business": "Economy",
  workers: "Economy",
  "labor-unions": "Economy",

  energy: "Energy",
  "nuclear-energy": "Energy",
  oil: "Energy",
  gasprices: "Energy",

  environment: "Environment",
  "climate-change": "Environment",
  water: "Environment",
  "pollution-and-recycling": "Environment",
  "natural-disasters": "Environment",
  animals: "Environment",

  education: "Education",
  "after-school-programs": "Education",

  science: "Science",
  "space-exploration": "Science",
  technology: "Technology",
  "transportation-and-infrastructure": "Technology",
  infrastructure: "Technology",

  immigration: "Immigration",
  "border-security": "Immigration",

  crime: "Crime",
  "criminal-justice": "Crime",
  guns: "Crime",
  terrorism: "Crime",
  "homeland-security": "Crime",
  "death-penalty": "Crime",
  "legal-issues": "Crime",
  "public-safety": "Crime",

  elections: "Elections",
  "campaign-finance": "Elections",
  "campaign-advertising": "Elections",
  "voting-record": "Elections",
  "candidates-biography": "Elections",
  "message-machine": "Elections",
  polls: "Elections",
  redistricting: "Elections",

  "message-machine-2012": "Media",
  "pundits": "Media",
  "news-media": "Media",
  "social-media": "Media",
};

export interface LiarRow {
  text: string;
  verdict: Verdict;
  categories: string[];
  speaker: string | null;
  speakerJob: string | null;
  party: string | null;
  state: string | null;
  context: string | null;
}

function tidySpeaker(slug: string): string | null {
  const cleaned = slug.trim();
  if (!cleaned || cleaned === "none") return null;
  return cleaned
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tidy(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!cleaned || cleaned.toLowerCase() === "none") return null;
  return cleaned;
}

export function parseLiarTsv(contents: string): LiarRow[] {
  const rows: LiarRow[] = [];

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (cells.length < COLUMNS.length) continue;

    const verdict = LABEL_TO_VERDICT[cells[1]?.trim().toLowerCase() ?? ""];
    if (!verdict) continue;

    const text = cells[2]?.trim().replace(/\s+/g, " ") ?? "";
    // The claims table requires >= 12 characters; a handful of LIAR rows are fragments.
    if (text.length < 12 || text.length > 1000) continue;

    const categories = Array.from(
      new Set(
        (cells[3] ?? "")
          .split(",")
          .map((s) => SUBJECT_TO_CATEGORY[s.trim().toLowerCase()])
          .filter((name): name is string => Boolean(name)),
      ),
    );
    // Every LIAR claim is political in origin, so an unmapped subject is still a Politics claim.
    if (categories.length === 0) categories.push("Politics");

    rows.push({
      text,
      verdict,
      categories,
      speaker: tidySpeaker(cells[4] ?? ""),
      speakerJob: tidy(cells[5]),
      state: tidy(cells[6]),
      party: tidy(cells[7]),
      context: tidy(cells[13]),
    });
  }

  return rows;
}

/** Reads whichever LIAR splits are present, de-duplicating statements across them. */
export function loadLiar(seedDir: string): LiarRow[] {
  const seen = new Set<string>();
  const all: LiarRow[] = [];

  for (const split of ["train", "valid", "test"]) {
    const file = path.join(seedDir, "liar", `${split}.tsv`);
    if (!existsSync(file)) continue;
    for (const row of parseLiarTsv(readFileSync(file, "utf8"))) {
      const key = row.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(row);
    }
  }

  return all;
}

/**
 * The explanation shown to readers. LIAR ships the verdict but not the ruling's prose or URL,
 * so this states exactly what is known and where it came from rather than inventing a summary.
 */
export function describeLiarRow(row: LiarRow, verdictLabel: string): string {
  const attribution = [
    row.speaker && `Claim by ${row.speaker}`,
    row.speakerJob && `(${row.speakerJob}${row.state ? `, ${row.state}` : ""})`,
    row.context && `in ${row.context}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    `Rated ${verdictLabel} by PolitiFact. ` +
    (attribution ? `${attribution}. ` : "") +
    `Imported from the LIAR dataset (Wang, ACL 2017), which carries PolitiFact's rating but ` +
    `not the full written ruling -- see politifact.com for the complete analysis.`
  );
}
