export type Role = "reader" | "fact_checker" | "admin";
export type ClaimStatus = "pending" | "reviewed" | "matched" | "rejected";
export type Verdict =
  | "true"
  | "mostly_true"
  | "half_true"
  | "mostly_false"
  | "false"
  | "pants_on_fire";

export const VERDICTS: Verdict[] = [
  "true",
  "mostly_true",
  "half_true",
  "mostly_false",
  "false",
  "pants_on_fire",
];

/** Display metadata for each rung of the PolitiFact truth scale. */
export const VERDICT_META: Record<
  Verdict,
  { label: string; short: string; tone: "true" | "mixed" | "false"; blurb: string }
> = {
  true: { label: "True", short: "True", tone: "true", blurb: "Accurate as stated." },
  mostly_true: {
    label: "Mostly True",
    short: "Mostly true",
    tone: "true",
    blurb: "Accurate, with minor caveats or missing context.",
  },
  half_true: {
    label: "Half True",
    short: "Half true",
    tone: "mixed",
    blurb: "Partially accurate but leaves out important details.",
  },
  mostly_false: {
    label: "Mostly False",
    short: "Mostly false",
    tone: "false",
    blurb: "Contains an element of truth but is misleading overall.",
  },
  false: { label: "False", short: "False", tone: "false", blurb: "Not accurate." },
  pants_on_fire: {
    label: "Pants on Fire",
    short: "Pants on fire",
    tone: "false",
    blurb: "Not accurate, and makes a ridiculous claim.",
  },
};

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: Role;
}

/** One row returned by fn_match_claims / fn_search_claims_fts. */
export interface CorpusMatch {
  claimId: number;
  claimText: string;
  similarity: number | null;
  rank?: number | null;
  headline?: string | null;
  verdict: Verdict;
  explanation: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  sourceReliability: number | null;
  credibilityScore: number | null;
  reviewedAt: string;
  categories: string[];
}

export type SubmissionOutcome =
  /** A corpus claim cleared the similarity threshold -- answered instantly. */
  | "matched"
  /** The vector path missed but full-text found a lexical twin that cosine then confirmed. */
  | "matched_lexical"
  /** Nothing close enough; the claim is now in the review queue. */
  | "queued"
  /** This exact text was already queued by someone else; joined that queue item. */
  | "already_queued";

/** Per-stage timings, so the UI can show the pipeline actually running rather than a spinner. */
export interface PipelineStage {
  key: "embed" | "vector" | "fulltext" | "persist";
  label: string;
  ms: number;
  detail: string;
  /** false when the stage was skipped because an earlier stage already answered the query. */
  ran: boolean;
}

export interface SubmissionResult {
  outcome: SubmissionOutcome;
  claimId: number;
  text: string;
  /** Present for the two matched outcomes. */
  match: CorpusMatch | null;
  /** Below-threshold neighbours -- shown as "related, but not close enough to rule on". */
  nearMatches: CorpusMatch[];
  threshold: number;
  stages: PipelineStage[];
  corpusSize: number;
  queuePosition: number | null;
}

export interface QueueItem {
  id: number;
  text: string;
  submittedAt: string;
  submittedBy: string | null;
  assignedTo: string | null;
  topNeighbourSimilarity: number | null;
  topNeighbourText: string | null;
}
