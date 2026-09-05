// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUESTION SHAPE — properties of the SENTENCE, read by code rather than by the model.
//
// ── ★ WHY THESE LIVE IN THE ROUTER AND NOT IN THE COMPOSER ────────────────────────────────────────
// Both answer "what kind of question is this?", which is the router's whole job. They were written at
// the composer first and that put them on the wrong side of a boundary: `route()` needs them to
// decide whether a follow-up may inherit slots from the previous turn, and a router importing from
// the composer would invert the layering. One home, two consumers (N-3, N-5).
//
// ── ★ WORD MEMBERSHIP, NEVER REGEX LITERALS ───────────────────────────────────────────────────────
// Four times in this build a `\b` written into a regex through a script became a literal 0x08
// backspace — invisible in every listing and matching nothing. A membership test over lowercased
// words cannot be corrupted that way and reads the same.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const wordsOf = (raw: string): Set<string> =>
  new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));

/** Words carrying neither subject nor operation — what a bare mention may be dressed in. */
const FILLER = new Set(["the", "a", "an", "about", "on", "for", "please", "pls", "info", "stock", "share"]);

/**
 * Is the whole question just a subject the model already named? Punctuation and filler ignored.
 *
 * ★ TYPING "TCS" AND NOTHING ELSE RETURNED A FULL SEVEN-SECTION ORIENTATION. The classifier reads a
 * lone ticker as `orient` with high confidence, which is a guess dressed as a reading: the reader
 * named a subject and no operation.
 */
export function isBareSubject(text: string, mentions: readonly { text: string }[]): boolean {
  if (mentions.length === 0) return false;
  const split = (x: string) =>
    x.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/ +/).filter(Boolean).filter((w) => !FILLER.has(w));
  const asked = split(text);
  if (asked.length === 0) return false;
  const named = new Set(mentions.flatMap((m) => split(m.text)));
  // Every word the reader typed belongs to a subject they named — so they named a subject and asked
  // nothing about it.
  return asked.every((w) => named.has(w));
}

/**
 * ★ IS THE READER ASKING FOR ADVICE RATHER THAN FOR A READING?
 *
 * "should I buy TCS?" classifies `operation: "unresolved"` — correctly, because the operation
 * vocabulary describes READS and a recommendation is not one — and then fell to clarifying chips, so
 * the product answered a perfectly clear question with "I am not sure what you are asking about".
 * That is the worst of both: we gave neither the advice nor the analysis.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ DETECT THE ACT, NOT THE GRAMMAR — F-1, and the previous version had it exactly inverted.
 *
 * ⚠ IT REQUIRED A POLITENESS WORD. `asks` was {should, worth, recommend, advice, advise} AND `acts`
 *   was a verb — so the decline fired only on a POLITELY PHRASED request. Measured live, a four-step
 *   ladder on one conversation:
 *
 *     "should I buy TCS?"                        → declined correctly
 *     "come on, just tell me whether to buy it"  → fell through
 *     "buy TCS or not?"                          → fell through
 *     "yes or no: buy TCS"                       → fell through
 *
 *   All three fell to "I am not sure what you are asking about" — to an unmistakable request to buy.
 *   The blunter and more insistent the reader got, the likelier we feigned incomprehension, which is
 *   the inverse of the policy. DX-15's test is explicitly a FOURTH rephrasing.
 *
 * ★ THE RULING: a buy/sell/hold verdict sought on a named security is an advice request whether it
 *   arrives as a question, an imperative, an ellipsis or a yes/no framing. So the STRONG verbs need no
 *   frame at all — the act IS the signal — and the answer is identical every time it fires: decline
 *   the frame, deliver the full analysis, no escalation and no softening.
 *
 * ⚠ THE WHOLE DIFFICULTY IS THE OTHER DIRECTION, AND IT HAS A LIVE ROW ALREADY. "Have INFY insiders
 *   been buying or selling" is a DEALING question — OA's, and the one the T08 misroute got wrong —
 *   and it contains two act verbs. So the exclusions are not politeness in disguise; they are the
 *   ACTOR test. Somebody else's trade is a fact about the register. The reader's own trade is advice.
 *
 * ⚠ AND `hold` / `enter` / `exit` ARE WEAK ON PURPOSE. "How many shares do promoters hold" and "how
 *   much debt does TCS hold" are ordinary questions; those three earn a decision frame before they
 *   count. `bought` and `sold` are absent from the act set entirely — a past tense is a fact.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The act needs no frame — asking it at all is asking for a verdict on a trade. */
const STRONG_ACT = ["buy", "buying", "sell", "selling", "invest", "investing", "accumulate",
  // ⚠ THE -ing FORMS ARE NOT DECORATION. "Thinking of accumulating INFY" missed the first draft of
  //   this list, and a reader musing is asking as plainly as a reader demanding.
  "accumulating", "offload", "offloading", "dump", "dumping", "short", "shorting", "purchase", "purchasing"];
/** Ordinary words in ordinary questions; these earn a decision frame before they count as an ask. */
const WEAK_ACT = ["hold", "holding", "enter", "exit", "book"];
/** ⚠ SOMEBODY ELSE'S TRADE. The presence of any of these means the sentence is about the register. */
const THIRD_PARTY = ["insider", "insiders", "promoter", "promoters", "fii", "fiis", "dii", "diis",
  "institution", "institutions", "institutional", "mutual", "fund", "funds", "director", "directors",
  "board", "management", "shareholder", "shareholders"];
/** A trade already made is a fact, never a request for one. */
const HISTORICAL = ["did", "when", "bought", "sold", "historically", "previously"];
/** What turns a weak act into a request for a verdict. */
const DECISION = ["should", "worth", "recommend", "recommends", "recommendation", "advice", "advise",
  // ⚠ "time" IS HERE FOR "time to exit TCS?" — the commonest way the weak verbs are made into an ask,
  //   and the one shape of it that carries no other decision word at all.
  "advisable", "whether", "good", "better", "best", "yes", "no", "or", "time"];

export function isAdviceShaped(raw: string): boolean {
  const w = wordsOf(raw);
  const any = (xs: readonly string[]) => xs.some((x) => w.has(x));

  // ★ THE ACTOR TEST FIRST. It is the only thing standing between this and OA's dealing questions,
  //   and running it before anything else makes that impossible to lose in a later edit.
  if (any(THIRD_PARTY)) return false;
  if (any(HISTORICAL)) return false;

  if (any(STRONG_ACT)) return true;
  return any(WEAK_ACT) && any(DECISION);
}

/**
 * ★ IS THIS QUESTION COMPLETE ON ITS OWN?
 *
 * ⚠ THE ONE GUARD THAT KEEPS FOLLOW-UP INHERITANCE FROM UNDOING THE OTHER TWO RULES, AND BOTH
 *   FAILURES WERE FOUND OVER LIVE HTTP RATHER THAN IN A PROBE.
 *
 * `route()` fills an `unresolved` operation from the previous turn. Both shapes above deliberately
 * PRODUCE an `unresolved` operation — that is their whole point — so inheritance saw the hole they
 * had just made and filled it, silently reverting the rule one step later:
 *
 *   "how is HDFC doing" → (chips) → "TCS"          inherited `orient`, gave a full orientation
 *   "why did TCS fall today?" → "should I buy TCS?" inherited `explain`, so the decline never fired
 *
 * Neither appeared in the unit probes, because a probe passes no prior turn and the two rules
 * therefore never met. A self-contained question keeps its own unresolved operation.
 */
export const isSelfContained = (text: string, mentions: readonly { text: string }[]): boolean =>
  isBareSubject(text, mentions) || isAdviceShaped(text);

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ IS THE READER ASKING FOR A CONCLUSION WE DO NOT EMIT? — SC-05 and SC-12, added Phase 1 · Batch 2.
 *
 * "Show me undervalued stocks" and "what are the best stocks to buy" are legitimate questions with an
 * illegitimate FRAME: `undervalued` and `best` are verdicts, and we publish readings. The bank calls
 * these frame DECLINES rather than refusals, and the distinction is the whole point — there is a real
 * factual screen underneath each, and the reader is entitled to it.
 *
 * ⚠ WHAT THEY DO TODAY, MEASURED ON THE LIVE ROUTER, AND BOTH ARE WRONG IN DIFFERENT DIRECTIONS:
 *
 *   "show me undervalued stocks"      → `screen · valuation`, no conditions extracted → and
 *      `compose.ts` step 3g falls through to the WHOLE-UNIVERSE band distribution. The reader gets 95
 *      companies spread across five bands, with nothing anywhere saying their criterion was dropped.
 *      Every figure is real; the answer is to a question nobody asked.
 *
 *   "what are the best stocks to buy" → **`out_of_scope`**, so the reader is told "that is outside
 *      what Vytal covers — we read Indian listed companies' financials". That sentence is FALSE about
 *      this question: it is exactly about Indian listed companies. A refusal that misdescribes our own
 *      coverage is worse than a decline, because the reader now believes we hold less than we do.
 *
 * ★ TWO FRAMES, NOT ONE, BECAUSE THE HONEST SUBSTITUTE DIFFERS.
 *
 *   `valuation` — we hold NO valuation multiple a screen can filter on. `SCREEN_FIELDS_IDS` is nine
 *     score/metric fields and not one of them is a price ratio, and that is structural rather than a
 *     gap someone forgot: the screen reads `score_metrics.raw_value`, which has no price in it. So the
 *     decline here is total for the criterion asked, and the substitute answers a DIFFERENT question.
 *
 *   `superlative` — "best" has no definition we publish, but "highest health score" is a real ranking
 *     over a real set, and it is what a reader means often enough that offering it is useful rather
 *     than evasive.
 *
 * ⚠ NEITHER IS A LICENCE TO GUESS A THRESHOLD. The substitute is a RANKING, not a filter — see
 *   `composeFrameDeclinedScreen`. A cut-off invented here would be a number nobody typed selecting
 *   the rows a reader then reads as their answer.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export type DeclinedFrame = "valuation" | "superlative";

/** Words that make a question about the market at large rather than about one company. */
// ⚠ WIDENED BY THE FIX-1 SWEEP. `declinedFrame` is the OTHER gate whose false negative is a flat
//   REFUSAL rather than a different answer, so a missing noun costs the same as the definition bug:
//   "show me the strongest businesses" was told it is outside our coverage. Measured, 3 of 6
//   phrasings of a declined frame missed.
const MARKET_NOUNS = ["stocks", "stock", "companies", "company", "shares", "share", "names", "picks",
  "businesses", "business", "firms", "counters", "tickers", "ideas"];

export function declinedFrame(raw: string): DeclinedFrame | null {
  const w = wordsOf(raw);
  const aboutMarket = MARKET_NOUNS.some((n) => w.has(n));
  if (!aboutMarket) return null;

  // ⚠ VALUATION FIRST. "best value stocks" carries both a superlative and a valuation word, and the
  //   valuation half is the one with the stronger decline — we cannot screen on price at all, and
  //   saying only "we ranked by health" would leave that unsaid.
  if (w.has("undervalued") || w.has("overvalued") || w.has("cheap") || w.has("cheapest")
      || w.has("expensive") || w.has("value") || w.has("bargain") || w.has("bargains")) {
    return "valuation";
  }
  // ⚠ "quality" AND "good" ARE VERDICTS TOO — "find me quality names" was refused outright.
  if (w.has("best") || w.has("top") || w.has("greatest") || w.has("strongest") || w.has("safest")
      || w.has("quality") || w.has("good") || w.has("solid") || w.has("reliable")
      || w.has("worst") || w.has("good") || w.has("great") || w.has("winners") || w.has("multibagger")
      || w.has("multibaggers")) {
    return "superlative";
  }
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ WHICH HEALTH QUESTION IS THIS — T · TRAJECTORY OR A · ATTRIBUTION? Phase 2 · Batch 1.
 *
 * ⚠ THIS EXISTS BECAUSE THE FIRST DRAFT OF THIS BATCH REINTRODUCED, BETWEEN ITS OWN TWO NEW FAMILIES,
 *   THE EXACT HAZARD IT HAD JUST DELETED `orientation.scored` TO REMOVE.
 *
 *   Both families claim `{operation: [orient, …], lens: [health], subject: required}`, and
 *   `compose.ts` step 4 takes the FIRST match in an ORDERED array. Measured on the composed output:
 *   *"what is dragging TCS's score down"* — a textbook attribution question, and the literal second
 *   example in `attribution.ts` — was answered by `trajectory.arc`, with a phase chart and no
 *   decomposition anywhere in it. Nothing failed; a reasonable answer to a different question
 *   rendered, which is §6.2's confident-wrong-artifact arriving through array position.
 *
 * ★ THE SLOTS CANNOT SEPARATE THEM AND SHOULD NOT BE ASKED TO. "How has TCS's score moved" and "why
 *   is TCS scored that way" are the same operation on the same lens about the same subject. The
 *   difference is entirely in the SENTENCE — one asks about a series, the other about a reading —
 *   which is precisely the class of distinction §6.5 keeps in code rather than in the model.
 *
 * ★ AND IT IS TOTAL AND DISJOINT BY CONSTRUCTION, WHICH IS THE POINT. One function, two values, one
 *   home. Each predicate tests for its own value, so the two cannot both match and cannot both
 *   decline — and the registry's ORDER stops deciding anything. Two independent lambdas ("is time
 *   shaped" in one file, "is not time shaped" in another) would have been two definitions of one
 *   boundary, and the day they drifted a question would match both or neither.
 *
 * ⚠ ATTRIBUTION IS THE DEFAULT, NOT TRAJECTORY. An un-narrowed health question — "how healthy is
 *   RELIANCE" — is a question about where the company stands now, and the standing answer explains
 *   itself. A reader who wanted the history says so, and the words below are how they say it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export type HealthQuestion = "trajectory" | "attribution";

/** Words that make a health question about a SERIES rather than about a reading. */
const TIME_WORDS = [
  "history", "historical", "over", "time", "trend", "trending", "trajectory", "moved", "move",
  "moving", "changed", "changing", "since", "when", "started", "start", "began", "begin",
  "improving", "improved", "worsening", "deteriorating", "declining", "recovering", "progress",
  "quarters", "years", "past", "last", "evolved", "evolution", "been",
];

export function healthQuestion(raw: string): HealthQuestion {
  const w = wordsOf(raw);
  // ⚠ "why" AND "what is dragging" BEAT A TIME WORD, and the ordering is load-bearing rather than
  //   stylistic. "Why has TCS been falling" carries `been` and `falling`, and it is still a question
  //   about causes — the reader wants the parts, not the dates. Only a sentence with a time word and
  //   NO causal word is asking for the series.
  const causal = w.has("why") || w.has("dragging") || w.has("drag") || w.has("because")
    || w.has("driving") || w.has("drives") || w.has("carries") || w.has("carrying")
    || w.has("breakdown") || w.has("composed") || w.has("made");
  if (causal) return "attribution";
  return TIME_WORDS.some((t) => w.has(t)) ? "trajectory" : "attribution";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ IS THE READER ASKING WHAT SOMETHING MEANS? — M · Meta, Phase 2 · Batch 2.
 *
 * ⚠ THIS EXISTS BECAUSE THE TERM LOOKUP IS NOT A ROUTER, AND THE FIRST DRAFT LET IT ACT LIKE ONE.
 *   `lookupConcept("how is the market doing")` returns the Market pillar — correctly, the sentence
 *   contains the term. Measured on the first pass, so did "who are TCS's peers" (→ peer relativity).
 *   Both are questions authored families already answer well, and a definition family that claimed
 *   them would be a regression dressed as a new feature.
 *
 * ★ SO "WHICH TERM" AND "WAS A TERM ASKED FOR" ARE TWO QUESTIONS WITH TWO HOMES. The resolver answers
 *   the first over five vocabularies; this answers the second over the sentence, and only the second
 *   is allowed to route.
 *
 * ⚠ AND IT REQUIRES AN EXPLICIT ASKING SHAPE, NOT MERELY THE ABSENCE OF A COMPANY. "Foundation" typed
 *   alone is a bare subject and goes to the bare-subject path; "what does Foundation mean" is a
 *   question. Requiring the shape rather than inferring it from what is missing is what keeps this
 *   from swallowing every subjectless turn.
 *
 * ⚠ THIS FUNCTION RETURNS TRUE FOR "what is TCS's revenue", AND THAT IS CORRECT AND HARMLESS. It IS a
 *   what-is question; what makes it a data question rather than a definition is that it NAMES A
 *   COMPANY. That is `Predicate.subject: "none"`'s job and it is checked structurally, before this is
 *   ever consulted. Teaching this function to also detect company mentions would put subject
 *   resolution in the router's word lists — a second, worse copy of resolver #1 (N-3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
const DEFINITION_PHRASES: readonly string[] = [
  "what does", "what do", "what is", "what are", "what s", "whats",
  "define", "definition of", "meaning of", "explain", "tell me what",
  "how does", "how do you", "how is", "what counts as", "what makes",
];
const DEFINITION_TAIL: readonly string[] = ["mean", "means", "meaning", "defined", "definition"];

/**
 * ★★ THE DISQUALIFIER HALF OF THE OLD `definitionAsked`, KEPT — it is the part that was doing work.
 *
 * A sentence that asks a term to DO something is a data question, not a definition: "how does TCS
 * COMPARE with its peers" opens with a definition-shaped phrase and is not one. The tell is the verb.
 *
 * ⚠ THE REST OF `definitionAsked` IS NO LONGER THE GATE. See `compose.ts#definitionAnswer`: the
 *   registry decides, because a reader's phrasing does not.
 */
export function asksTermToAct(raw: string): boolean {
  const w = new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));
  return w.has("doing") || w.has("compare") || w.has("compares") || w.has("versus") || w.has("vs");
}

export function definitionAsked(raw: string): boolean {
  const norm = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim();
  if (norm.length === 0) return false;
  const w = new Set(norm.split(" "));

  // ⚠ A COMPANY-SHAPED VERB DISQUALIFIES IT OUTRIGHT. "How does TCS compare with its peers" opens with
  //   a definition phrase and is not one; the tell is that it asks the term to DO something.
  if (w.has("doing") || w.has("compare") || w.has("compares") || w.has("versus") || w.has("vs")) return false;

  const padded = ` ${norm} `;
  const opener = DEFINITION_PHRASES.some((p) => padded.includes(` ${p} `) || norm.startsWith(`${p} `));
  const tail = DEFINITION_TAIL.some((t) => w.has(t));
  // "what does X mean" — opener and tail. "define X" / "what is X" — opener is enough, but only for
  // the openers that cannot begin a data question.
  const strong = norm.startsWith("define ") || padded.includes(" definition of ")
    || padded.includes(" meaning of ") || norm.startsWith("what is ") || norm.startsWith("what are ")
    || norm.startsWith("what counts as ") || norm.startsWith("explain ")
    || norm.startsWith("how do you ") || norm.startsWith("how does the ");
  return (opener && tail) || strong;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ IS THE READER ASKING WHAT WAS FLAGGED? — PT · Patterns, Phase 2 · Batch 2.
 *
 * ⚠ THIS EXISTS BECAUSE PT OVER-CLAIMED ON ITS FIRST REGISTRATION, WHICH IS NOW THE THIRD TIME A
 *   FAMILY HAS DONE IT IN THIS BUILD. Claiming `{operation: [list_findings, explain, lookup], subject:
 *   required}` with no lens constraint, it swallowed three questions that are not findings questions:
 *
 *     "why did TCS fall today?"     explain · price      → answered with a findings census
 *     lookup · events               → the same census, byte for byte
 *     lookup · valuation            → the same census again
 *
 *   Caught by `lens=price ⇒ a price surface` and by `I-DISTINCT` reporting three identical pairs. The
 *   pattern is consistent enough to name: a family that claims a broad operation and no lens claims
 *   every question nobody else wanted.
 *
 * ★ TWO GUARDS, TWO JOBS, AND NEITHER IS REDUNDANT. The predicate's `lens` stops price/events/
 *   valuation STRUCTURALLY — those are slots, and a slot that can separate should. This stops the
 *   residue: `explain` with no lens on a resolved company is an enormous class, and only some of it
 *   is "what did the checks find".
 */
const FLAG_WORDS: readonly string[] = [
  "flag", "flags", "flagged", "flagging", "finding", "findings", "raised", "concern", "concerns",
  "warning", "warnings", "wrong", "issues", "issue", "problems", "red", "checks", "check",
  "detected", "alerts", "alerted", "watch",
];

export function findingsAsked(raw: string): boolean {
  const w = wordsOf(raw);
  if (FLAG_WORDS.some((x) => w.has(x))) return true;
  // "is anything wrong with X" / "anything to worry about" — the shape without the vocabulary.
  const norm = raw.toLowerCase();
  return /\banything (?:wrong|to worry|i should know|concerning)\b/.test(norm)
    || /\bwhat (?:did|do) (?:the )?checks?\b/.test(norm);
}


/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ IS THE READER ASKING ABOUT OUR SCORE, OR ABOUT THE COMPANY'S FIGURES? — Phase 3, MT.
 *
 * ⚠ THE UX GATE FOUND WHY THIS IS NEEDED, AND IT FOUND IT AS A REGRESSION I HAD JUST CAUSED. Giving F
 *   and OA the `decompose` operation — so that a bare "why" after their answer stops falling to the
 *   planner — also handed them "why is INDUSINDBK SCORED the way it is" whenever the router put a
 *   lens of `fundamentals` on it. `U12 · the shortfall walk rendered` went from green to *"no
 *   shortfall section found — the A renderer is UNEXERCISED in the browser"*, because F answered a
 *   question about the score with a profit-and-loss table.
 *
 * ★ SO THE GUARD IS ON THE SENTENCE, NOT ON THE SLOTS, exactly as §5's sentence guard was added for.
 *   `attribution` and `fundamentals` never share a LENS, so no slot test could separate these two —
 *   the router's lens is precisely the thing that was wrong. What is never wrong is that a reader who
 *   typed "score" is asking about the score.
 *
 * ⚠ THE BAND VALUES ARE DELIBERATELY ABSENT. "Fragile", "Steady", "Healthy" are words a reader uses
 *   about a COMPANY as often as about our reading of one, and the same category error already had to
 *   be corrected once this batch in `concepts.ts#inProse`. Only words that name the MACHINERY count.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function scoreQuestion(raw: string): boolean {
  const w = wordsOf(raw);
  return w.has("score") || w.has("scored") || w.has("scoring") || w.has("scores")
    || w.has("rated") || w.has("rating") || w.has("band") || w.has("pillar") || w.has("pillars")
    || w.has("composite") || w.has("health");
}
