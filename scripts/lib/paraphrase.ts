/**
 * Mechanical rewording, used only to generate the landing page's "try one of these" examples.
 *
 * The point of the examples is to prove the matcher is semantic, not lexical -- so they must
 * NOT be the corpus text verbatim (that would match at ~100% and demonstrate nothing) and must
 * not be hand-written strings that drift away from whatever corpus is actually loaded. These
 * transforms are deliberately shallow: they change surface wording while leaving the assertion
 * intact, which is exactly the "same claim, different words" case the system exists to catch.
 *
 * Nothing in the serving path uses this. It is seed-time demo scaffolding.
 */

const LEAD_INS = [
  (text: string) => `Is it true that ${lowerFirst(stripPeriod(text))}?`,
  (text: string) => `Someone forwarded me this: ${text}`,
  (text: string) => `I keep seeing people say that ${lowerFirst(stripPeriod(text))}.`,
  (text: string) => `Apparently ${lowerFirst(stripPeriod(text))}.`,
  (text: string) => `Can you check this -- ${lowerFirst(text)}`,
];

const SWAPS: [RegExp, string][] = [
  [/\bsays\b/gi, "claims"],
  [/\bsaid\b/gi, "stated"],
  [/\bpercent\b/gi, "%"],
  [/\bmore than\b/gi, "over"],
  [/\bless than\b/gi, "under"],
  [/\bbecause of\b/gi, "due to"],
  [/\bwill not\b/gi, "won't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bhas not\b/gi, "hasn't"],
  [/\bthe government\b/gi, "the administration"],
  [/\bpeople\b/gi, "folks"],
  [/\bmoney\b/gi, "funding"],
  [/\bjobs\b/gi, "positions"],
  [/\bhighest\b/gi, "biggest"],
  [/\bincreased\b/gi, "went up"],
  [/\bdecreased\b/gi, "went down"],
];

function stripPeriod(text: string): string {
  return text.replace(/\s*[.!?]+\s*$/, "");
}

/**
 * Sentence-opening function words. Lower-casing is opt-IN against this list rather than
 * opt-out against a proper-noun test, because no cheap test distinguishes "The" from "Joe":
 * an earlier version only skipped acronyms and produced "Apparently joe Biden stated ...".
 * Anything not on this list keeps its capital, which is the safe direction to be wrong in.
 *
 * Function words only. Topic nouns ("president", "state", "congress") were on this list and
 * had to come off: capitalised at the start of a claim they are usually part of a title or a
 * proper noun, and the list produced "president Obama".
 */
const OPENERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "he", "she", "they",
  "we", "you", "there", "here", "his", "her", "their", "our", "says", "said", "if",
  "when", "while", "after", "before", "since", "because", "most", "many", "more", "less",
  "all", "no", "none", "some", "every", "each", "both", "nearly", "almost", "about",
  "over", "under", "one", "two", "three", "four", "five", "half", "nine", "ten",
]);

function lowerFirst(text: string): string {
  const firstWord = (text.split(/\s+/)[0] ?? "").replace(/[^A-Za-z]/g, "");
  if (!OPENERS.has(firstWord.toLowerCase())) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
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

/** Stable hash so the same claim always yields the same example text across seed runs. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function paraphrase(text: string): string {
  const seed = hash(text);
  let result = text.replace(/\s+/g, " ").trim();

  // Apply two of the swap rules, chosen by the hash, so different claims get different edits.
  const offsets = [seed % SWAPS.length, (seed >> 8) % SWAPS.length];
  for (const offset of new Set(offsets)) {
    const [pattern, replacement] = SWAPS[offset];
    result = result.replace(pattern, replacement);
  }
  // Put back a capital a swap may have eaten, BEFORE the lead-in decides on casing.
  result = preserveLeadingCase(text, result);

  return LEAD_INS[(seed >> 16) % LEAD_INS.length](result);
}
