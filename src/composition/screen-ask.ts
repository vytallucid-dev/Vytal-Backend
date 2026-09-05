// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SCREEN ASK — "is this sentence a request for a SET, and what filters it?", decided in code, ONCE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THIS FILE EXISTS BECAUSE DEFINITION ROUTING HAS NOW OVER-FIRED ON A SET REQUEST FOUR TIMES, AND
//    THE FOURTH ARRIVED THROUGH A DOOR THE THIRD FIX HAD JUST OPENED.
//
//   1. `definitionAsked` was the gate — a PHRASING list. Measured over fifteen phrasings it was right
//      6 times to the registry's 13, so the gate was inverted to the registry. Correct.
//   2. Inverting it made `mentionsAreTheTerm` VACUOUSLY TRUE on a sentence with no company in it, so
//      "companies with return on equity above 900" — a screen — was answered with a metric gloss.
//      Patched by asking `extractConditions`. Also correct, and too narrow.
//   3. `declinedFrame`'s two word-list gaps: "show me the strongest businesses" was REFUSED outright.
//   4. ⚠ AND NOW, OBSERVED LIVE, TWICE, WITH NO NUMBER IN THE SENTENCE FOR `extractConditions` TO SEE:
//
//        "give me a list of all the stocks which are in pristine health band"
//            → concept_bands   → the five-labels DEFINITION CARD
//        "how many stocks are showing pledging red flag"
//            → concept_finding → the what-a-flag-is DEFINITION CARD
//
//      Neither asked what a term means. Both asked for a set, and named a defined term as the FILTER.
//
// ★★ THE RULE, AND IT IS THE ONE THING THIS FILE ENCODES:
//    **A REQUEST FOR A SET IS NEVER A DEFINITION QUESTION, HOWEVER MANY DEFINED TERMS IT NAMES.**
//    A defined term inside a set request is the filter, not the subject.
//
// ── ⚠ WHY THIS IS NOT "ADD THE MISSING PHRASES TO A WORD LIST" ────────────────────────────────────
// That is what produced three of the four occurrences above, and a fifth would have arrived the same
// way. The defect is not that a list was short; it is that TWO PATHS WERE ANSWERING THE SAME QUESTION
// AND COULD DISAGREE — `definitionAnswer` decided "is this a screen?" with one test and `compose.ts`
// step 3g decided it with another. So the fix is structural (N-5): there is now ONE function that
// decides what a screen is, it returns the SPECIFICATION the screen runs on, and both paths call it.
//
//   compose.ts#definitionAnswer   `if (screenAsk(raw)) return null`   ← stand down, a set was asked for
//   compose.ts step 3g            `const ask = screenAsk(raw)`        ← and this is what it runs
//
// The two cannot drift, because a drift would mean the composer running a screen this file said was
// not one. A future gap is still possible — but it is now ONE gap in ONE place, and closing it fixes
// the routing and the answer in the same edit rather than in two that must agree.
//
// ── ★ EVERY FILTER IS REGISTRY-RESOLVED, SO A MISS REFUSES RATHER THAN GUESSES ────────────────────
//   conditions  `extractConditions` — needs a field, a comparator AND a number (screen-conditions.ts)
//   band        `parseBand`         — the five published labels, and nothing else resolves
//   finding     `FILING_REGISTRY`   — the 22 rules that actually write `stock_findings` rows
// A sentence matching none of them is not a screen and this returns `null`, exactly as before.
//
// ── ⚠ AND THE SET INTENT IS A STRUCTURAL TEST, NOT A POLITENESS ONE ───────────────────────────────
// `MARKET_NOUNS` is imported from `question-shape.ts` rather than copied (N-5) — it is already the
// product's "this sentence is about the market at large" vocabulary and is already the list the FIX-1
// sweep widened. A market noun means THE SENTENCE'S SUBJECT IS A SET OF COMPANIES, which is precisely
// what `mentionsAreTheTerm` could not see when the router resolved no mentions at all. The
// enumeration verbs beside it are the other way a reader says the same thing with no noun at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { extractConditions } from "./screen-conditions.js";
import { extractLineItemConditions, type LineItemCondition } from "./line-item-conditions.js";
import { MARKET_NOUNS } from "../router/question-shape.js";
import { parseBand } from "../scoring/read/universe-projection.service.js";
import { BAND_LABEL } from "../scoring/read/universe-projection.types.js";
import type { LabelBand } from "../scoring/read/health-view.types.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import type { ScreenCondition } from "../scoring/read/screen.types.js";

/**
 * ★ WHAT SHAPE OF ANSWER THE READER ASKED FOR. "How many" wants a NUMBER and the set behind it —
 *   not a refusal, and not a silent conversion into a list of twelve with the count nowhere on it.
 */
export type ScreenShape = "list" | "count";

/** Which evaluative layer the filter lives in — they have different reach and must not be merged. */
export type ScreenLayer = "metric" | "finding";

export interface ScreenFindingFilter {
  /** `null` when the reader named a KIND ("red flags") rather than one rule. */
  readonly ruleKey: string | null;
  /** The catalogue's own display name. `null` alongside a null ruleKey. */
  readonly name: string | null;
  /** `null` when one rule was named — the kind is then that rule's own. */
  readonly kind: "red_flag" | "pattern" | null;
}

export interface ScreenAsk {
  readonly shape: ScreenShape;
  /**
   * ★ FILED LINE ITEMS — the third universe, and the one the screen could not reach at all.
   *
   * `conditions` below is the SCORED thirteen over 95 companies. These are the 85 filed columns
   * derived from the data model, over the 2,284 that have filed a statement. A sentence can carry
   * both, and then the answer is the INTERSECTION and has to say which population it searched.
   */
  readonly lineItems: readonly LineItemCondition[];
  /**
   * ★ THE BASIS THE READER NAMED, or `null` for `chooseBasis` to decide. Never a screen-specific
   *   default — see `resolve/line-item-screen.ts`.
   */
  readonly basis: "standalone" | "consolidated" | null;
  /**
   * ★ WHICH LAYER ANSWERS. `metric` sees the 95 SCORED companies; `finding` sees all 2,291. They are
   *   not the same denominator and an answer must never imply they are, so the layer is decided here
   *   and travels with the ask rather than being inferred downstream.
   */
  readonly layer: ScreenLayer;
  readonly conditions: readonly ScreenCondition[];
  readonly band: LabelBand | null;
  readonly bandLabel: string | null;
  readonly finding: ScreenFindingFilter | null;
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────────
// ⚠ MEMBERSHIP OVER LOWERCASED WORDS, NEVER A BACKSLASH-b REGEX. Six times in this project a word
//   boundary written through tooling became a literal 0x08 backspace — invisible in every listing,
//   matching nothing. A membership test cannot be corrupted that way and reads the same.
const wordsOf = (raw: string): Set<string> =>
  new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));

const padded = (raw: string): string =>
  ` ${raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim()} `;

/**
 * The reader wants a COLLECTION rather than a reading of one thing.
 *
 * ⚠ A MARKET NOUN IS THE PRIMARY SIGNAL AND IT IS STRUCTURAL. "stocks" / "companies" / "names" is the
 *   reader stating the subject of their sentence, and a sentence whose subject is a set of companies
 *   is not a sentence asking what a word means — whatever defined terms it goes on to use.
 */
const ENUMERATE = ["list", "lists", "which", "find", "show", "give", "count",
  "counting", "many", "every", "all", "any"];

export function setIntent(raw: string): boolean {
  const w = wordsOf(raw);
  if (MARKET_NOUNS.some((n) => w.has(n))) return true;
  return ENUMERATE.some((n) => w.has(n));
}

/**
 * ★ A COUNT IS A LEGITIMATE ANSWER SHAPE, and the reader says so plainly.
 *
 * ⚠ IT IS NOT A DIFFERENT QUESTION FROM THE LIST — it is the same set, reported as its size first.
 *   So this decides PRESENTATION only; the filter, the denominator and the three finding states are
 *   identical either way. Answering "how many" with a twelve-row table and no number is the failure
 *   this exists to name.
 */
export function countAsked(raw: string): boolean {
  const p = padded(raw);
  const w = wordsOf(raw);
  return p.includes(" how many ") || p.includes(" number of ") || w.has("count") || w.has("tally");
}

// ── the band filter ───────────────────────────────────────────────────────────────────────────────
/**
 * ★ THE FIVE LABELS ARE A CLOSED, PUBLISHED SET, so this needs no vocabulary of its own: `parseBand`
 *   is the SAME parser the screen service uses for `ScreenRequest.band`, and a word that is not one of
 *   the five resolves to nothing. A second band parser is how "Below Par" stops resolving on exactly
 *   one surface — that comment is `parseBand`'s own, and it applies here.
 *
 * ⚠ "Below Par" IS TWO WORDS, so a word-by-word pass cannot see it. The published labels are matched
 *   as PHRASES, longest first, which also stops "par" alone counting as anything.
 */
const BAND_PHRASES: readonly (readonly [LabelBand, string])[] = (
  Object.entries(BAND_LABEL) as [LabelBand, string][]
)
  .map(([b, label]) => [b, label.toLowerCase()] as const)
  .sort((a, b) => b[1].length - a[1].length);

export function extractBand(raw: string): LabelBand | null {
  const p = padded(raw);
  for (const [band, phrase] of BAND_PHRASES) {
    if (p.includes(` ${phrase} `) && parseBand(phrase) === band) return band;
  }
  return null;
}

// ── the finding filter ────────────────────────────────────────────────────────────────────────────
/**
 * ★ THE RULE VOCABULARY IS PROJECTED FROM `FILING_REGISTRY`, NEVER TRANSCRIBED — the same discipline
 *   `FILING_CHANNEL_KEYS` states one file over. Those 22 entries are exactly the rules that write
 *   `stock_findings` rows, so a rule a reader could name and the screen could not run cannot exist.
 *
 * Two surfaces per rule, and both come off registries we already hold:
 *   · the catalogue's display NAME  — "Pledging Crisis", "Promoter Exit"
 *   · the rule key's own words      — `ownership_R2_promoter_exit` → "promoter exit"
 *
 * ⚠ THE KEY'S WORDS ARE WHAT READERS ACTUALLY TYPE. Nobody types "Pledging Crisis"; the two observed
 *   questions typed "pledging red flag", and readers type "promoter exit flag". Matching the display
 *   name alone is why `definitionKeyFor("how many stocks are showing pledging red flag")` returned
 *   the GENERIC what-a-flag-is concept rather than R1.
 */
interface FindingHandle {
  readonly ruleKey: string;
  readonly kind: "red_flag" | "pattern";
  readonly name: string;
  /** Lowercased phrases that name this rule. Longest wins; a tie refuses. */
  readonly phrases: readonly string[];
}

/** `ownership_R2_promoter_exit` → "promoter exit". Pillar prefix and rule ref dropped, never a list. */
function handleFromKey(ruleKey: string): string {
  const parts = ruleKey.split("_");
  // Drop the leading pillar/family segment, then any segment that is a rule REF (R1, P11, N5, H…).
  const rest = parts.slice(1).filter((p) => !/^[A-Z]+[0-9]*$/.test(p));
  return rest.join(" ").toLowerCase();
}

const FINDING_HANDLES: readonly FindingHandle[] = FILING_REGISTRY.map((e) => {
  const name = (STOCK_FINDINGS as Record<string, { name?: string }>)[e.ruleKey]?.name ?? "";
  const fromKey = handleFromKey(e.ruleKey);
  const phrases = [name.toLowerCase(), fromKey].filter((p) => p.length > 0);
  return { ruleKey: e.ruleKey, kind: e.kind, name: name || fromKey, phrases };
});

/**
 * ★ READERS SAY "pledging", THE KEY SAYS "pledge". A shared prefix of five characters is the whole of
 *   the stemming, and it is deliberately crude: it joins pledge/pledging/pledged and
 *   receivable/receivables without a stemmer, a dictionary, or a per-rule alias table that would be a
 *   fifth place a rule's name lives.
 *
 * ⚠ FIVE, NOT FOUR. At four "exit"/"exits" would join "exist", and at three almost everything joins.
 */
const STEM = 5;
const wordMatches = (a: string, b: string): boolean =>
  a === b
  || (a.length >= STEM && b.length >= STEM && a.slice(0, STEM) === b.slice(0, STEM));

function phraseIn(sentence: readonly string[], phrase: string): boolean {
  const want = phrase.split(" ").filter(Boolean);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= sentence.length; i++) {
    let all = true;
    for (let j = 0; j < want.length; j++) {
      if (!wordMatches(sentence[i + j]!, want[j]!)) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

/** The words that say a sentence is about our CHECKS at all. */
const RED_FLAG_WORDS = ["flag", "flags", "flagged", "red"];
const PATTERN_WORDS = ["pattern", "patterns"];
const CHECK_WORDS = [...RED_FLAG_WORDS, ...PATTERN_WORDS, "finding", "findings", "warning", "warnings",
  "concern", "concerns", "issue", "issues", "problem", "problems", "check", "checks"];

/**
 * ★ A KIND, WHEN NO SINGLE RULE WAS NAMED. "Which stocks have red flags" is a real and common ask and
 *   has no rule in it at all.
 *
 * ⚠ `redFlags: "any"` ALREADY EXISTED ON `ScreenRequest` AND SAW ONLY THE 95 SCORED. The finding layer
 *   answers the same question over 2,291, which is a different and much larger set — see
 *   `composeFindingScreenAnswer` for why that denominator is said out loud rather than implied.
 */
export function findingKindAsked(raw: string): "red_flag" | "pattern" | null {
  const w = wordsOf(raw);
  if (RED_FLAG_WORDS.some((x) => w.has(x))) return "red_flag";
  if (PATTERN_WORDS.some((x) => w.has(x))) return "pattern";
  return null;
}

/**
 * Which rule did the reader name? Longest handle wins; **a tie returns nothing**, which is the rule
 * `matchPondName` states for peer groups and the metric-gloss alias matcher states for "ROA".
 *
 * ⚠ A ONE-WORD HANDLE NEEDS A CHECK WORD BESIDE IT, AND R6 IS WHY. `ownership_R6_distribution`'s
 *   handle is the single word "distribution", and "what is the distribution of stocks across the
 *   bands" is a question about the BAND SPREAD, not about R6. A two-word phrase out of our own
 *   registry is not typed by accident; a single common noun is. So "distribution pattern" reaches R6
 *   and a bare "distribution" does not — and the same guard covers "pledge", "accruals",
 *   "receivables" and "deleveraging" without naming any of them.
 */
export function matchFindingRule(raw: string): FindingHandle | null {
  const sentence = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean);
  if (sentence.length === 0) return null;
  const hasCheckWord = sentence.some((x) => CHECK_WORDS.includes(x));

  let best: FindingHandle | null = null;
  let bestLen = 0;
  let tied = false;
  for (const h of FINDING_HANDLES) {
    for (const phrase of h.phrases) {
      if (!phraseIn(sentence, phrase)) continue;
      const words = phrase.split(" ").length;
      if (words === 1 && !hasCheckWord) continue;
      if (phrase.length === bestLen && best && best.ruleKey !== h.ruleKey) { tied = true; continue; }
      if (phrase.length <= bestLen) continue;
      bestLen = phrase.length;
      tied = false;
      best = h;
    }
  }
  return tied ? null : best;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE DETECTOR. One function, two consumers, and they cannot disagree about what a screen is.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export function screenAsk(raw: string): ScreenAsk | null {
  const shape: ScreenShape = countAsked(raw) ? "count" : "list";

  // ── 1 · A NUMERIC CONDITION IS A SCREEN ON ITS OWN, AND THAT IS UNCHANGED BEHAVIOUR.
  //    `extractConditions` needs a field, a comparator AND a number. Nobody asks what a term means
  //    with a threshold in the sentence, so no set intent is required to believe this one.
  const conditions = extractConditions(raw);
  // ★ AND THE FILED LINE ITEMS, on the same terms: a field, a comparator and a number, or nothing.
  //   `revenue above 100cr` is as unambiguous a screen as `ROE above 20`, and neither needs a set
  //   intent to be believed.
  const lineItems = extractLineItemConditions(raw);
  // ⚠ A NAMED BASIS IS THE READER'S AND OVERRIDES THE FAMILY DEFAULT. Unnamed, `chooseBasis` decides.
  const basis: "standalone" | "consolidated" | null =
    /\bconsolidated\b/i.test(raw) ? "consolidated" : /\bstandalone\b/i.test(raw) ? "standalone" : null;

  // ── 2 · THE OTHER TWO FILTERS ARE DEFINED TERMS, and a defined term is exactly what a definition
  //    question names. So they count as a FILTER only where the sentence also asks for a set —
  //    which is the whole distinction between the two observed failures and "what does pristine mean".
  const intent = setIntent(raw);
  const band = intent ? extractBand(raw) : null;
  const finding = intent ? matchFindingRule(raw) : null;
  const kind = intent && !finding ? findingKindAsked(raw) : null;

  if (conditions.length === 0 && lineItems.length === 0 && !band && !finding && !kind) return null;

  // ── 3 · WHICH LAYER. A finding filter reaches every stock we hold; a metric or band filter reaches
  //    the scored universe alone. Where both are named the finding layer answers, because it is the
  //    one that can carry the band as a column and not the other way round — see the composer.
  if (finding || kind) {
    return {
      shape,
      lineItems,
      basis,
      layer: "finding",
      conditions,
      band,
      bandLabel: band ? BAND_LABEL[band] : null,
      finding: finding
        ? { ruleKey: finding.ruleKey, name: finding.name, kind: null }
        : { ruleKey: null, name: null, kind },
    };
  }

  return {
    shape,
    lineItems,
    basis,
    // ⚠ THE LAYER NAMES WHICH POPULATION LEADS, not which conditions exist. A sentence carrying both
    //   a scored condition and a filed one is `metric` — because the intersection can only be as wide
    //   as the narrower side, and the scored side is 95 against 2,284. The composer states that.
    layer: "metric",
    conditions,
    band,
    bandLabel: band ? BAND_LABEL[band] : null,
    finding: null,
  };
}
