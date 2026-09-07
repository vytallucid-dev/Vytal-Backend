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
import { MARKET_NOUNS, definitionAsked } from "../router/question-shape.js";
import { POND_CONTAINER_WORDS } from "../resolve/peer-group.js";
import { namesFiledField } from "./line-item-conditions.js";
import { PRICE_METRICS } from "./screen-grammar.js";
import { parseBand } from "../scoring/read/universe-projection.service.js";
import { BAND_LABEL } from "../scoring/read/universe-projection.types.js";
import type { LabelBand } from "../scoring/read/health-view.types.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import { SCREEN_FIELDS, SCREEN_FIELDS_IDS } from "../scoring/read/screen.types.js";
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
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A RANKING IS A SET REQUEST, AND THE DETECTOR HAD TO LEARN IT TOO.
 *
 * ⚠ MEASURED: "top 10 stocks by revenue" REACHED THE DEFINITION CARD. It carries no comparator, no
 *   number, no band, no finding and no sector — nothing the detector recognised as a filter — so it
 *   was not a screen, while the parser and the evaluator could both answer it completely. The same
 *   shape of gap as the sector one, one clause along.
 *
 * ⚠ AND IT MATTERS MORE THAN IT LOOKS, because `declinedFrame` claims "top" as a SUPERLATIVE. Without
 *   this, the best case was a frame decline — a health ranking substituted for the revenue ranking the
 *   reader actually named. Now `screenAsk` runs first and the reader gets what they asked for.
 *
 * ★ AND IT IS NOT A LICENCE TO INVENT A LEADERBOARD. The ranking word alone is not enough: the
 *   sentence must also NAME A FIELD from the derived vocabulary, so "the best stocks" still has no
 *   basis and still reaches the frame decline. SC-12 is intact — the reader names what to rank on.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
const RANK_WORDS = ["top", "largest", "biggest", "highest", "most", "lowest", "smallest", "cheapest",
  "ranked", "rank", "leading", "bottom", "least"];

export function rankAsked(raw: string): boolean {
  const w = wordsOf(raw);
  // ★ "NEAR ITS 52-WEEK HIGH" IS A RANKING, and it is the one phrasing with no rank word in it.
  //   The reader named a basis and no bound, which is exactly what an ordering is for — and it is
  //   the honest answer to a question we must not invent a cut-off for.
  if (/\b(near|close to|approaching)\b/i.test(raw) && namesPriceField(raw)) return true;
  if (!RANK_WORDS.some((x) => w.has(x))) return false;
  // ★ THE BASIS MUST BE A FIELD WE HOLD. A superlative with nothing to rank on is a frame we decline.
  return namesFiledField(raw) !== null || namesPriceField(raw) || namesReturnWindow(raw)
    || namesScoredField(raw) || SCORED_LABEL_WORDS.some((x) => w.has(x));
}

/**
 * ★ DOES THE SENTENCE NAME A SCORED FIELD? — DERIVED FROM THE SCORED REGISTRY, not from a word list.
 *
 * ⚠ THE WORD LIST MISSED THE METRICS. It held the five pillar names, so "top 10 by health score"
 *   worked and "banks with return on equity above their peer group median" REACHED THE DEFINITION
 *   CARD — `returnOnEquity` is a scored field with a perfectly good label, and nothing here read it.
 *
 * ★ SO IT READS `SCREEN_FIELDS` ITSELF. A metric added to the scored set becomes askable by the
 *   detector in the same edit, which is the whole reason the filed vocabulary is generated too.
 */
const SCORED_PHRASES: readonly string[] = SCREEN_FIELDS_IDS
  .flatMap((id) => [id, SCREEN_FIELDS[id].label])
  .map((x) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/ +/g, " ").trim()} `);

export function namesScoredField(raw: string): boolean {
  const hay = padded(raw);
  return SCORED_PHRASES.some((x) => hay.includes(x));
}

/** The five pillar words, kept because "health"/"score" appear alone in ordinary phrasings. */
const SCORED_LABEL_WORDS = ["health", "score", "foundation", "momentum", "ownership"];

/**
 * ★★ A PLEDGE THRESHOLD — and the NUMBER is what tells it from the check.
 *
 * ⚠ "Stocks with pledging above 30%" REACHED CLARIFYING CHIPS. "Pledge" is a one-word rule handle, so
 *   `matchFindingRule` requires a check word beside it ("flag", "red") — correctly, or the bare word
 *   "distribution" would claim R6. But a reader who typed a COMPARATOR AND A PERCENTAGE has not asked
 *   about a check at all; they have named a bound, and R1's bar is fixed at half.
 *
 * ★ SO THE DISAMBIGUATOR IS THE NUMBER, which is exactly what the two questions differ by:
 *     "pledging red flag"        → the R1 finding, fixed bars
 *     "pledging above 30%"       → a threshold the reader chose
 */
/**
 * ★ THE PRICE WORDS — the fourth thing the detector had to learn this batch, and by now the pattern
 *   is the point: every new LEAF kind needs the detector taught alongside the parser, or the question
 *   never reaches the parser at all. Sector, then ranking, then pledge, now price.
 *
 * ⚠ THEY COME FROM `PRICE_METRICS`, not from a list typed here. A second spelling of "market cap"
 *   would be a vocabulary the detector accepts and the validator refuses — the reader gets a screen
 *   that opens and then says their field does not exist.
 */
const PRICE_PHRASES: readonly string[] = Object.values(PRICE_METRICS)
  .flatMap((m) => [m.label, ...m.aliases])
  .map((x) => ` ${x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim()} `);

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A RETURN QUESTION NAMES NO FIELD — IT NAMES A WINDOW.
 *
 * ⚠ "Companies up more than 50% in the last year" REACHED THE CLARIFYING CHIPS. Every predicate above
 *   looks for a FIELD NAME, and this sentence has none: the thing being measured is implied by the
 *   period ("in the last year") and the direction ("up"). No alias list of return phrasings would have
 *   caught it either, because the reader never says the word "return".
 *
 * ★ SO THE SIGNAL IS THE PAIR: a movement word AND a time window. Either alone is ordinary English —
 *   "up" appears everywhere, and "last year" appears in questions about filings — and together they
 *   are a question about what the price did.
 *
 * ⚠ AND IT CANNOT SWALLOW A TREND. A trend question names a FILED FIELD ("revenue growing for four
 *   straight quarters"); this one names none, and `trendAsked` requires one. The two are decided by
 *   what else is in the sentence, not by a shared word list.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
const MOVE_WORDS = ["up", "down", "gained", "gain", "lost", "returned", "rose", "fell", "fallen",
  "risen", "jumped", "dropped", "surged", "declined", "rallied", "gainers", "losers"];

const WINDOW_PHRASES: readonly string[] = [
  "in the last year", "in the past year", "over the last year", "over the past year", "in a year",
  "in one year", "last year", "past year", "this year", "year to date", "ytd", "in 12 months",
  "in the last 12 months", "over 12 months",
  "in the last month", "in a month", "last month", "past month", "over the last month",
  "in the last 3 months", "in three months", "in the last three months", "last 3 months",
  "over the last 3 months", "in 3 months", "last three months",
  "in the last 6 months", "in six months", "last 6 months", "in the last six months",
  "over the last 6 months", "in 6 months", "last six months",
];

export function namesReturnWindow(raw: string): boolean {
  const w = wordsOf(raw);
  if (!MOVE_WORDS.some((x) => w.has(x))) return false;
  const hay = padded(raw);
  return WINDOW_PHRASES.some((x) => hay.includes(` ${x} `));
}

export function namesPriceField(raw: string): boolean {
  const hay = ` ${raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim()} `;
  return PRICE_PHRASES.some((p) => hay.includes(p));
}

/** A comparator followed by a number — the shape `extractConditions` insists on. One home, two users. */
const COMPARATOR_THEN_NUMBER =
  /(above|over|below|under|more than|less than|at least|at most|greater than|under a|within|>=?|<=?)\s*(a\s+)?\d/i
  // ⚠ "WITHIN 10% OF ITS 52-WEEK HIGH" CARRIED NO COMPARATOR THIS KNEW, so the headline question for
  //   the whole 52-week feature reached the clarifying chips. "within" is a bound like any other.
  ;

/**
 * ★ A MOVEMENT WORD CAN CARRY THE NUMBER ITSELF — "up 50% in the last year" states a bound with no
 *   comparator in it at all, and it is how readers actually ask about returns.
 */
const MOVE_THEN_NUMBER = /\b(up|down|gained|lost|rose|fell|risen|fallen|jumped|dropped|surged|returned)\s+(?:by\s+)?\d/i;

/**
 * ★ A TREND IS A SCREEN, and it carries no comparator and no number of its own — "companies whose
 *   revenue has grown for four straight quarters" has a 4 in it that is a COUNT OF QUARTERS, not a
 *   bound, so every predicate above would have passed it over.
 *
 * ⚠ THE MOVEMENT WORD ALONE IS NOT ENOUGH. "Growing companies" names nothing to measure growth in,
 *   and answering it would mean choosing the field ourselves — the same ruling that keeps "the best
 *   stocks" a frame we decline. The sentence must also name a field we hold.
 */
const TREND_WORDS = ["growing", "grown", "grew", "rising", "risen", "increasing", "increased",
  "improving", "improved", "falling", "fallen", "declining", "declined", "shrinking", "dropping",
  "consecutive", "straight", "streak"];

/**
 * ★ A COMPARISON AGAINST THE READER'S OWN GROUP — "cheaper than its sector median".
 *
 * ⚠ IT CARRIES NO NUMBER AT ALL, so every bound-shaped predicate here passes it over. The signal is a
 *   BENCHMARK WORD beside a group word, which is the only thing such a question has in common.
 */
const BENCHMARK_WORDS = ["median", "average", "typical", "peers", "peer", "rest"];

export function relativeAsked(raw: string): boolean {
  const w = wordsOf(raw);
  const hay = padded(raw);
  const named = BENCHMARK_WORDS.some((x) => w.has(x))
    || hay.includes(" than its sector ") || hay.includes(" than their sector ");
  if (!named) return false;
  // ★ AND SOMETHING TO COMPARE ON. "Better than its peers" names no measure, and choosing one would
  //   be the frame we decline — see `rankAsked` for the same rule one clause along.
  return namesFiledField(raw) !== null || namesPriceField(raw)
    || namesScoredField(raw) || SCORED_LABEL_WORDS.some((x) => w.has(x));
}

/**
 * ★ HOW MUCH A FIGURE MOVED — a movement word, a percentage, and a period, without a price window.
 *
 * ⚠ THIS IS NOT `namesReturnWindow`. That one is about the SHARE PRICE over a calendar window; this
 *   is about a FILED FIGURE between two reporting periods. They are told apart by whether the
 *   sentence names a filed field: "up 50% in the last year" is the price, "revenue up 20% year on
 *   year" is the statement.
 */
export function growthAsked(raw: string): boolean {
  if (namesFiledField(raw) === null) return false;
  const hay = padded(raw);
  const period = hay.includes(" year on year ") || hay.includes(" yoy ")
    || hay.includes(" quarter on quarter ") || hay.includes(" qoq ")
    || hay.includes(" year over year ") || hay.includes(" from a year ago ")
    || hay.includes(" compared to last year ") || hay.includes(" versus last year ");
  if (!period) return false;
  return COMPARATOR_THEN_NUMBER.test(raw) || MOVE_THEN_NUMBER.test(raw);
}

export function trendAsked(raw: string): boolean {
  const w = wordsOf(raw);
  const moved = TREND_WORDS.some((x) => w.has(x))
    || / in a row\b/i.test(raw) || /\bquarter (on|over) quarter\b/i.test(raw)
    // ★ THE LOOSE FORM CARRIES NO TREND WORD AT ALL. "Revenue up in 3 of the last 4 quarters"
    //   reads as ordinary English — the shape "N of the last M quarters" is the whole signal.
    || /\b\d+\s+of\s+(?:the\s+)?(?:last\s+|past\s+)?\d+\s+quarters?\b/i.test(raw);
  if (!moved) return false;
  return namesFiledField(raw) !== null;
}

const PLEDGE_WORDS = ["pledge", "pledged", "pledging", "pledges"];

export function pledgeThresholdAsked(raw: string): boolean {
  const w = wordsOf(raw);
  if (!PLEDGE_WORDS.some((x) => w.has(x))) return false;
  // A comparator AND a number, in that order — the same shape `extractConditions` insists on.
  return COMPARATOR_THEN_NUMBER.test(raw);
}

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
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A SECTOR IS A FILTER, AND THE DETECTOR HAD TO LEARN IT — measured, and it cost a whole capability.
 *
 * ⚠ "Banks and NBFCs with pledging above 50%" REACHED CLARIFYING CHIPS. The model parses it perfectly
 *   — `(Banks OR NBFC & Others) AND Pledging Crisis` — but the parser never ran, because `screenAsk`
 *   decides IF a sentence is a screen and it knew nothing about sectors: no numeric bound, no band,
 *   and "pledging" is a one-word rule handle that needs a check word beside it. So the detector said
 *   "not a screen" about a question the rest of the system could answer completely.
 *
 * ★ AND IT IS REGISTRY-RESOLVED LIKE EVERY OTHER FILTER. The 24 sector names come from the database,
 *   passed in by the caller rather than read here, so this function stays pure and a word that is not
 *   one of our sectors still resolves to nothing. A reader types "pharma" for "Pharma & Healthcare",
 *   so the FIRST word of a sector name is what is matched, at four characters or more.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function sectorNamed(raw: string, sectorNames: readonly string[]): string | null {
  if (sectorNames.length === 0) return null;
  const hay = ` ${raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim()} `;
  let best: string | null = null;
  let bestLen = 0;
  for (const sec of sectorNames) {
    const full = sec.toLowerCase();
    if (hay.includes(` ${full} `) && full.length > bestLen) { best = sec; bestLen = full.length; }
    const head = full.split(/[^a-z]+/).filter((w) => w.length >= 4)[0];
    if (head && hay.includes(` ${head}`) && head.length > bestLen) { best = sec; bestLen = head.length; }
  }
  return best;
}

export function screenAsk(raw: string, sectorNames: readonly string[] = []): ScreenAsk | null {
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
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ A SECTOR NAME IS ITSELF A SET INTENT, AND WITHOUT THAT A WHOLE CLASS NEVER REACHED THE PARSER.
  //
  // ⚠ MEASURED: "banks and NBFCs with pledging above 50%" REACHED CLARIFYING CHIPS. It carries no
  //   market noun — no "stocks", no "companies" — and no enumeration verb, so `setIntent` said no and
  //   the detector never asked. The model parses that sentence perfectly.
  //
  // ★ "Banks" IS A SET OF COMPANIES. A sector name is not a filter that needs a subject beside it; it
  //   IS the subject, in the plural, and a reader naming one has named a set.
  //
  // ⚠ AND THE ONE THING THAT MUST STILL WIN IS A DEFINITION. "What is the banking sector" names a
  //   sector and is a question about a word — so the guard is `definitionAsked`, which is an existing
  //   tested gate rather than a new list of phrases. Reusing it is what keeps this from becoming the
  //   fifth occurrence of the class this file was written for.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const sectorHit = sectorNamed(raw, sectorNames);
  const ranked = rankAsked(raw);
  const pledgeBound = pledgeThresholdAsked(raw);
  // ★ A PRICE FIELD WITH A BOUND IS A SCREEN. "Market cap above 50,000 cr" names no filed column, so
  //   nothing else in this function would have recognised it.
  const priceBound = (namesPriceField(raw) || namesReturnWindow(raw))
    && (COMPARATOR_THEN_NUMBER.test(raw) || MOVE_THEN_NUMBER.test(raw));
  const trending = trendAsked(raw);
  const growing = growthAsked(raw);
  const relative = relativeAsked(raw);
  // ⚠ AND NOT INSIDE A POND QUESTION. "How is the large-cap pharma peer group doing" names a sector
  //   and belongs to PG, which answers it with a roster and a distribution strip. Letting the sector
  //   make it a screen took the question AND left `distribution-strip` with no caller at all — both
  //   caught by the invariants rather than by reasoning. `POND_CONTAINER_WORDS` is the pond family's
  //   own list, imported rather than copied.
  const pondShaped = POND_CONTAINER_WORDS.some((w) => wordsOf(raw).has(w));
  const intent = setIntent(raw) || ranked || pledgeBound || priceBound || trending || growing || relative
    || (sectorHit !== null && !definitionAsked(raw) && !pondShaped);
  const band = intent ? extractBand(raw) : null;
  const finding = intent ? matchFindingRule(raw) : null;
  const kind = intent && !finding ? findingKindAsked(raw) : null;
  const sector = intent ? sectorHit : null;

  // ★ A RANKING IS ITSELF A REASON TO SCREEN — there may be no filter at all, and "the 10 largest by
  //   revenue" is still a set. The tree the fallback builds would be empty, so the parsed path is the
  //   only one that can answer it; where the parse is unavailable the ask falls through as before.
  if (conditions.length === 0 && lineItems.length === 0 && !band && !finding && !kind && !sector
      && !ranked && !pledgeBound && !priceBound && !trending && !growing && !relative) return null;

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
