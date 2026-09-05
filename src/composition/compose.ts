// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPOSER — three-way scope (§6.3), and the place `operation: "unresolved"` is honoured.
//
// ★ FOUR OUTCOMES, AND NONE OF THEM IS A GUESS:
//   out_of_scope          stop, one line, no improvisation
//   unresolved operation  clarifying chips — NEVER a handler
//   ambiguous subject     candidate chips — resolver #1 already refused to choose
//   in_scope + matched    run the composition, deterministically
//   in_scope + no match   the generic composition, and a miss-log row
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { composeOneFinding } from "./families/finding-one.js";
import { orientationCompany } from "./families/orientation.js";
import { ownership, ownershipMovers } from "./families/ownership.js";
import { fundamentals } from "./families/fundamentals.js";
import { peerGroup } from "./families/peer-group.js";
import { trajectory } from "./families/trajectory.js";
import { attribution } from "./families/attribution.js";
import { meta } from "./families/meta.js";
import { patterns } from "./families/patterns.js";
import { composePondAnswer } from "./families/peer-group-pond.js";
import { composeVersusAnswer } from "./families/peer-group-versus.js";
import { statementFocus } from "../resolve/statements.js";
import { composeGeneric } from "./families/generic.js";
import { recordMiss } from "./miss-log.js";
import { resolveStockCoverage } from "../resolve/stock-coverage.js";
import { buildManifest } from "../compose/manifest.js";
import { planAnswer } from "../compose/planner.js";
import { executePlan } from "../compose/execute.js";
import { ANONYMOUS, loadReaderProfile, type ReaderProfile } from "../reader/profile.js";
import { buildActionAnswer } from "./action.js";
import { composeReaderAnswer, readerShape } from "./families/reader.js";
import {
  composeInstrumentAnswer, composeComparisonAnswer, composeUniverseAnswer, composeScreenAnswer,
  composeFrameDeclinedScreen, composeFindingScreenAnswer, composeLineItemScreenAnswer,
} from "./families/market.js";
import { resolveScreen } from "../resolve/blocks-market.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import { asksTermToAct, declinedFrame } from "../router/question-shape.js";
import { definitionKeyFor } from "../resolve/concept.js";
import { screenAsk } from "./screen-ask.js";
import type { AnySection, AnswerProse, ComposeContext, Composition } from "./contract.js";
import type { RoutedTurn } from "../router/contract.js";
import { coverageReadFailed, stockCoverage } from "../resolve/contract.js";
import { askBack, subjectChips, operationChips, isAdviceShaped, DECLINE_ADVICE, type Renderable } from "./ask-back.js";
import { blockCopy } from "../catalogue/block-copy.js";
import { applyRegister } from "./register.js";
import type { ToneDirective } from "../ai/tone.js";
import { linksFor } from "./vytal-routes.js";

/**
 * ★ THE REGISTRY. Adding a family is one import and one array entry — no edits to the router, the
 *  sections or the resolvers. That is §6.4's extensibility test, and it is checkable by reading this.
 *
 * ⚠ PHASE 1 · BATCH 1 ADDED THREE ENTRIES AND THE TEST HELD FOR TWO OF THEM. `fundamentals` and
 *   `ownershipMovers` cost one file and one line each. `ownership` is a rewrite of an entry that was
 *   already here. What the batch DID need beyond a file, and what was therefore raised rather than
 *   absorbed: one new renderer (`SERIES : statement-table`, §4.1 ruling in section/contract.ts), one
 *   predicate field (`Predicate.subject`, contract.ts), and one optional result field
 *   (`ComposedAnswer.variantId`). Each is recorded where it lives; none of them touched the router.
 *
 * ⚠ ORDER IS NOT LOAD-BEARING AND MUST NOT BECOME SO. `ownership` and `ownershipMovers` claim the
 *   same operations and the same lens and are separated by `subject`, not by position — see
 *   `Predicate.subject` for why the ordering alternative was rejected.
 */
export const COMPOSITIONS: readonly Composition[] = [
  fundamentals, ownership, ownershipMovers, peerGroup, trajectory, attribution, meta, patterns,
  orientationCompany,
];

/**
 * ★ EVERY VARIANT CARRIES `render`, AND THAT IS THE STAGE-9 FIX. The kinds stay — they are what the
 * miss-log and the /ask diagnostic read — but the transcript no longer has to know which of them
 * happens to have sections. A branch that asks the reader something back is an ANSWER with chips in
 * it, not a bare sentence, and it was rendering as a bare sentence because `sendMessage` could only
 * find sections on one variant.
 */
export type TurnResult =
  | { readonly kind: "out_of_scope"; readonly line: string; readonly render: Renderable }
  | { readonly kind: "clarify_operation"; readonly chips: readonly string[]; readonly line: string; readonly render: Renderable }
  | { readonly kind: "clarify_subject"; readonly chips: readonly { symbol: string; name: string }[]; readonly line: string; readonly render: Renderable }
  | { readonly kind: "subject_not_covered"; readonly mentioned: readonly string[]; readonly line: string; readonly render: Renderable }
  | { readonly kind: "composed"; readonly compositionId: string; readonly sections: readonly AnySection[];
      readonly prose: AnswerProse; readonly missLogged: boolean;
      /** Present on the planned path — which planner ran, and what was rejected if a plan was. */
      readonly plan?: { readonly source: "model" | "deterministic" | "cache"; readonly rejected: string | null; readonly plan: { readonly rationale: string } } };

const OUT_OF_SCOPE_LINE =
  "That is outside what Vytal covers — we read Indian listed companies' financials, ownership, filings and prices.";

/** Chips offered when the OPERATION could not be resolved. Phrased as things a reader would say. */
const OPERATION_CHIPS = [
  "How is it doing overall?",
  "Why is it scored that way?",
  "What has been flagged?",
  "How has it changed over time?",
];

const CLARIFY_LINE = "I am not sure what you are asking about that — which of these did you mean?";

/**
 * ★ THE SAME CHIPS, A DIFFERENT SENTENCE, WHEN THE ROUTER RAN LEXICALLY.
 *
 * A lexical turn answers `unresolved` wherever the model would have answered, so the reader is being
 * asked to disambiguate a question that was probably perfectly clear. `CLARIFY_LINE` puts that on
 * them — "I am not sure what you are asking" is a statement about their phrasing. This one is a
 * statement about us, which is where the fault actually is.
 *
 * ⚠ AND IT NEVER SAYS "QUOTA". A reader cannot act on our budget: naming it is noise dressed as
 * transparency, and it invites them to wait for something they cannot observe. The operational fact
 * lives in `RouterOutput.degradedReason` and the miss-log, where someone can act on it.
 */
const DEGRADED_CLARIFY_LINE = "I could not read that one closely just now — which of these did you mean?";

/**
 * ★ THE LINKS ARE ATTACHED ONCE, HERE, AND NOT IN ANY FAMILY — stage 12.
 *
 * Nine composition paths produce prose. Asking each of them to also decide where the answer
 * continues would be nine places to keep a route table honest, and the ninth would be forgotten —
 * which is exactly how the product ended up with an AI layer that never once pointed at the pages
 * holding the working.
 *
 * ⚠ THE INPUTS ARE SLOTS AND RENDERED KINDS, NOTHING ELSE. `linksFor` gets the same facts the
 *   composition got, plus what it actually drew; it never sees a figure and never sees model output.
 *   So a link cannot describe something that is not on screen, and cannot name a route that is not
 *   in the closed table.
 */
function withLinks(turn: RoutedTurn, result: TurnResult, tone?: ToneDirective): TurnResult {
  if (result.kind !== "composed") return result;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE READER'S REGISTER, APPLIED ONCE — DP · DEPTH AND PROSE, Phase 3.
  //
  // ⚠ `ctx.tone` REACHED EVERY COMPOSITION AND NO FAMILY READ IT. Measured across the composer: the
  //   only consumers of `ToneDirective` were the model planner's system directive and one memory card
  //   that displayed the setting back. Every hand-authored family wrote at one fixed register, so a
  //   reader who asked for simpler terms got identical sentences to one who asked for technical ones.
  //   The preference was stored, resolved and threaded through four layers, then dropped.
  //
  // ★ HERE, AND NOT IN NINE FAMILIES. This is the one function every composed answer already passes
  //   through on its way out — the same argument the links note below makes for itself. Nine
  //   call sites would be nine places to forget, and the ninth would be forgotten.
  //
  // ⚠ AND IT CANNOT REACH THE SECTIONS. `applyRegister` takes prose and returns prose. DP-19's rule —
  //   "the chart, table and numbers are untouched" — holds by construction rather than by care.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ AND THE OFFER IS NOT MADE HERE, WHICH IS THE OPPOSITE OF WHAT THE FIRST WIRING DID. `tone`
  //   arrives from `loadReaderProfile`, i.e. from `user_register` — it is ALREADY PERSISTED. Appending
  //   "say the word and I will keep answering this way" to a reader whose setting is stored offers to
  //   save what they saved, on every answer, forever. `registerOffer` is correct and its call site is
  //   the TURN-LOCAL register — a reader saying "explain that more simply" mid-conversation — which is
  //   DP's other half and is NOT BUILT. See the note on `registerOffer` itself.
  if (tone) result = { ...result, prose: applyRegister(result.prose, tone) };
  // Already decided by the composition itself (the reader family names its own shape) — leave it.
  if (result.prose.links?.length) return result;

  const stocks = turn.subjects.filter((s): s is Extract<typeof s, { kind: "stock" }> => s.kind === "stock");
  const links = linksFor({
    symbol: stocks[0]?.symbol ?? null,
    name: stocks[0]?.name ?? null,
    lens: turn.router.lens,
    operation: turn.router.operation,
    perspective: turn.router.perspective,
    kinds: result.sections.map((x) => x.kind),
    // ★ AND THE RENDERERS — see `LinkContext.renderers`: a register and a score breakdown are one
    //   KIND and two entirely different pieces of evidence.
    renderers: result.sections.map((x) => x.renderer),
    comparison: stocks.length > 1,
    readerShape: turn.subjects.some((s) => s.kind === "reader")
      ? readerShape({ turn, symbol: turn.resolvedSymbols[0] ?? null, reader: null, tone: ANONYMOUS.tone })
      : null,
    // ★ THE SAME CODE-EXTRACTED FOCUS THE COMPOSITION USED, SO THE LINK POINTS AT THE STATEMENT THE
    //   READER ASKED ABOUT. Re-derived from the raw sentence rather than threaded through the result:
    //   `statementFocus` is pure and cheap, and reading it twice cannot disagree with itself.
    statementFocus: turn.router.lens === "fundamentals" ? statementFocus(turn.raw).focus : null,
  });
  if (links.length === 0) return result;
  return { ...result, prose: { ...result.prose, links } };
}

export async function composeTurn(
  turn: RoutedTurn,
  /** The authenticated reader, from the request. `null` offline or unauthenticated — and a
   *  reader-scoped answer then honestly refuses rather than showing an empty book. */
  reader: { userId: string } | null = null,
): Promise<TurnResult> {
  // ★ THE PROFILE IS READ HERE, ONCE, AND HANDED DOWN — so the register can be applied on the way out
  //   without a second read of the same two rows. It was already read once per turn inside the body;
  //   this moves the read up rather than adding one.
  const profile = reader ? await loadReaderProfile(reader.userId) : ANONYMOUS;
  return withLinks(turn, await composeTurnBody(turn, reader, profile), profile.tone);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A QUESTION ABOUT OUR OWN VOCABULARY, ANSWERED WHEREVER IT ARRIVES — ONE HOME, TWO CALLERS.
 *
 * ⚠ THIS WAS INLINE IN STEP 2c AND STEP 1 RETURNED BEFORE IT. Measured on the live model, five rolls
 *   out of five: **"what does Foundation mean" classifies `out_of_scope`.** Step 1 answers an
 *   out-of-scope turn with one line and returns, so M · Meta — a family whose FIRST authored example
 *   is that exact sentence — was unreachable on the live path, and the reader asking what one of our
 *   own four pillars means was told *"that is outside what Vytal covers"*. Every offline gate passed:
 *   the lexical classifier says `in_scope/explain` and reaches step 2c normally.
 *
 * ★ THE GATE IS OUR OWN VOCABULARY, WHICH IS WHY IT IS SAFE TO RUN BEFORE A REFUSAL. `definitionKeyFor`
 *   hits only when the phrase names a term one of §7.1's five vocabularies DEFINES. A question that
 *   names something we define cannot be a question about something we do not cover — that is not a
 *   heuristic, it is the meaning of the registry. Everything else still stops at step 1's one line.
 *
 * ★ AND IT FOLLOWS THE PRECEDENT `declinedFrame` SET one branch above: a narrow, code-decided override
 *   of an out-of-scope roll, because a refusal that misdescribes our own coverage is worse than a
 *   decline — the reader comes away believing we hold less than we do.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
async function definitionAnswer(
  turn: RoutedTurn,
  reader: { userId: string } | null,
  tone: ToneDirective,
): Promise<TurnResult | null> {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE REGISTRY IS THE GATE, NOT THE PHRASING — and this is the THIRD time this class has shipped.
  //
  // ⚠ OBSERVED LIVE, SECONDS APART:
  //     "what is ROCE?"                       → the definition answer
  //     "can you explain ROCE by an example?" → "That is outside what Vytal covers"
  //   Same term, same intent, different sentence shape — from a product that scores companies ON ROCE.
  //
  // ⚠⚠ AND `definitionAsked` NEVER PROVIDED THE SAFETY IT LOOKED LIKE IT PROVIDED. Measured over
  //    fifteen phrasings: the phrasing gate was right 6 times, the registry lookup 13. And
  //    `definitionAsked("what is Justin Bieber's income")` returns **TRUE** — the negative control
  //    passes only because `definitionKeyFor` finds no term. The refusing was already being done by
  //    the registry; the phrasing gate contributed false negatives and nothing else.
  //
  // ★ SO THE ORDER IS INVERTED. A sentence that names a term OUR OWN VOCABULARY DEFINES, and is not
  //   asking that term to do something, is a definition question however it arrives — "explain",
  //   "give me an example of", "help me understand", "what's the point of", an imperative, or a bare
  //   "ROCE?".
  //
  // ⚠ THE TWO GUARDS THAT DO THE REAL WORK BOTH STAY. `mentionsAreTheTerm` below rejects "what is
  //   TCS's ROCE" — a company AND a term is a DATA question — and `asksTermToAct` rejects "how does
  //   TCS compare with its peers". Those were carrying the safety all along.
  //
  // ★ SAME SHAPE AS F-1's SECOND HALF: a behavioural rule gated on grammar, and grammar is exactly
  //   what varies between two readers asking the same thing.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (asksTermToAct(turn.raw)) return null;
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ A QUESTION THAT STATES A CONDITION IS A SCREEN, NOT A DEFINITION — and inverting the gate to
  //    the registry is exactly what made this reachable.
  //
  //    "Companies with return on equity above 900" NAMES a term we define — and it names it only
  //    because the alias pass made "return on equity" reach `returnOnEquity`, which was right. It
  //    carries NO company mention, so `mentionsAreTheTerm` below is VACUOUSLY TRUE on an empty list,
  //    and the definition answer swallowed the screen. Three screen cases lost their `set-table` and
  //    two turned into the same answer as "what is a metric gloss" — `I-DISTINCT` caught the pair.
  //
  // ★ THE SAME VACUOUS-GUARD SHAPE AS THE READER-PERSPECTIVE BUG: a test that reads "every mention is
  //   the term" says nothing at all when there are no mentions. Both needed a second, positive signal.
  //
  // ★ `extractConditions` IS THAT SIGNAL AND IT ALREADY EXISTS (N-5). It is the screen detector step
  //   3g runs on; asking it here means the two paths cannot disagree about what a screen is.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ AND `extractConditions` ALONE WAS TOO NARROW — THE FOURTH OCCURRENCE OF THIS CLASS, OBSERVED
  //    LIVE, TWICE, WITH NO NUMBER IN EITHER SENTENCE FOR IT TO SEE:
  //
  //      "give me a list of all the stocks which are in pristine health band" → the five-labels card
  //      "how many stocks are showing pledging red flag"                      → the what-a-flag-is card
  //
  //    Neither asked what a term means. Both asked for a SET and named a defined term as the FILTER,
  //    and `extractConditions` returns `[]` for both because neither carries a comparator and a
  //    number. The registry then matched `concept_bands` / `concept_finding`, `mentionsAreTheTerm`
  //    was vacuously true again, and the definition answer swallowed two screens.
  //
  // ★ THE RULE: **a request for a set is never a definition question, however many defined terms it
  //   names.** `screenAsk` is the widened detector and it is still the SAME object step 3g runs on —
  //   it now returns the whole screen SPECIFICATION rather than a condition list, so the two paths
  //   cannot disagree about what a screen is. It was widened rather than duplicated for exactly the
  //   reason this comment has had to be written four times.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (screenAsk(turn.raw)) return null;
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ A READER ASKING ABOUT THEIR OWN BOOK IS NOT ASKING FOR A DEFINITION — found by this pass.
  //
  //   "What is the health of my holdings" resolved `perspective: reader`, `subjects: [reader]` and —
  //   the part that did the damage — **`router.subjects.length === 0`**, which makes the
  //   `mentionsAreTheTerm` test below VACUOUSLY TRUE. `definitionKeyFor` then matched the word
  //   "health" to `concept_health_score`, and the reader asking about their own portfolio was handed
  //   a GLOSSARY ENTRY for the health score. Measured on both the lexical and the live path.
  //
  //   ⚠ AND IT WAS LUCK THAT IT WAS NOT WORSE. "What is the value of my portfolio" reaches
  //     `reader.portfolio` only because no vocabulary defines "value"; any reader question naming one
  //     of the fourteen concepts — momentum, foundation, coverage — was stolen the same way.
  //
  // ★ PERSPECTIVE IS THE RIGHT GUARD AND IT IS CODE-DECIDED. The router already decided whose
  //   question this is; a definition is never about the asker's own holdings.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (turn.router.perspective === "reader") return null;
  const termKey = definitionKeyFor(turn.raw);
  // Every mention the router made must itself BE the term — otherwise the reader named something
  // else, and something else is what they are asking about.
  const mentionsAreTheTerm =
    turn.router.subjects.length === 0
    || turn.router.subjects.every((m) => definitionKeyFor(m.text) === termKey);
  if (!termKey || !mentionsAreTheTerm) return null;

  // ⚠ `meta.build` IS CALLED DIRECTLY, NOT THROUGH A RECURSIVE `composeTurn`. The first draft recursed
  //   the way step 2b does for advice — and step 2b terminates only because it flips `unresolved` to
  //   `orient`, which its own guard then rejects. This branch's guard has no such condition, so the
  //   recursive call satisfied it again and every definition question died with `RangeError: Maximum
  //   call stack size exceeded`. Step 3g already calls its compositions directly; that is the pattern.
  //
  // ★ AND THE SUBJECTS ARE NOT PASSED. `meta` declares `subject: "none"` and its worked example reads
  //   `turn.context`, so a coincidentally-resolved ARIHANT must not travel — it would put a company's
  //   figures under a definition of a pillar.
  const built = await meta.build({
    turn: { ...turn, subjects: [], resolvedSymbols: [] },
    symbol: null, reader, tone,
  });
  // ⚠ NOT `withLinks` HERE. `composeTurn` wraps every result on the way out, so wrapping again would
  //   attach links twice and — since Phase 3 — apply the reader's REGISTER twice.
  return {
    kind: "composed", compositionId: meta.id,
    sections: built.sections, prose: built.prose, missLogged: false,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A SET WAS ASKED FOR — ANSWERED WHEREVER IT ARRIVES. ONE HOME, THREE CALLERS.
 *
 * This is `definitionAnswer`'s shape, one branch along, and it exists for the same measured reason:
 * step 3g composes screens beautifully and THREE EARLIER BRANCHES RETURN BEFORE IT.
 *
 * ⚠ MEASURED OFFLINE ON THE LEXICAL CLASSIFIER, ALL THREE REACHING A DIFFERENT WRONG ANSWER:
 *
 *   "how many stocks are showing pledging red flag"   → operation `unresolved` ⇒ **clarify chips**:
 *      "I could not read that one closely just now — which of these did you mean?" — to a sentence
 *      naming one of our own 22 rules and asking for a count of it.
 *   "companies with return on equity above 900"        → the same, and this one has a FIELD, a
 *      COMPARATOR and a NUMBER in it. It is a matrix case that passes only because the matrix drives
 *      it with `operation: "screen"` declared; on the path a reader uses it clarified.
 *   "which stocks have an earnings quality red flag"   → `declinedFrame` returns `superlative`,
 *      because "quality" is a verdict word and "stocks" is a market noun — so an out-of-scope roll
 *      answers a NAMED RULE with a health RANKING.
 *
 * ★ THE RULING IS THE ONE THIS FILE HAS NOW APPLIED FOUR TIMES: **an operation slot is grammar, and a
 *   behavioural rule must not be gated on one.** Step 2b took the advice decline off the slot, step 3g
 *   took the screen COMPOSITIONS off it, 2c and 2d moved to the sentence. What was missed is that
 *   taking 3g off the slot does nothing while step 2 returns first — the gate did not move, it just
 *   stopped being 3g's.
 *
 * ⚠ AND IT IS SAFE TO RUN BEFORE A REFUSAL FOR `definitionAnswer`'s OWN REASON: every filter
 *   `screenAsk` reads is resolved against a registry WE PUBLISH — the five band labels, the 22 filing
 *   rules, the nine screen fields. A sentence that names something we hold a screen for cannot be a
 *   sentence about something we do not cover.
 *
 * ⚠ NO SUBJECT, AND THE GUARD IS HERE RATHER THAN AT EACH CALLER. "How does TCS compare with the
 *   companies in the pristine band" carries a band and is not a screen — it is a comparison, and a
 *   screen check running before subject resolution would take it. Step 3g's own `if (!symbol)` says
 *   the same thing; putting it inside means the two earlier callers cannot forget it.
 */
async function screenAnswer(turn: RoutedTurn): Promise<TurnResult | null> {
  if (turn.resolvedSymbols.length > 0) return null;
  const ask = screenAsk(turn.raw);
  if (!ask) return null;

  // ⚠ THE LAYER IS THE ASK'S, NOT A GUESS MADE HERE. A finding filter reaches all 2,291 stocks; a
  //   metric or band filter reaches the 95 we score. Deciding it twice is how two answers come to
  //   state two different denominators for one question.
  if (ask.layer === "finding" && ask.finding) {
    const keys = ask.finding.ruleKey
      ? [ask.finding.ruleKey]
      : FILING_REGISTRY.filter((e) => e.kind === ask.finding!.kind).map((e) => e.ruleKey);
    const what = ask.finding.name ?? (ask.finding.kind === "pattern" ? "a pattern" : "a red flag");
    // ★ THE CHECK'S OWN DEFINITION, from the catalogue — what the reader asking "which stocks show X"
    //   actually wants beside the list. Only for a NAMED rule: a KIND screen spans eleven rules and
    //   has no single description, and stitching eleven together would be a paragraph nobody asked for.
    const definition = ask.finding.ruleKey
      ? (STOCK_FINDINGS as Record<string, { description?: string }>)[ask.finding.ruleKey]?.description ?? null
      : null;
    const fs = await composeFindingScreenAnswer(keys, what, ask.bandLabel, ask.shape, definition);
    if (fs) return fs;
  }
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ FILED LINE ITEMS — THE THIRD UNIVERSE, AND THE INTERSECTION WHERE A SENTENCE SPANS TWO.
  //
  // "Revenue above 100cr" reaches the 2,284 companies that have filed. "Health above 70" reaches the
  // 95 we score. A sentence carrying both is an OVERLAP, and it can only be as wide as the narrower
  // side — so the scored screen runs FIRST, its full match set restricts the line-item screen, and
  // the answer says which population it searched. Silently applying the narrower one is the defect
  // §2 exists to name.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (ask.lineItems.length > 0) {
    const alsoScored = ask.conditions.length > 0 || ask.band !== null;
    let narrowed: { symbols: ReadonlySet<string>; what: string; population: number; said: string } | null = null;
    if (alsoScored) {
      const scored = await resolveScreen(ask.conditions, ask.bandLabel);
      if (scored.ok) {
        narrowed = {
          symbols: new Set(scored.data.matchedSymbols),
          what: `we score${ask.bandLabel ? ` and label ${ask.bandLabel}` : ""}`,
          population: scored.data.scoredUniverse,
          // The scored side echoed back in the reader's terms, from the APPLIED conditions rather
          // than from the sentence — the same rule that keeps a threshold code-extracted.
          said: [
            ...scored.data.conditions.map((c) => `${c.label.toLowerCase()} ${c.bound}`),
            ...(ask.bandLabel ? [`a ${ask.bandLabel} label`] : []),
          ].join(" and "),
        };
      }
    }
    const li = await composeLineItemScreenAnswer(ask.lineItems, ask.basis, ask.shape, narrowed);
    if (li) return li;
  }

  if (ask.conditions.length > 0 || ask.band) {
    const sc = await composeScreenAnswer(ask.conditions, ask.bandLabel, ask.shape);
    if (sc) return sc;
  }
  return null;
}

async function composeTurnBody(
  turn: RoutedTurn,
  reader: { userId: string } | null = null,
  profile: ReaderProfile = ANONYMOUS,
  /** ★ THE ADVICE BRANCH'S BASE CASE — true on the inner call it makes for the analysis beneath the
   *  decline, so that call cannot re-enter the branch. See step 2b. */
  alreadyDeclined = false,
): Promise<TurnResult> {
  const { router } = turn;
  // ★ THE READER'S OWN VOICE, READ ONCE PER TURN (stage 6 ruling 3). It replaced
  //   `resolveTone(null, null)` — a hardcoded balanced default that meant a reader who had set a
  //   register, a depth or a name got the same words as everyone else.
  //   ⚠ THE READ MOVED UP TO `composeTurn` AT PHASE 3 and arrives as a parameter, so the register can
  //     be applied on the way OUT without reading the same two rows a second time.

  // 1 · OUT OF SCOPE. One line. No improvisation, and no attempt to be helpful about the near miss —
  //     a question about a celebrity that happens to name a ticker is still not our question.
  if (router.scope === "out_of_scope") {
    // ═══ ★★ A FRAME WE DECLINE IS NOT A SUBJECT WE DO NOT COVER ═══════════════════════════════════
    //
    // ⚠ MEASURED ON THE LIVE MODEL: "what are the best stocks to buy" classifies **out_of_scope**, so
    //   the reader was told "that is outside what Vytal covers — we read Indian listed companies'
    //   financials". That sentence is FALSE about that question, and a refusal that misdescribes our
    //   own coverage is worse than a decline: the reader now believes we hold less than we do.
    //
    // ★ THE OVERRIDE IS NARROW AND CODE-DECIDED, and it follows the precedent step 2b already set for
    //   advice ("should I buy TCS?" also routes unresolved and is also answered rather than refused).
    //   `declinedFrame` requires a MARKET NOUN plus a verdict word — so a question about a celebrity
    //   still stops, and §6.3's "one line, no improvisation" is untouched for everything it was
    //   written about.
    // ═══ ★★ AND A SET WE CAN ACTUALLY SCREEN FOR IS NEVER OUTSIDE OUR COVERAGE — AND BEATS THE
    //     FRAME DECLINE BELOW, WHICH OVER-FIRES ON IT.
    //
    // ⚠ MEASURED: `declinedFrame("which stocks have an earnings quality red flag")` returns
    //   **`superlative`**, because "quality" sits in its verdict list and "stocks" is a market noun.
    //   So on an out-of-scope roll a question naming R3 by name was answered with a ranking of the
    //   whole scored universe on health — every figure real, none of them about the check asked for.
    //
    // ★ ORDER IS THE FIX AND IT IS THE SAME ORDER STEP 3g ALREADY HOLDS: a filter we can run beats a
    //   frame we decline, because the decline substitutes a DIFFERENT question and the filter answers
    //   this one. `screenAsk` refuses rather than guesses, so nothing the frame decline should own
    //   can be captured here.
    const asScreen = await screenAnswer(turn);
    if (asScreen) return asScreen;
    const oosFrame = declinedFrame(turn.raw);
    if (oosFrame) {
      const declined = await composeFrameDeclinedScreen(oosFrame);
      if (declined) return declined;
    }
    // ═══ ★★ AND A QUESTION ABOUT OUR OWN VOCABULARY IS NEVER OUTSIDE OUR COVERAGE ═════════════════
    //
    // ⚠ MEASURED FIVE ROLLS OUT OF FIVE ON THE LIVE MODEL: "what does Foundation mean" classifies
    //   `out_of_scope`, so this branch answered it with the one line above and M · Meta — whose FIRST
    //   authored example is that exact sentence — was unreachable on the live path. Every offline gate
    //   passed, because the lexical classifier says `in_scope/explain` and reaches step 2c normally.
    //   Same shape as the frame decline directly above, found the same way, and answered the same way.
    const asDefinition = await definitionAnswer(turn, reader, profile.tone);
    if (asDefinition) return asDefinition;
    return {
      kind: "out_of_scope", line: OUT_OF_SCOPE_LINE,
      render: { sections: [], prose: { opening: [OUT_OF_SCOPE_LINE], leads: {}, after: {}, close: "" } },
    };
  }

  // 2 · ★ AN ACTION WAS ASKED FOR — RENDER A CONTROL, NEVER PERFORM ONE (§5.4).
  //
  //     ⚠ THIS RUNS BEFORE THE OPERATION CHECK, AND THE LIVE RUN IS WHY. "add TCS to my watchlist"
  //     classifies as `action: "watchlist_add"` with `operation: "unresolved"` — correctly, because
  //     the operation vocabulary describes READS and a request is not one. With the action branch
  //     below the operation check, every genuine action request fell to clarifying chips and the
  //     path was reachable only by a misclassification. An action IS the resolved intent; there is
  //     nothing left to clarify.
  //
  //     ⚠ NOTHING IN THIS BRANCH WRITES. It assembles a section whose payload names an endpoint and
  //     a body; the reader's tap is what calls it. See action.ts.
  const actionCtx: ComposeContext = { turn, symbol: turn.resolvedSymbols[0] ?? null, reader, tone: profile.tone };
  if (router.action) {
    const built = await buildActionAnswer(router.action, actionCtx, profile);
    if (built) return built;
    // Fell through: nothing to act on. The read paths below still owe the reader an answer.
  }

  const subjectSymbol = turn.resolvedSymbols[0] ?? null;
  const isBare = turn.corrections.some((c) => c.includes("bare subject"));

  // 2b · ★ ADVICE: DECLINE THE FRAME, THEN ANSWER THE ANSWERABLE PART.
  //
  //      "should I buy TCS?" routed `operation: "unresolved"` — which is CORRECT, because the
  //      operation vocabulary describes reads and a recommendation is not one — and then fell to the
  //      chips below, so the product replied "I am not sure what you are asking about" to one of the
  //      clearest sentences a reader can type. We neither gave the advice nor the analysis.
  //
  //      A recommendation depends on what the reader already owns, their horizon and their tax
  //      position, none of which we hold; that half is genuinely declined. The other half — what the
  //      company looks like on the figures — is exactly what this system is for, so it runs the
  //      ordinary orientation underneath the decline rather than stopping at it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ THE OPERATION SLOT IS NOT PART OF THE TEST ANY MORE — F-1, and only the LIVE run showed why.
  //
  //   This read `router.operation === "unresolved"`, which held for all four rungs of the ladder on
  //   the LEXICAL path. On the live model the third rung — "buy TCS or not?" — came back as
  //   `operation: "screen"`, so the branch was skipped and the reader asking whether to buy got a
  //   PEER RANKING: "TCS scores 65.4 and ranks 4 of 6". Three declined, one did not, in one
  //   conversation.
  //
  // ★ THE RULING WAS "DETECT THE ACT, NOT THE GRAMMAR", AND AN OPERATION SLOT IS GRAMMAR — it is the
  //   router's reading of the sentence's shape, and the same sentence rolls differently. `isAdviceShaped`
  //   is the test; gating it behind a slot re-introduced exactly the fragility the rewrite removed.
  //
  // ⚠ THE OTHER TWO GUARDS STAY AND THEY ARE THE REAL ONES: a subject must have resolved (there is
  //   nothing to analyse under a decline without one) and the question must not be a BARE ticker.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ AND THE RECURSION NOW TERMINATES ON AN EXPLICIT FLAG, NOT ON A SLOT FLIP.
  //
  //   This branch calls `composeTurn` again with `operation: "orient"` to build the analysis that
  //   goes UNDER the decline. While the guard above required `operation === "unresolved"`, that flip
  //   was what stopped the inner call re-entering — a termination condition that existed by accident
  //   and was documented as such at step 2c ("step 2b terminates only because it flips `unresolved`
  //   to `orient`, which its own guard then rejects"). Removing the slot test removed the base case,
  //   and every advice question died with `RangeError: Maximum call stack size exceeded` — the same
  //   crash step 2c's first draft had, from the same cause, one guard along.
  //
  // ★ `alreadyDeclined` IS THE BASE CASE, STATED. A termination condition worth having is one you can
  //   see; this one no longer depends on which slot the router happened to return.
  if (subjectSymbol && !isBare && !alreadyDeclined && isAdviceShaped(turn.raw)) {
    const oriented = await composeTurnBody(
      { ...turn, router: { ...router, operation: "orient", lens: null } },
      reader, profile, true,
    );
    if (oriented.kind === "composed") {
      return {
        ...oriented,
        compositionId: `${oriented.compositionId}+declined-advice`,
        // The decline LEADS. Placed after the analysis it reads as a disclaimer on a recommendation
        // we did not make; placed first it is the answer to the question actually asked.
        prose: { ...oriented.prose, opening: [DECLINE_ADVICE(), ...oriented.prose.opening] },
      };
    }
  }

  // 2c · ★ A DEFINITION QUESTION, AND IT HAS TO BE CAUGHT BEFORE SUBJECT RESOLUTION DECIDES ANYTHING.
  //
  //      ⚠ MEASURED BEFORE THIS EXISTED, AND THE FIRST ROW IS THE WORST KIND OF FAILURE:
  //
  //        "what does Foundation mean"        → mention "Foundation" RESOLVED TO **ARIHANT**, and the
  //                                             reader asking what a pillar means got a company.
  //        "what does Sticky Divergence mean" → subject_not_covered: "we have never heard of that"
  //                                             about a company they never asked about.
  //        "what is ROCE"                     → the same.
  //
  //        Plus, on the operation side: nothing in `COMPOSITIONS` claimed `explain` at all before this
  //        batch, so every definition question that DID get through composed the generic family with a
  //        single `nothing-found` card.
  //
  //      ★ THE TEST IS "IS THE MENTION THE TERM?", AND IT IS EXACT. A definition question and a data
  //        question can be the same shape — "what is Foundation" and "what is TCS's revenue" — and
  //        what separates them is whether the phrase the router took as a COMPANY is the phrase the
  //        vocabularies define. `definitionKeyFor` answers that with no word lists and no guessing,
  //        and it is pure, so this branch costs one map lookup even when it declines.
  //
  //      ★ AND IT COSTS ZERO MODEL TOKENS WHEN IT ANSWERS. That is §7.1's claim for the concept
  //        registry and the reason this branch sits before every other read: the commonest question
  //        about the product is also the cheapest turn in the system.
  {
    const asDefinition = await definitionAnswer(turn, reader, profile.tone);
    if (asDefinition) return asDefinition;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 2d · ★★ ONE NAMED FINDING, ON A NAMED COMPANY — `patterns.finding`, N-3.
  //
  // ⚠ THE SLOTS CANNOT BE TRUSTED TO GET THIS TO PT, AND THREE LIVE ROLLS PROVED IT:
  //     "why was TECHM flagged for Sticky Divergence" → `explain · health` ⇒ **attribution.score**
  //        answered with the whole score shortfall walk. The reader asked about ONE finding.
  //     "why was TCS flagged for Sticky Divergence"   → `explain · events` ⇒ **planned:model**, whose
  //        prose then confabulated: "the query regarding sticky divergence refers to the corporate
  //        events and disclosures filed over the available historical period." It does not.
  //     Lexically all three arrive `unresolved` and stop at clarifying chips.
  //
  // ★ SO THE TEST IS ON THE SENTENCE, WHICH IS THE CARRIED RULE: "an operation slot is grammar. Do not
  //   gate a behavioural rule on a slot value." A reader who typed a finding's NAME has named it
  //   whatever the router made of the verb, and `searchVocabularies` is what decides — longest name
  //   wins, so "Sticky Divergence" beats "Divergence", and a sentence naming no finding falls through
  //   untouched. Same shape as `definitionAnswer` directly above and the pond check at step 3b.
  //
  // ⚠ A SUBJECT IS REQUIRED. Without one this IS Meta's question, and Meta answered it two branches
  //   up; the difference between the two answers is entirely whether a company is in the sentence.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 2e · ★★ TWO NAMED PEER GROUPS — `peers.versus`, N-1. ONE SITE, DELIBERATELY.
  //
  // ⚠ IT NEEDED THREE OTHERWISE, WHICH IS HOW I KNEW IT WAS IN THE WRONG PLACE. Placed down in step
  //   3g it was unreachable three different ways:
  //     lexically  "compare pharma and FMCG" resolved a company mention, nothing matched, and step 3b
  //                answered `subject_not_covered` — "that company is not in Vytal's coverage", about
  //                two sets we hold in full.
  //     live       the model returned `compare` with ZERO subjects and AMBIGUOUS candidates, so step 3
  //                answered `clarify_subject` — asking which company, for a question about no company.
  //     and the single-pond answer would have taken it first anyway, silently dropping one side.
  //
  // ★ SO IT SITS ABOVE ALL OF THEM, ON THE SENTENCE. `resolvePeerGroupVersus` returns `null` unless
  //   the sentence splits on a connective AND both halves match distinct ponds through `matchPondName`
  //   — our own registry, refusing rather than guessing — so nothing else can be captured here. Same
  //   argument as `definitionAnswer` at 2c and the finding check at 2d: where the slots are unreliable
  //   and the sentence is not, read the sentence.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const twoPonds = await composeVersusAnswer(turn.raw);
    if (twoPonds) {
      return {
        kind: "composed", compositionId: twoPonds.compositionId,
        sections: twoPonds.sections, prose: twoPonds.prose, missLogged: false,
      };
    }
  }

  if (subjectSymbol) {
    const oneFinding = await composeOneFinding(turn.raw, subjectSymbol);
    if (oneFinding) {
      return {
        kind: "composed", compositionId: oneFinding.compositionId,
        sections: oneFinding.sections, prose: oneFinding.prose, missLogged: false,
      };
    }
  }
  }


  // 2a-bis · ★★ A SET REQUEST IS NOT AN UNRESOLVED OPERATION, AND STEP 2 WAS SWALLOWING EVERY ONE
  //          THAT THE LEXICAL CLASSIFIER COULD NOT NAME.
  //
  // ⚠ THE SCREEN COMPOSITIONS WERE TAKEN OFF THE OPERATION SLOT AT 3g — "so that one slot's coin-flip
  //   cannot decide whether an answer exists at all" — and it did not help, because THIS branch reads
  //   the same slot twenty lines earlier and returns. Measured offline: "companies with return on
  //   equity above 900", a sentence carrying a field, a comparator and a number, was answered with
  //   "I could not read that one closely just now".
  //
  // ★ SAME OVERRIDE, SAME NARROWNESS, AS STEP 2b's FOR ADVICE AND 2c's FOR DEFINITIONS. §6.2's rule
  //   is that an unresolved operation gets chips rather than a GUESS; a code-extracted screen
  //   specification is not a guess — it is a field, a comparator and a number, or one of five
  //   published band labels, or one of 22 registered rules, read off the reader's own sentence.
  {
    const asScreen = await screenAnswer(turn);
    if (asScreen) return asScreen;
  }

  // 2 · ★ OPERATION UNRESOLVED — CHIPS, NEVER A HANDLER (§6.2). This is checked BEFORE subject
  //     ambiguity on purpose: knowing WHICH company does not help if we do not know what was asked,
  //     and asking the reader to disambiguate a subject first would waste their answer.
  if (router.scope === "unresolved" || router.operation === "unresolved") {
    // ★ THIS BRANCH NOW LOGS. It is the outcome that says a question shape has no home at all, and
    //   it recorded nothing until stage 5b — 10 turns in 41 leaving no trace, against 1 generic row
    //   that did. `slots` carries `source`, so a denial can be told from a genuine miss when this
    //   log is read to decide what to build.
    recordMiss({
      branch: "clarify_operation",
      raw: turn.raw,
      slots: router,
      resolvedSymbols: turn.resolvedSymbols,
      sectionsChosen: [],
      missingData: [],
      // From the REQUEST's session, never the payload — the same rule every `me` route holds to.
      userId: reader?.userId ?? null,
    });
    // ★ THREE DIFFERENT SENTENCES, BECAUSE THESE ARE THREE DIFFERENT SITUATIONS. One line served all
    //   of them — "I am not sure what you are asking about" — which is a statement about the reader's
    //   phrasing, and it is only true in the third case.
    const bare = subjectSymbol !== null && isBare;
    const line = bare
      ? `${subjectSymbol} ${blockCopy("ask_bare_subject")}.`
      : router.source === "lexical" ? DEGRADED_CLARIFY_LINE : CLARIFY_LINE;
    return {
      kind: "clarify_operation",
      chips: OPERATION_CHIPS,
      line,
      render: askBack([line], operationChips(subjectSymbol)),
    };
  }

  // 3 · SUBJECT AMBIGUOUS. Resolver #1 returned candidates and refused to pick; so do we.
  if (turn.needsSubjectChoice && turn.resolvedSymbols.length === 0) {
    const line = blockCopy("ask_which_company");
    return {
      kind: "clarify_subject",
      chips: turn.subjectChoices,
      line,
      // ★ THE CANDIDATES, AS QUESTIONS. Built here and RENDERED, where before they were built here
      //   and thrown away one layer up. See ask-back.ts.
      render: askBack([line], subjectChips(turn)),
    };
  }

  // 3b · ★ NAMED A COMPANY, RESOLVED NOTHING. Distinct from every branch around it and it must not
  //      fall through to the generic path: the generic composition assembles what we hold ABOUT A
  //      SUBJECT, and there is no subject. Running it produced a bare callout that read as "we
  //      checked and found nothing" — a statement about a company we do not carry. The honest answer
  //      is the coverage boundary, and search-stocks.ts's rule applies: not in OUR universe is not
  //      the same claim as the company not existing, and no caller may upgrade it to that.
  // ⚠ `turn.subjects.length === 0` IS THE STAGE-7 CORRECTION. `resolvedSymbols` counts STOCKS only,
  //    so an instrument that resolved perfectly well — a fund, a bond, a G-sec — has an empty
  //    `resolvedSymbols` and was about to be told it is "not in Vytal's coverage". It is; it is just
  //    not a share. The honest test is whether ANY subject resolved.
  if (turn.router.subjects.length > 0 && turn.subjects.length === 0 && !turn.needsSubjectChoice) {
    const line = "That company is not in Vytal's coverage — which is not the same as it not existing. We read Indian listed companies.";
    return {
      kind: "subject_not_covered",
      mentioned: turn.router.subjects.map((s) => s.text),
      line,
      render: { sections: [], prose: { opening: [line], leads: {}, after: {}, close: "" } },
    };
  }

  const symbol = subjectSymbol;
  const ctx: ComposeContext = { turn, symbol, reader, tone: profile.tone };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ 3c-bis · THE COVERAGE READ, ONCE, BEFORE ANY PATH DEPENDS ON IT.
  //
  // Every market path below degrades WRONGLY when this read fails, and each does it differently —
  // which is why the guard is here and not repeated three times:
  //
  //   · the family loop reads `stockCoverage(cov.coverage)?.tier ?? 0` per candidate. A failed read
  //     becomes tier 0, so every family with a `minTier` is silently skipped and the turn routes to
  //     the planner as though the stock were unscored.
  //   · `buildManifest` returns null, which is its "no such stock" value.
  //   · the generic fallback then closes with **"That is everything we hold on X today."** — a
  //     coverage claim, stated over a read that never completed. That sentence is the whole reason
  //     this guard exists.
  //
  // ⚠ IT RETURNS AN ANSWER, NOT A THROW. `resolveStockCoverage` used to throw here and took all six
  //   market compositions with it — measured 6 of 6 dying under a dead database, so a reader got an
  //   error page rather than a sentence. Both are now sentences.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (symbol) {
    const subjectCov = await resolveStockCoverage(symbol);
    if (coverageReadFailed(subjectCov)) {
      const line =
        `We could not read what we hold on ${symbol} just now — that is a fault on our side, `
        + `not a gap in the company's filings. Asking again in a moment is worth a try.`;
      return {
        kind: "composed",
        compositionId: "read_failed.stock",
        sections: [],
        prose: { opening: [line], leads: {}, after: {}, close: "" },
        missLogged: false,
      };
    }
  }

  // 3d · ★ THE READER THEMSELVES IS THE SUBJECT (stage 6). Distinct from every branch around it:
  //      there is no symbol, so the family loop and the planner would both decline and the generic
  //      path would assemble "what we hold about a company" with no company. `ReaderCoverage` is a
  //      different shape and needs a different answer.
  const readerSubject = turn.subjects.find((x) => x.kind === "reader");
  if (readerSubject) {
    // ★ INCLUDING WHEN A STOCK ALSO RESOLVED — that is the `relationship` shape ("how much TCS do I
    //   own"), and routing it to the company path would answer a question about the company.
    return composeReaderAnswer(readerSubject, ctx, profile);
  }

  // 3e · ★ A NON-EQUITY INSTRUMENT. It has a subject and no symbol, so every stock path below would
  //      decline and the generic path would assemble "what we hold about a company" about a fund.
  const instrument = turn.subjects.find((x) => x.kind === "instrument");
  if (instrument) return composeInstrumentAnswer(instrument);

  // 3f · ★ TWO SUBJECTS AND A COMPARE OPERATION. Until stage 6 the composer read `resolvedSymbols[0]`
  //      and answered about one of them.
  if (router.operation === "compare" && turn.resolvedSymbols.length >= 2) {
    const cmp = await composeComparisonAnswer(turn.resolvedSymbols[0]!, turn.resolvedSymbols[1]!);
    if (cmp) {
      // ═══ ★★ THE THIRD COMPANY WAS BEING DROPPED IN SILENCE ═════════════════════════════════════
      //
      // ⚠ "compare TCS, INFY and WIPRO" RESOLVES ALL THREE — measured — and this line has always
      //   taken `[0]` and `[1]`. The reader named three companies, received a two-company answer,
      //   and nothing anywhere said the third had been dropped. That is the same defect stage 6
      //   fixed for TWO subjects ("resolved both and then answered about TCS alone"), surviving one
      //   arity up.
      //
      // ★ WHAT IS NOT DONE HERE, AND WHY IT IS SAID RATHER THAN BUILT. A real three-way needs a
      //   three-way COMPARABILITY verdict — all three in one pond? pairwise? — and `resolveComparison`
      //   and `buildComparisonView` are both pairwise to their foundations. The RENDERER is ready:
      //   `RelativeMark.series` documents slot 2 as needing no contract change, and `SERIES_HUES`
      //   carries four. So this is a resolver-shaped gap, raised rather than half-built, and the
      //   honest interim is to say which two were compared and which was left out.
      const extra = turn.resolvedSymbols.slice(2);
      if (extra.length > 0) {
        return {
          ...cmp,
          prose: {
            ...cmp.prose,
            opening: [
              `You named ${turn.resolvedSymbols.length} companies. This compares ` +
              `${turn.resolvedSymbols[0]} and ${turn.resolvedSymbols[1]}; ` +
              `${extra.join(" and ")} ${extra.length === 1 ? "is" : "are"} not in it — ` +
              `a side-by-side is built two at a time, and putting a third in would need a way of ` +
              `judging all three against one reference set that we do not have yet.`,
              ...cmp.prose.opening,
            ],
          },
        };
      }
      return cmp;
    }
  }

  // 3g · ★ NO SUBJECT AT ALL — the query-scoped answers. `screen` when conditions can be read off the
  //      question; the universe cross-section when the reader asked about the market as a whole.
  if (!symbol) {
    // ═══ ★★ FOUR SUBJECTLESS READINGS, IN ORDER OF SPECIFICITY — AND NONE OF THEM KEYS ON THE
    //     OPERATION SLOT ANY MORE.
    //
    // ⚠ THE OPERATION GATE WAS THE DEFECT, AND §6.5 IS WHY. Every branch below used to sit inside
    //   `if (router.operation === "screen")`. Measured across two live runs of the SAME question,
    //   "how is the large-cap pharma peer group doing" classified `screen` once and `orient · price`
    //   the next — which is exactly the 80–88% run-to-run agreement §6.5 records — and on the second
    //   run it fell past every branch into the GENERIC composition, returning a bare callout. The
    //   reader asked the same question twice and got a real answer, then nothing.
    //
    // ★ SO EACH READING IS RECOGNISED FROM THE SENTENCE INSTEAD, and that is safe because every one
    //   of the three extractors REFUSES rather than guesses: `extractConditions` needs a field, a
    //   comparator and a number; `matchPondName` needs every distinguishing token of a real pond;
    //   `declinedFrame` needs a market noun and a verdict word. A question matching none of them
    //   falls through unchanged. The router still decides scope and subject — this only stops one
    //   slot's coin-flip deciding whether an answer exists at all.
    //
    // ⚠ ORDER IS THE RULING, AND CONDITIONS COME FIRST. "pharma companies with return on equity above
    //   20" names a pond AND states a filter; the filter is what was asked for, and letting the pond
    //   matcher take it would answer a screen with a roster.
    // ═══ ★★ ONE DETECTOR, AND IT IS THE SAME ONE `definitionAnswer` STOOD DOWN FOR ════════════════
    //
    // ⚠ THIS READ `extractConditions` ALONE, AND SO DID THE DEFINITION GUARD AT 2c. Two paths asking
    //   the same question with the same narrow test — which was fine while they agreed and became
    //   the fourth occurrence of the definition over-fire when the test turned out to be too narrow
    //   for both of them at once. `screenAsk` is now the single home: it decides what a screen IS and
    //   returns the specification it runs on, so a sentence the definition path stood down for is by
    //   construction a sentence this composes.
    //
    // ★ THREE FILTERS, AND EACH REFUSES RATHER THAN GUESSES: a numeric condition needs a field, a
    //   comparator and a number; a band must be one of the five published labels; a finding must be
    //   one of the 22 rules that actually write `stock_findings` rows. A sentence matching none is
    //   not a screen and falls through unchanged, exactly as before.
    // ⚠ AND IT IS THE SAME `screenAnswer` STEPS 1 AND 2a-bis CALL, NOT A COPY OF IT. Those two are
    //   overrides on branches that would otherwise return first; this is the ordinary path. Three
    //   call sites, one behaviour — which is the whole point, because a screen composed differently
    //   depending on which gate happened to catch it is the defect one layer up.
    const asScreen = await screenAnswer(turn);
    if (asScreen) return asScreen;

    // ★★ TWO NAMED PONDS, AND IT MUST BE TRIED BEFORE THE SINGLE-POND ANSWER — N-1.
    //
    // ⚠ MEASURED: "compare pharma and FMCG" answered about FMCG alone and "pharma vs cement" about
    //   Cement alone. `composePondAnswer` hands the whole sentence to `matchPondName`, which returns
    //   its single best match, so the second pond was dropped with nothing said. Ordering is the fix:
    //   the two-pond resolver returns `null` for anything that is not two distinct named ponds, so
    //   this can only ever take a question the single-pond answer would have got half right.
    const versus = await composeVersusAnswer(turn.raw);
    if (versus) return versus;

    // ★ A NAMED POND. Until this batch a question about six companies was answered with the band
    //   distribution of all 95 — every figure real, none of them about what was asked.
    const pond = await composePondAnswer(turn.raw);
    if (pond) return pond;

    // ★ A FRAME WE DECLINE — SC-05 / SC-12. See question-shape.ts#declinedFrame.
    const frame = declinedFrame(turn.raw);
    if (frame) {
      const declined = await composeFrameDeclinedScreen(frame);
      if (declined) return declined;
    }

    // ⚠ AND ONLY THEN THE UNIVERSE. A screen with no conditions is NOT a screen: running one with an
    //   empty condition list returns everything and presents it as a match set — a filter that
    //   filtered nothing, rendered as though it had. The cross-section is the honest answer to a
    //   genuinely market-wide question, and it is the last reading rather than the default.
    if (router.operation === "screen" || /how many|across the market|universe|market-wide|in total/i.test(turn.raw)) {
      const uni = await composeUniverseAnswer();
      if (uni) return uni;
    }
  }

  // 4 · ★ A HAND-AUTHORED FAMILY IS THE GUARANTEED SHAPE, SO IT GOES FIRST (§5.3, corrected at 5b).
  //
  //     §5.3 makes the planner the general case and keeps families "for questions that deserve a
  //     guaranteed shape". This step used to run AFTER the planner, and step 4's own comment claimed
  //     "there are none registered by default" while three were — so `buildManifest` (which returns
  //     null only for an unknown symbol) intercepted every resolved subject and all three families
  //     were dead code. The stage-5a probe confirmed it: 0 of 41 turns reached one.
  //
  //     An exception that never fires is not an exception. These three shapes are also the only
  //     answers in the system that are DETERMINISTIC end to end — no model in the path at all — and
  //     they cover the highest-frequency question shapes. Guaranteeing those and planning the tail
  //     is strictly better than planning everything, especially given what the planner samples.
  //
  //     Slot predicates only — never a data read, because a predicate that queries has already paid
  //     for the composition it may reject.
  for (const c of COMPOSITIONS) {
    if (!c.when.operation.includes(router.operation)) continue;
    // `null` is a legal member (§5 amendment, contract.ts) — a family may claim the UN-NARROWED
    // question specifically, which is not the same as claiming every lens.
    if (c.when.lens && !c.when.lens.includes(router.lens)) continue;
    // ★ THE THREE-WAY (contract.ts). `none` is what lets a family claim the SUBJECTLESS question
    //   specifically — the miss-log's "what has changed in promoter holdings this quarter" — without
    //   also claiming every question that named a company.
    if (c.when.subject === "required" && !symbol) continue;
    if (c.when.subject === "none" && symbol) continue;
    // ★ THE SENTENCE GUARD (contract.ts). Still pure and synchronous and still not a data read — the
    //   raw question is part of the turn. It is what lets two families share every slot and stay
    //   separate, so that the order of this array stops being the thing that decides.
    if (c.when.question && !c.when.question(turn.raw, router)) continue;

    // Tier and depth ARE data, so they are checked here — after the slot match, once. A failure now
    // falls through to the PLANNER rather than to the generic path: the planner reads the same
    // manifest and will simply not plan the blocks this subject cannot fill.
    if (c.when.minTier !== undefined && symbol) {
      const cov = await resolveStockCoverage(symbol);
      const tier = stockCoverage(cov.coverage)?.tier ?? 0;
      const quarters = stockCoverage(cov.coverage)?.depth.quarters ?? 0;
      if (tier < c.when.minTier) continue;
      if (c.when.depthFloor !== undefined && quarters < c.when.depthFloor) continue;
    }
    const built = await c.build(ctx);
    return {
      kind: "composed",
      // ★ THE VARIANT WINS WHERE A FAMILY SETS ONE. OA answers four questions under one id and F
      //   answers four statements under another; without this the miss-log and the /ask diagnostic
      //   see one string for four answers and cannot measure whether the split is landing (T-22 makes
      //   that log the thing that decides what gets built next). See ComposedAnswer.variantId.
      compositionId: built.variantId ?? c.id,
      sections: built.sections, prose: built.prose, missLogged: false,
    };
  }

  // 5 · ★ THE PLANNED PATH — the general case (§5.3). The model reads what we HOLD and decides the
  //     shape; code resolves and formats. Everything no family claimed lands here.
  if (symbol) {
    const manifest = await buildManifest(symbol);
    if (manifest) {
      const planned = await planAnswer(turn.raw, manifest, router, profile.tone);
      const built = await executePlan(symbol, planned.plan);
      return {
        kind: "composed",
        compositionId: `planned:${planned.source}`,
        sections: built.sections,
        prose: built.prose,
        missLogged: false,
        plan: planned,
      };
    }
  }

  // 6 · NEITHER A FAMILY NOR A MANIFEST. The generic composition — a real answer plus the row that
  //     decides which family gets built next.
  const generic = await composeGeneric(ctx);
  return {
    kind: "composed", compositionId: "generic", sections: generic,
    prose: { opening: [], leads: {}, after: {}, close: `That is everything we hold on ${symbol ?? "this"} today.` },
    missLogged: true,
  };
}
