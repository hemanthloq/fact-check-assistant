/**
 * Rewording used to build CALIBRATION POSITIVES (scripts/calibrate.ts).
 *
 * Deliberately different from scripts/lib/paraphrase.ts. That one adds a conversational
 * wrapper, which is realistic for how readers paste claims -- but normaliseClaim() strips
 * exactly those wrappers, so a wrapped claim collapses back to the original and scores 1.000.
 * Measuring recall on those pairs measures nothing.
 *
 * This reworder instead changes the words inside the claim: a synonym lexicon, number
 * reformatting, and clause reordering. Normalisation cannot undo any of it, so the resulting
 * similarity is a real measurement of the matcher's tolerance for surface change.
 *
 * It is still mechanical, and that limitation is stated in the generated report: a human
 * rewriting a claim from memory changes more than this does.
 */

/** Meaning-preserving substitutions common in political and policy claims. */
const LEXICON: [RegExp, string][] = [
  [/\bsays\b/gi, "claims"],
  [/\bsaid\b/gi, "stated"],
  [/\bthe government\b/gi, "the administration"],
  [/\bfederal government\b/gi, "national administration"],
  [/\bpercent\b/gi, "per cent"],
  [/\bmore than\b/gi, "over"],
  [/\bless than\b/gi, "under"],
  [/\bfewer than\b/gi, "under"],
  [/\bbecause\b/gi, "since"],
  [/\bbiggest\b/gi, "largest"],
  [/\bhighest\b/gi, "greatest"],
  [/\blowest\b/gi, "smallest"],
  [/\bincrease[ds]?\b/gi, "rose"],
  [/\bdecrease[ds]?\b/gi, "fell"],
  [/\bspending\b/gi, "expenditure"],
  [/\bjobs\b/gi, "employment"],
  [/\bmoney\b/gi, "funds"],
  [/\btaxes\b/gi, "taxation"],
  [/\bhealth care\b/gi, "healthcare"],
  [/\bbill\b/gi, "legislation"],
  [/\bthe law\b/gi, "the statute"],
  [/\bplan\b/gi, "proposal"],
  [/\bvoted for\b/gi, "backed"],
  [/\bvoted against\b/gi, "opposed"],
  [/\bcreated\b/gi, "added"],
  [/\bcut\b/gi, "reduced"],
  [/\braised\b/gi, "lifted"],
  [/\bpaid for\b/gi, "funded"],
  [/\bAmericans\b/g, "citizens"],
  [/\bpeople\b/gi, "residents"],
  [/\bchildren\b/gi, "kids"],
  [/\bworkers\b/gi, "employees"],
  [/\bcompanies\b/gi, "firms"],
  [/\bstarted\b/gi, "began"],
  [/\bended\b/gi, "finished"],
  [/\bhelped\b/gi, "assisted"],
  [/\bwants\b/gi, "intends"],
  [/\bnow\b/gi, "currently"],
  [/\bevery year\b/gi, "annually"],
  [/\blast year\b/gi, "in the previous year"],
  [/\bright now\b/gi, "at present"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bwill not\b/gi, "won't"],
  [/\bis going to\b/gi, "will"],
  [/\bnumber of\b/gi, "count of"],
  [/\bamount of\b/gi, "quantity of"],
  [/\bbudget\b/gi, "financial plan"],
  [/\bborder\b/gi, "frontier"],
  [/\bimmigrants\b/gi, "migrants"],
];

/** "$47 billion" -> "47 billion dollars", "5%" -> "5 per cent". */
function reformatNumbers(text: string): string {
  return text
    .replace(/\$\s?([\d,.]+)\s*(billion|million|trillion|thousand)\b/gi, "$1 $2 dollars")
    .replace(/\$\s?([\d,.]+)\b/g, "$1 dollars")
    .replace(/([\d.]+)\s?%/g, "$1 per cent");
}

/**
 * Moves a trailing subordinate clause to the front: "X happened, after Y" -> "After Y, X
 * happened". Changes word order without changing the assertion.
 */
function reorderClauses(text: string): string {
  const match = text.match(
    /^(.*?),\s*(after|before|while|when|since|because|although|though|unless|until)\s+(.*)$/i,
  );
  if (!match) return text;
  const [, head, conjunction, tail] = match;
  if (head.length < 20 || tail.length < 12) return text;
  const cleanedTail = tail.replace(/\s*[.?!]\s*$/, "");
  const lead = conjunction.charAt(0).toUpperCase() + conjunction.slice(1).toLowerCase();
  const body = head.charAt(0).toLowerCase() + head.slice(1);
  return `${lead} ${cleanedTail}, ${body}.`;
}

/** "Says the group supports X" -> "The group supports X" (LIAR has many of these). */
function stripReportingVerb(text: string): string {
  return text.replace(/^(?:says|claims|stated|according to)\s+/i, (match) => {
    void match;
    return "";
  });
}

/**
 * Restores a sentence-initial capital after substitution.
 *
 * The lexicon matches case-insensitively but substitutes lower-case text, so a rule firing on
 * the first word silently decapitalises the sentence ("Children who witness ..." -> "kids who
 * witness ..."). Rather than case-matching every replacement, put the capital back.
 */
function preserveLeadingCase(original: string, rewritten: string): string {
  if (!/^[A-Z]/.test(original.trimStart())) return rewritten;
  const trimmed = rewritten.trimStart();
  if (!/^[a-z]/.test(trimmed)) return rewritten;
  return rewritten.replace(/^(\s*)([a-z])/, (_, space: string, letter: string) => space + letter.toUpperCase());
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export interface Rewording {
  text: string;
  /** How many distinct transformations actually fired. 0 means the claim came through intact. */
  edits: number;
  /** Share of content words that changed -- the honest measure of how different it looks. */
  lexicalDivergence: number;
  /**
   * True when no lexicon rule matched and an attributive frame was added instead. Callers that
   * wrap the result in a conversational lead-in of their own check this first -- stacking both
   * produces "Is it true that one version of this story holds that..." which reads like nothing
   * a person would ever type.
   */
  framed: boolean;
}

const STOPWORDS = new Set(
  "a an the of to in on at for by with and or is are was were be been has have had that this it its as from than then".split(
    " ",
  ),
);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s%$.]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function reword(text: string): Rewording {
  let result = text.replace(/\s+/g, " ").trim();
  let edits = 0;

  const before = result;
  result = stripReportingVerb(result);
  if (result !== before) edits += 1;

  const reformatted = reformatNumbers(result);
  if (reformatted !== result) edits += 1;
  result = reformatted;

  const reordered = reorderClauses(result);
  if (reordered !== result) edits += 1;
  result = reordered;

  // Apply every lexicon rule that matches. Unlike the demo paraphraser (which picks two at
  // random to keep examples readable), calibration wants the full surface change.
  for (const [pattern, replacement] of LEXICON) {
    const next = result.replace(pattern, replacement);
    if (next !== result) {
      edits += 1;
      result = next;
    }
  }

  // If nothing fired, fall back to a non-strippable attributive frame so the pair is still a
  // rewording rather than an identical copy.
  let framed = false;
  if (edits === 0) {
    framed = true;
    // No case folding in these frames: the claim may open on a proper noun, and
    // "...asserts that joe Biden said" is worse than a mid-sentence capital.
    const frames = [
      (t: string) => `A widely shared post asserts that ${t}`,
      (t: string) => `The assertion being circulated is that ${t}`,
      (t: string) => `One version of this story holds that ${t}`,
    ];
    result = frames[hash(text) % frames.length](result);
    edits = 1;
  }

  result = preserveLeadingCase(text, result);

  const original = new Set(contentWords(text));
  const rewritten = contentWords(result);
  const changed = rewritten.filter((w) => !original.has(w)).length;

  return {
    text: result,
    edits,
    lexicalDivergence: rewritten.length > 0 ? changed / rewritten.length : 0,
    framed,
  };
}
