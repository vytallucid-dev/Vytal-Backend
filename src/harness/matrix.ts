// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATRIX — the question set the invariants run over, and how each answer is produced.
//
// ── ★ WHAT MAKES THIS DIFFERENT FROM THE STAGE-8B CORPUS ──────────────────────────────────────────
// `scripts/lib/composed-corpus.ts` builds seven answers so three gates have something to scan. It is
// a corpus, and its job is to be non-empty. This is a MATRIX, and its job is to be a cross-section:
// every operation, every lens, both subject paths, the reader's own book, the action controls, and —
// the one the stage-9 defect list demands — the fallback planner exercised ALONE.
//
// ── ★ THE FALLBACK RUNS ON ITS OWN, AND THAT IS THE POINT OF THE `plannerless` ARM ────────────────
// `deterministicPlan` branched on ONE condition and produced identical blocks for everything else.
// It survived because the model planner normally runs in front of it — so the defect was only
// reachable when the model failed, which is precisely when nobody is looking. A fallback tested only
// incidentally is a fallback nobody has tested.
//
//   AI_PROVIDER=mock makes `planAnswer` return `deterministicPlan` directly. The arm below sets it
//   for the duration of the build, so every answer in that arm is the fallback's own work.
//
// ── ★ THE ROUTER IS LEXICAL HERE, AND THE LIVE ONE IS A SEPARATE LAYER ───────────────────────────
// Not because the model does not matter — it is the root cause of most of stage 9 — but because
// these invariants are about the ANSWER, and an answer that varies run to run cannot be asserted
// over. §6.5 measured the model at 80–88% reproducible and the cache re-rolls on restart. The live
// router gets its own gate (`verify-router-live.ts`) with assertions that tolerate that variance.
// Both properties are needed; they are not needed in the same file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { route, lexicalClassifier, type Classifier } from "../router/route.js";
import { composeTurn } from "../composition/compose.js";
import { setMissLogOrigin } from "../composition/miss-log.js";
import type {
  TurnContext, OperationSlot, LensSlot, Perspective, ActionSlot,
} from "../router/contract.js";
import type { AnswerUnderTest } from "./invariants.js";
import { SUBJECTS } from "./fixtures.js";
import { readFileSync } from "node:fs";

/** A question, and what the matrix is using it to exercise. */
export interface Case {
  readonly label: string;
  readonly question: string;
  /** `reader` cases need an authenticated book; `market` cases must NOT be given one. */
  readonly scope: "market" | "reader";
  /**
   * ★ THE SLOTS TO DRIVE THIS CASE WITH, WHEN THE POINT OF THE CASE IS THE COMPOSITION.
   *
   * ⚠ THIS IS NOT THE STAGE-4 MISTAKE REPEATED, AND THE DIFFERENCE IS WHICH LAYER IS BEING TESTED.
   *   Stage 4's suite injected a classifier and that was fine; what was NOT fine is that it was the
   *   ONLY test, so the router was never once exercised on the path production uses. That gap is
   *   closed by `verify-router-live.ts`, which drives the real model and asserts on ITS behaviour.
   *
   *   This layer asserts invariants over ANSWERS. To do that it has to be able to REACH every
   *   composition, and the lexical classifier — deliberately under-confident by design — cannot:
   *   "what is on my watchlist" contains no pattern it recognises, so it answers `unresolved` and
   *   the watchlist composition is never built. Testing the composer through a router that refuses
   *   to route is testing the router.
   *
   * ⚠ AND THE SUBJECT IS STILL RESOLVED BY CODE. These slots carry subject MENTIONS — the strings a
   *   reader typed — exactly as the model's would. `route()` puts them through resolver #1
   *   unchanged, so no test here can name a ticker the system then trusts. N-1 holds in the harness
   *   for the same reason it holds in production.
   *
   * Omitted ⇒ the lexical classifier runs, which is what the routing-behaviour cases want.
   */
  readonly slots?: {
    operation: OperationSlot | "unresolved";
    lens?: LensSlot | null;
    perspective?: Perspective;
    action?: ActionSlot | null;
    timeframe?: { kind: "latest" | "quarters" | "years"; n: number | null } | null;
    subjects?: readonly string[];
  };
}

/**
 * A classifier that returns exactly the declared slots. `source: "model"` because the composer reads
 * that field to choose between two clarify sentences, and a harness that always said "lexical" would
 * be exercising the degraded copy path on every case.
 */
function fixedClassifier(c: Case): Classifier {
  return async () => ({
    scope: "in_scope",
    subjects: (c.slots?.subjects ?? []).map((text) => ({ text })),
    operation: c.slots!.operation,
    lens: c.slots?.lens ?? null,
    timeframe: c.slots?.timeframe ?? null,
    confidence: "high",
    perspective: c.slots?.perspective ?? (c.scope === "reader" ? "reader" : "market"),
    action: c.slots?.action ?? null,
    source: "model",
    degradedReason: null,
  });
}

const S = SUBJECTS;

/**
 * ★ ONE CASE PER OPERATION × THE SHAPES THAT DIVERGE. Not a list of questions someone liked — every
 *   row is here because it reaches code the others do not.
 */
export const MARKET_CASES: readonly Case[] = [
  // ── ★ THE OPERATION VOCABULARY, SLOT-DRIVEN. These cases exist to reach a COMPOSITION, so the
  //    slots are declared rather than guessed at by a classifier that may or may not agree today.
  { label: "orient · healthy", question: `how is ${S.healthy} doing`, scope: "market",
    slots: { operation: "orient", subjects: [S.healthy] } },
  { label: "decompose · healthy", question: `why is ${S.healthy} scored the way it is`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.healthy] } },
  { label: "history · healthy", question: `show me ten years of ${S.healthy} history`, scope: "market",
    slots: { operation: "history", lens: "price", timeframe: { kind: "years", n: 10 }, subjects: [S.healthy] } },
  { label: "lookup · healthy", question: `how much does ${S.healthy} spend on R&D`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.healthy] } },
  // ═══ ★ T-1 · SCREENS. THERE WERE NO SCREEN CASES IN THIS MATRIX AT ALL ════════════════════════
  //
  // ⚠ WHICH IS EXACTLY WHY FINDING 8 SHIPPED. `resolveScreen` read the match list off `capped.items`
  //   / `capped.rows`, and `Capped<T>` is `{ total, shown }` — so the total was right and the LIST
  //   WAS ALWAYS EMPTY. Every screen printed "no company in our coverage meets those conditions"
  //   directly above its own "Matched 93". Nothing in the suite ever built a screen, so nothing
  //   could see it.
  //
  // TWO cases, and the pair is the point: one that matches and one that genuinely does not. A single
  // matching case would pass against a renderer that never shows the empty phrase, and a single
  // empty case would pass against the bug itself.
  { label: "screen · matches", question: "find stocks whose health score is less than 80", scope: "market",
    slots: { operation: "screen" } },
  { label: "screen · honest empty", question: "companies with return on equity above 900", scope: "market",
    slots: { operation: "screen" } },
  // ★ T-1b · A NON-HEALTH CONDITION, WHICH IS THE CASE `hero-set` GOT WRONG. It carried ONE figure
  //   per row — the HEALTH score — so a screen on return-on-equity showed a number the reader had not
  //   asked about and pushed ROE into a subtitle string. The column assertion below is only
  //   meaningful against a metric that is not health.
  { label: "screen · non-health metric", question: "which stocks have return on equity above 20%", scope: "market",
    slots: { operation: "screen" } },
  // ⚠ THE SECOND HISTORY CASE, AND IT EXISTS BECAUSE THE FIRST ONE ALONE COULD NOT SEE THE DEFECT.
  //   "what is X's revenue trend?" and "show me ten years of X history" both resolve
  //   `operation: "history"` and rendered a byte-identical answer — one narrowed to the FILED LINES
  //   and one to the company over time. One `history` row in the matrix meant `I-DISTINCT` had
  //   nothing to compare it against, so a whole class of "two questions, one answer" was invisible
  //   to a gate written specifically to catch that class.
  { label: "history · fundamentals", question: `what is ${S.healthy}'s revenue trend`, scope: "market",
    slots: { operation: "history", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "list_findings · healthy", question: `what has been flagged on ${S.healthy}`, scope: "market",
    slots: { operation: "list_findings", subjects: [S.healthy] } },
  { label: "compare · two subjects", question: `compare ${S.healthy} and ${S.bank}`, scope: "market",
    slots: { operation: "compare", subjects: [S.healthy, S.bank] } },
  { label: "explain · price", question: `why did ${S.healthy} fall today?`, scope: "market",
    slots: { operation: "explain", lens: "price", timeframe: { kind: "latest", n: null }, subjects: [S.healthy] } },

  // ── the lenses that select different blocks ───────────────────────────────────────────────────
  { label: "lens ownership", question: `who owns ${S.healthy}`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.healthy] } },
  { label: "lens fundamentals", question: `tell me about ${S.healthy} financials`, scope: "market",
    slots: { operation: "orient", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "lens events", question: `what dividends has ${S.healthy} paid`, scope: "market",
    slots: { operation: "lookup", lens: "events", subjects: [S.healthy] } },
  { label: "lens valuation", question: `is ${S.healthy} expensive`, scope: "market",
    slots: { operation: "lookup", lens: "valuation", subjects: [S.healthy] } },

  // ── ★ BOTH SUBJECT PATHS. A thin subject must degrade honestly, not vanish. ───────────────────
  { label: "orient · thin", question: `how is ${S.thin} doing`, scope: "market",
    slots: { operation: "orient", subjects: [S.thin] } },
  { label: "ownership · thin", question: `who owns ${S.thin}`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.thin] } },
  { label: "history · thin", question: `show me ${S.thin} over time`, scope: "market",
    slots: { operation: "history", timeframe: { kind: "quarters", n: 8 }, subjects: [S.thin] } },
  { label: "orient · bank", question: `how is ${S.bank} doing`, scope: "market",
    slots: { operation: "orient", subjects: [S.bank] } },
  { label: "decompose · bank", question: `why is ${S.bank} scored the way it is`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.bank] } },


  // ═══ ★★ PHASE 1 · BATCH 1 — F · FUNDAMENTALS. FOUR STATEMENTS × FOUR STATEMENT FAMILIES ════════
  //
  // ⚠ THE ONE FUNDAMENTALS CASE THAT EXISTED WAS `lens fundamentals` ON TCS, and it could not see any
  //   of what this family does. Four things are only reachable with more rows, and each one is a
  //   defect class rather than a nice-to-have:
  //
  //   · THE BASIS. It is chosen per industry family, so measured live TCS reads consolidated and
  //     HDFCBANK reads standalone. One subject cannot exercise a per-family choice, and `I-BASIS`
  //     asserting over one basis is `I-BASIS` asserting over half the contract.
  //   · THE CADENCE. The P&L is quarterly; the balance sheet, the cash flow and the ratios are
  //     annual-only, and annual depth is a median of 2 years against 8 quarters. A matrix that only
  //     ever asks the quarterly question never builds the thin axis.
  //   · THE STATEMENT FAMILY. A bank's P&L runs Interest earned → NII → PPOP → PAT and shares no row
  //     with a manufacturer's. `resolveStatements` writes the five out separately for that reason,
  //     and an untested branch of a five-way dispatch is four fifths of a guess.
  //   · THE UNSCORED CASE. All 142 NBFCs are tier 1. An answer full of real figures reads as a scored
  //     company unless it says otherwise, and only an unscored subject WITH DEPTH can prove it does.
  { label: "F · pnl · healthy", question: `what is ${S.healthy} revenue`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "F · balance sheet · healthy", question: `how much debt does ${S.healthy} carry`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "F · cash flow · healthy", question: `does ${S.healthy} convert profit into cash`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "F · returns · healthy", question: `what does ${S.healthy} earn on equity`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.healthy] } },
  // ★ THE BANK. A different statement AND — measured — the other basis.
  { label: "F · pnl · bank", question: `what is ${S.bank} net interest income`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.bank] } },
  { label: "F · balance sheet · bank", question: `what are ${S.bank} deposits and advances`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.bank] } },
  // ★ THE NBFC. The fourth statement family, and the unscored-with-depth case in one subject.
  { label: "F · pnl · nbfc (unscored)", question: `show me ${S.nbfc} financials`, scope: "market",
    slots: { operation: "orient", lens: "fundamentals", subjects: [S.nbfc] } },
  { label: "F · balance sheet · nbfc", question: `what does ${S.nbfc} owe`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.nbfc] } },
  // ★★ THE THIN PATH, AND IT IS THE PRODUCT RATHER THAN THE FALLBACK. Measured: MANIPALHOS is tier 1
  //    with 1 quarter and ZERO annual years, so the P&L answers with one column and the balance-sheet
  //    answer must decline on the annual axis WHILE SAYING we hold a quarter. Those two cases are the
  //    whole reason the cadence is split, and they need both rows to be visible.
  { label: "F · pnl · thin (tier 1)", question: `what is ${S.thinTier1} revenue`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.thinTier1] } },
  { label: "F · balance sheet · thin (annual absent)", question: `what is ${S.thinTier1} balance sheet like`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.thinTier1] } },
  // ⚠ TIER 0 — no quarterly row in ANY of the five tables, so this must NOT reach the family at all
  //   and must degrade through the planner. MOLBIO's role in this matrix, restated: see fixtures.ts.
  { label: "F · tier 0 falls past the family", question: `what is ${S.thin} revenue`, scope: "market",
    slots: { operation: "lookup", lens: "fundamentals", subjects: [S.thin] } },

  // ═══ ★★ PHASE 1 · BATCH 1 — OA · OWNERSHIP. FOUR ANSWERS UNDER ONE LENS ════════════════════════
  //
  // ⚠ THE T08 MISROUTE IS THE SECOND CASE BELOW, AND IT HAD NO ROW IN THIS MATRIX. Stage 6 recorded
  //   that "have TCS insiders been buying or selling?" classifies `lookup + ownership` — identically
  //   to "who owns TCS" — and was answered with the register: right shape, real figures, wrong
  //   question. Nothing in the suite ever asked it, so nothing could see it. `I-DISTINCT` is what
  //   makes the pair meaningful: four questions with the same slots must not produce one answer.
  { label: "OA · register · deep", question: `who owns ${S.deepOwnership}`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.deepOwnership] } },
  { label: "OA · dealing · deep (the T08 misroute)", question: `have ${S.deepOwnership} insiders been buying or selling`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.deepOwnership] } },
  { label: "OA · flow · deep", question: `how has the promoter holding in ${S.deepOwnership} moved`, scope: "market",
    slots: { operation: "history", lens: "ownership", subjects: [S.deepOwnership] } },
  { label: "OA · pledging · not established", question: `how much of ${S.deepOwnership} promoter holding is pledged`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.deepOwnership] } },
  // ★★ THE OTHER PLEDGE STATE, AND IT IS THE ONE THAT COULD PRINT A NUMBER. Measured: ASHOKLEY is the
  //    only shape where BOTH pledge columns are positive — and they disagree, 51.37% by share count
  //    against 59.03% by the pct column. A pledge suite with only the zero case would pass against a
  //    renderer that prints the figure whenever it has one.
  { label: "OA · pledging · disclosed but unquantified", question: `how much of ${S.pledged} promoter holding is pledged`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.pledged] } },
  // ★ NO PROMOTER AT ALL. HDFCBANK files promoter 0 and promoter_shares 0, so the read layer divides
  //   0 by 0 and hands back a plausible "0% pledged" — a statement about a promoter holding that does
  //   not exist. The third pledge state exists for this row.
  { label: "OA · register · no promoter", question: `who owns ${S.bank}`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.bank] } },
  // ★★ THE THIN OWNERSHIP PATH — exactly one filing (measured). The flow answer must degrade to the
  //    register with a sentence rather than draw a chart of one point, and the brief asks for this
  //    subject specifically.
  { label: "OA · flow · single filing", question: `how has the promoter holding in ${S.thinTier1} moved`, scope: "market",
    slots: { operation: "history", lens: "ownership", subjects: [S.thinTier1] } },
  { label: "OA · register · single filing", question: `who owns ${S.thinTier1}`, scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [S.thinTier1] } },
  // ★★★ THE MISS-LOG ROW. `in_scope · lookup · ownership`, NO SUBJECT — the one genuine reader row in
  //     the log, which reached the generic branch and was classified missing-family. `subjects: []` is
  //     the whole point of the case: it must now land on `ownership.movers`, not on step 6.
  { label: "OA · movers · the miss-log row", question: "what has changed in promoter holdings this quarter", scope: "market",
    slots: { operation: "lookup", lens: "ownership", subjects: [] } },


  // ═══ ★★ PHASE 1 · BATCH 2 — PG · PEER GROUP ═══════════════════════════════════════════════════
  //
  // ⚠ THE OPERATION IS THE THING TO NOTICE HERE. Measured on the live model, a peer question arrives
  //   as `compare` WITH ONE SUBJECT or as `screen` WITH ONE SUBJECT — never under a lens, because
  //   `LensSlot` has no "peers" member. Both routings are exercised below, because the family claims
  //   both and a suite that only ever drove one would leave half the predicate untested.
  { label: "PG · standing · compare-routed", question: `how does ${S.healthy} compare with its peer group`, scope: "market",
    slots: { operation: "compare", subjects: [S.healthy] } },
  { label: "PG · roster · screen-routed", question: `who else is in ${S.healthy}'s peer group`, scope: "market",
    slots: { operation: "screen", subjects: [S.healthy] } },
  // ★★ THE UNSCORED POND. Measured: 10 of 23 ponds have ZERO scored members and none is mixed, so
  //    this is the only shape "a peer group containing unscored members" can take. The roster must
  //    carry NO score column — a column of "not held" in every row is the empty-card defect turned
  //    ninety degrees, which is the batch-1 lesson at the other axis.
  { label: "PG · ★ unscored pond", question: `who are ${S.nbfc}'s peers`, scope: "market",
    slots: { operation: "compare", subjects: [S.nbfc] } },
  // ⚠ NO POND AT ALL — 2,143 of 2,291 stocks. The display-only firewall working as designed, which is
  //   a different state from a pond we could not read and must not render the same.
  { label: "PG · unassigned subject", question: `who are ${S.thinTier1}'s peers`, scope: "market",
    slots: { operation: "compare", subjects: [S.thinTier1] } },
  // ★★ THE POND WITH NO COMPANY NAMED, AND THE SECOND ROW IS THE ROUTER-VARIANCE CASE. §6.5 measured
  //    the model at 80–88% run-to-run: this exact question classified `screen` on one live run and
  //    `orient · price` on the next, and under the old operation-gated branch the second run fell
  //    through to the GENERIC composition. Both operations are driven here so the sentence-based
  //    recognition is asserted rather than assumed.
  { label: "PG · pond by name · screen-routed", question: "how is the large-cap pharma peer group doing", scope: "market",
    slots: { operation: "screen", subjects: [] } },
  { label: "PG · pond by name · orient-routed (the variance case)", question: "how is the large-cap pharma peer group doing", scope: "market",
    slots: { operation: "orient", lens: "price", subjects: [] } },
  { label: "PG · pond by name · unscored", question: "how is the large-cap NBFCs peer group doing", scope: "market",
    slots: { operation: "screen", subjects: [] } },

  // ═══ ★★ PHASE 1 · BATCH 2 — SC · THE TWO FRAME DECLINES ═══════════════════════════════════════
  //
  // ⚠ BOTH WERE MISHANDLED IN OPPOSITE DIRECTIONS AND NEITHER HAD A ROW HERE. "undervalued" fell to
  //   the whole-universe cross-section with nothing saying the criterion was dropped; "best stocks"
  //   was classified `out_of_scope` and refused with a sentence that misdescribes our own coverage.
  //   The second is driven at `unresolved` + out-of-scope-shaped wording deliberately — the override
  //   is the thing under test.
  { label: "SC · ★ frame decline · valuation", question: "show me undervalued stocks", scope: "market",
    slots: { operation: "screen", lens: "valuation", subjects: [] } },
  { label: "SC · ★ frame decline · superlative", question: "what are the best stocks to buy", scope: "market",
    slots: { operation: "screen", subjects: [] } },

  // ═══ ★★ PHASE 1 · BATCH 2 — C · THE VARIANTS ══════════════════════════════════════════════════
  //
  // ★★ THE DANGEROUS ONE. `comparable: false` was one sentence for three different facts, and the
  //    health section rendered as a titled card with its marks emptied — which a reader reads as zero,
  //    and zero as a verdict. On an unscored side the section is now omitted WHOLE, with one line of
  //    prose in its place, so this case asserts an ABSENCE of a section rather than its contents.
  { label: "C · ★ one side unscored", question: `compare ${S.healthy} and ${S.nbfc}`, scope: "market",
    slots: { operation: "compare", subjects: [S.healthy, S.nbfc] } },
  // ⚠ THREE RESOLVED, TWO COMPARED, AND THE THIRD WAS BEING DROPPED IN SILENCE — the same defect
  //   stage 6 fixed at arity two, surviving one arity up.
  { label: "C · three named, two compared", question: `compare ${S.healthy}, ${S.deepOwnership} and WIPRO`, scope: "market",
    slots: { operation: "compare", subjects: [S.healthy, S.deepOwnership, "WIPRO"] } },

  // ═══ ★★ PHASE 2 · BATCH 1 — T · TRAJECTORY ════════════════════════════════════════════════════
  //
  // ⚠ EVERY ONE OF THESE IS DRIVEN AT A DIFFERENT SLOT PAIR ON PURPOSE, because the two families in
  //   this batch share every slot they have. `healthQuestion()` is what separates them, and driving
  //   them all at one operation would assert the sentence guard on one branch only.
  //
  // ★★ THE THREE LEADS ARE THREE ROWS, AND THAT IS `I-DISTINCT`'s DOING. PG's `peerLead` claimed in
  //    its own header that "the difference lives entirely in which sentence leads" while the two
  //    answers were byte-identical, and the invariant caught it. Same claim here, same three rows, so
  //    the same catch is available. The sections ARE identical by design; the openings must not be.
  { label: "T · arc", question: `how has ${S.moved}'s score moved over time`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.moved] } },
  { label: "T · turn", question: `when did ${S.moved} start declining`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.moved] } },
  { label: "T · verdict", question: `has ${S.moved} been improving or worsening`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.moved] } },
  // ★★ THE ROUTER-VARIANCE ROW. §6.5 measured 80–88% agreement, and a history question landing on
  //    `orient · health` is the commonest way it disagrees. The family claims both operations for
  //    exactly this; the row is what proves the claim is live rather than documented.
  { label: "T · arc · orient-routed (the variance case)", question: `how has ${S.moved}'s score moved over time`,
    scope: "market", slots: { operation: "orient", lens: "health", subjects: [S.moved] } },
  // ★★ THE NEGATIVE CONTROL FOR THE CHANGE-POINT DETECTOR. EICHERMOT segments to exactly ONE phase
  //    (range 5.3 over 14 quarters). Without a flat subject every phase assertion is checked only on
  //    series that DO segment, and a detector that always finds a change passes all of them.
  { label: "T · ★ flat — one phase", question: `has ${S.flat} been getting better or worse`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.flat] } },
  // ★★ THE REDISTRIBUTED PILLAR ON THE TIME AXIS. `score_snapshots` stores an unscorable pillar's
  //    subtotal as literal 0, so a pillar line plotted straight dives to the floor and comes back —
  //    the zero-for-unknown defect in the TIME dimension. VEDL's Market is 0-stored in its two most
  //    recent quarters.
  { label: "T · ★ redistributed pillar", question: `how has ${S.redistributed}'s score moved over time`,
    scope: "market", slots: { operation: "history", lens: "health", subjects: [S.redistributed] } },
  // ⚠ THE UNSCORED ARM — the branch the §4.1 test actually turned on. BAJFINANCE has 32 filed
  //   quarters and no score, so the answer must draw the FILED series and say which one it is.
  { label: "T · ★ unscored — the filed series", question: `how has ${S.nbfc} changed over time`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.nbfc] } },
  // ⚠ TIER 1 AND ALMOST NOTHING BEHIND IT. Reachable by the family (minTier 1) and thin once there —
  //   the arm MOLBIO could never test, because a tier-0 subject never reaches any family at all.
  { label: "T · thin tier-1", question: `how has ${S.thinTier1} changed over time`, scope: "market",
    slots: { operation: "history", lens: "health", subjects: [S.thinTier1] } },

  // ═══ ★★ PHASE 2 · BATCH 1 — A · ATTRIBUTION ═══════════════════════════════════════════════════
  //
  // ⚠ THE FIRST ROW EXISTS BECAUSE THIS BATCH SHIPPED THE DEFECT IT CATCHES. T and A both claim
  //   `{orient, health, required}`, `compose.ts` takes the FIRST match in an ordered array, and
  //   "what is dragging TCS's score down" — the literal second example in `attribution.ts` — was
  //   answered by `trajectory.arc` with a phase chart and no decomposition. Nothing failed. The two
  //   rows below are driven at the SAME slots with different sentences, which is the only way to
  //   assert that the partition and not the array position is deciding.
  { label: "A · ★ cause, at trajectory's own slots", question: `what is dragging ${S.healthy}'s score down`,
    scope: "market", slots: { operation: "orient", lens: "health", subjects: [S.healthy] } },
  { label: "A · why", question: `why is ${S.healthy} scored the way it is`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.healthy] } },
  // ★★ THE BANK, AND IT IS THE ONE THAT EXERCISES THE FIELD GRAIN HARDEST. Banking metric keys
  //    (Tier1, GNPA, CASA, NIM) collide with the non-financial ones by design — `bars-loader/
  //    label-map.ts` says so in its own header — so a walk proven only on a non-financial has never
  //    seen the labels most likely to resolve to the wrong name.
  { label: "A · ★ bank — field grain", question: `why is ${S.moved} scored the way it is`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.moved] } },
  // ★★ THE REDISTRIBUTED BAR. Its applied weight is ZERO, so a computed gap would legitimately be
  //    0.00 — and 0.00 in a "what this costs you" column reads as "this one is perfect", which is the
  //    worst available reading of "we could not measure it". Only 2 stocks carry one at FY27Q1.
  { label: "A · ★ redistributed pillar", question: `why is ${S.redistributed} scored the way it is`,
    scope: "market", slots: { operation: "decompose", lens: "health", subjects: [S.redistributed] } },
  // ⚠ UNSCORED, AND THE FAMILY MUST STILL ANSWER. At `minTier: 2` this fell to the planner, which
  //   wrote "Evaluating the health score of Bajaj Finance Limited requires looking across its
  //   multi-quarter financial trajectory" — every clause of which implies a score exists.
  { label: "A · ★ unscored — no walk to draw", question: `why is ${S.nbfc} scored the way it is`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.nbfc] } },

  // ═══ ★★ PHASE 2 · BATCH 2 — M · META ══════════════════════════════════════════════════════════
  //
  // ⚠ EVERY ONE OF THESE COMPOSED `generic` WITH A SINGLE `nothing-found` SECTION BEFORE THIS BATCH.
  //   Nothing in `COMPOSITIONS` claimed `operation: "explain"` at all, so a reader asking what a
  //   pillar means was shown an empty card. Measured, not inferred.
  //
  // ★ THE FIVE ROWS ARE FIVE VOCABULARIES, WHICH IS THE FAMILY'S WHOLE CLAIM. One question shape, one
  //   composition, five possible homes — and the order is specific-before-general, so a named finding
  //   beats the general concept whose alias it contains.
  { label: "M · concept", question: "what does Foundation mean", scope: "market",
    slots: { operation: "explain", subjects: [] } },
  { label: "M · ★ a named FINDING, not the concept", question: "what does Sticky Divergence mean", scope: "market",
    slots: { operation: "explain", subjects: [] } },
  { label: "M · a metric gloss", question: "what does Return on Assets mean", scope: "market",
    slots: { operation: "explain", subjects: [] } },
  { label: "M · a canonical engine name with no gloss", question: "what is ROCE", scope: "market",
    slots: { operation: "lookup", subjects: [] } },
  { label: "M · the published bands", question: "what do the labels mean", scope: "market",
    slots: { operation: "explain", subjects: [] } },
  // ⚠ THE HONEST UNKNOWN. A term we do not define must produce a statement about our vocabulary, not
  //   a search miss — and `I-BOUNDARY` must not fire on the arm that legitimately has no payload.
  { label: "M · ★ a term we do not define", question: "what does jellyfish mean", scope: "market",
    slots: { operation: "explain", subjects: [] } },
  // ★★ THE ROUTER-VARIANCE ROW. `unresolved` is what the lexical classifier returns for most
  //    definition questions and what the model returns for some, and §6.2 gives an unresolved
  //    operation CHIPS before step 4 is ever reached. `compose.ts` step 2c is the override.
  { label: "M · ★ unresolved-routed (the variance case)", question: "what does Foundation mean", scope: "market",
    slots: { operation: "unresolved", subjects: [] } },

  // ═══ ★★ PHASE 2 · BATCH 2 — PT · PATTERNS ═════════════════════════════════════════════════════
  //
  // ⚠ "what has been flagged on TCS" WAS ANSWERED WITH A P&L TABLE AND AN OWNERSHIP SPLIT. The
  //   deterministic planner drew a whole-company orientation with a `nothing-found` inside it.
  { label: "PT · the census", question: `what has been flagged on ${S.healthy}`, scope: "market",
    slots: { operation: "list_findings", subjects: [S.healthy] } },
  // ★★ THE WITNESSED EMPTY — the fixture the brief asks for by name. ICICIBANK holds 7 of 14 quarters
  //    where the rules RAN AND RAISED NOTHING, which is a result and must render as one.
  { label: "PT · ★ a witnessed-empty history", question: `what has been flagged on ${S.witnessedEmpty}`,
    scope: "market", slots: { operation: "list_findings", subjects: [S.witnessedEmpty] } },
  // ★★ A STRONG `doesntMean` — Sticky Divergence's is the strongest in the corpus ("you read the
  //    state, you can't time the resolution"). This is the row that proves the boundary travels.
  { label: "PT · ★ a strong boundary", question: `why was ${S.moved} flagged`, scope: "market",
    slots: { operation: "explain", subjects: [S.moved] } },
  // ⚠ UNSCORED, AND THE FILING CHANNEL IS STILL REAL. A `minTier: 2` predicate would have sent this to
  //   the planner; the two channels are separate for exactly this reason.
  { label: "PT · ★ unscored — the filing channel alone", question: `what has been flagged on ${S.nbfc}`,
    scope: "market", slots: { operation: "list_findings", subjects: [S.nbfc] } },
  { label: "PT · thin tier-1", question: `is anything wrong with ${S.thinTier1}`, scope: "market",
    slots: { operation: "list_findings", subjects: [S.thinTier1] } },

  // ═══ ★★ PHASE 2 · BATCH 2 — THE CHANGE BRIDGE ═════════════════════════════════════════════════
  //
  // ★ RAISED AT BATCH 1, RULED AND BUILT HERE. The row exists to keep `I-SPLIT-HONEST` populated: the
  //   invariant only fires where a `bridge` actually rendered, and a green tick over no bridge is a
  //   green tick over nothing.
  { label: "A · ★ the change bridge", question: `why did ${S.moved}'s score fall`, scope: "market",
    slots: { operation: "decompose", lens: "health", subjects: [S.moved] } },
  { label: "A · ★ a change across a redistribution", question: `why did ${S.redistributed}'s score drop`,
    scope: "market", slots: { operation: "decompose", lens: "health", subjects: [S.redistributed] } },

  // ═══ ★★ PHASE 3 — XT · EXTENDED COVERAGE ══════════════════════════════════════════════════════
  //
  // ⚠ `resolveCompanySnapshot` READ ONLY `fv.nonFinancial`, SO THE BROADEST QUESTION IN THE PRODUCT
  //   WAS FIGURE-LESS FOR EVERY BANK, NBFC AND INSURER — 194 companies with real filed depth.
  //   "How is HDFCLIFE doing" answered with ONE sentence over an empty anchor. These four rows are
  //   the four industry families the fundamentals view carries, so a regression in any one is visible.
  { label: "XT · ★ an NBFC (143 of them, none scored)", question: `how is ${S.nbfc} doing`, scope: "market",
    slots: { operation: "orient", subjects: [S.nbfc] } },
  { label: "XT · ★ a life insurer (5, none scored)", question: "how is HDFCLIFE doing", scope: "market",
    slots: { operation: "orient", subjects: ["HDFCLIFE"] } },
  { label: "XT · ★ a general insurer (6, none scored)", question: "how is GICRE doing", scope: "market",
    slots: { operation: "orient", subjects: ["GICRE"] } },
  { label: "XT · a bank, which IS scored", question: `how is ${S.bank} doing`, scope: "market",
    slots: { operation: "orient", subjects: [S.bank] } },

  // ═══ ★★ PHASE 3 — DX · THE RESOLVED WINDOW ════════════════════════════════════════════════════
  //
  // ⚠ THE RESOLVED HALF WAS ALWAYS STATED AND THE ACKNOWLEDGED HALF WAS NOT. 20 quarters asked,
  //   14 drawn, correct label, nothing saying the reader had asked for more. `I-WINDOW-STATED` guards
  //   it and needs an answer that actually falls short to guard.
  { label: "DX · ★ asked 20 quarters, 14 exist", question: `show me ${S.healthy}'s score over the last 20 quarters`,
    scope: "market", slots: { operation: "history", lens: "health", timeframe: { kind: "quarters", n: 20 }, subjects: [S.healthy] } },
  { label: "DX · ★ asked 10 years, 8 exist", question: `show me ${S.healthy} profit and loss for the last 10 years`,
    scope: "market", slots: { operation: "lookup", lens: "fundamentals", timeframe: { kind: "years", n: 10 }, subjects: [S.healthy] } },
  // ★ AND THE CONTROL: an ask that IS met must not produce an apology.
  { label: "DX · an ask that is met", question: `show me ${S.healthy}'s last 4 quarters`,
    scope: "market", slots: { operation: "lookup", lens: "fundamentals", timeframe: { kind: "quarters", n: 4 }, subjects: [S.healthy] } },

  // ═══ ★★ PHASE 3 — MT · REFERENT ROUTING ═══════════════════════════════════════════════════════
  //
  // ⚠ THE THREE "WHY"s. Measured before this batch: after a composite it routed correctly by luck (the
  //   lens carried), after a margin fall and after a pattern card it fell to the PLANNER — a bare
  //   "why" became `decompose`, and `decompose + fundamentals` and `decompose + null` were claimed by
  //   nothing. The lens-owning families now claim `decompose`, and where no lens survives the router
  //   reads `TurnContext.lastFamily`.
  //
  // ⚠ THESE ARE SINGLE-TURN ROWS AND THEREFORE PROVE ONLY THE SLOT PAIR. The two-turn behaviour lives
  //   in `verify-answer-invariants.ts` §7, which is the only place that passes a prior context.
  { label: "MT · why, narrowed to fundamentals", question: "why", scope: "market",
    slots: { operation: "decompose", lens: "fundamentals", subjects: [S.healthy] } },
  { label: "MT · why, narrowed to ownership", question: "why", scope: "market",
    slots: { operation: "decompose", lens: "ownership", subjects: [S.healthy] } },
  { label: "MT · why, after a findings answer", question: "why", scope: "market",
    slots: { operation: "list_findings", subjects: [S.healthy] } },

  // ── ★ THE BRANCHES THAT ASK THE READER SOMETHING BACK — LEXICAL, because for these the ROUTING
  //    IS the behaviour under test and a declared slot would assume the answer.
  { label: "ambiguous subject", question: "how is HDFC doing", scope: "market" },
  { label: "bare subject", question: S.healthy, scope: "market" },
  { label: "out of scope", question: "what is Justin Bieber's income", scope: "market" },
  { label: "not covered", question: "how is Berkshire Hathaway doing", scope: "market" },
];

/** ★ THE READER'S OWN BOOK — where all four false statements lived. */
export const READER_CASES: readonly Case[] = [
  { label: "portfolio", question: "how is my portfolio doing", scope: "reader",
    slots: { operation: "orient", perspective: "reader" } },
  { label: "watchlist", question: "what is on my watchlist", scope: "reader",
    slots: { operation: "lookup", perspective: "reader" } },
  { label: "alerts", question: "what alerts do I have set", scope: "reader",
    slots: { operation: "lookup", perspective: "reader" } },
  // ★ THE SAME QUESTION FROM THE OTHER SIDE. Alerts and event reminders are two tables to us and one
  //   question to a reader; a reader with no alerts and four reminders was told they had nothing set.
  { label: "reminders", question: "what reminders do I have", scope: "reader",
    slots: { operation: "lookup", perspective: "reader" } },
  { label: "memory", question: "what do you remember about me", scope: "reader",
    slots: { operation: "lookup", perspective: "reader" } },
  { label: "relationship", question: `how much ${S.healthy} do I own`, scope: "reader",
    slots: { operation: "lookup", perspective: "reader", subjects: [S.healthy] } },
];

/** ★ THE ACTION CONTROLS. A value renders a control; nothing here writes. */
export const ACTION_CASES: readonly Case[] = [
  { label: "action · watchlist_add", question: `add ${S.healthy} to my watchlist`, scope: "reader",
    slots: { operation: "unresolved", action: "watchlist_add", perspective: "reader", subjects: [S.healthy] } },
  { label: "action · alert_create", question: `alert me when ${S.bank} drops below 1400`, scope: "reader",
    slots: { operation: "unresolved", action: "alert_create", perspective: "reader", subjects: [S.bank] } },
  // ★ T-1 finding 5 · THE PREFILLED FORM. There was no transaction case, so the form path — the only
  //   ACTION path with fields — was never built and its body never checked. It returned 400.
  { label: "action · transaction_record", question: `I bought 10 ${S.healthy} at 3200 last Tuesday`, scope: "reader",
    slots: { operation: "unresolved", action: "transaction_record", subjects: [S.healthy] } },
  { label: "action · memory_add", question: "remember that I prefer short answers", scope: "reader",
    slots: { operation: "unresolved", action: "memory_add", perspective: "reader" } },
];

/**
 * ★ MULTI-TURN — the defects a single-turn probe structurally cannot see.
 *
 * ⚠ BOTH OF STAGE 9'S SELF-INFLICTED DEFECTS LIVED HERE, and both were found over live HTTP rather
 *   than in a probe, for exactly one reason: a probe passes no prior turn, so the rule that sets a
 *   slot and the rule that fills it never met. Every chain below is a pair of rules meeting.
 */
export const CHAINS: readonly { label: string; turns: readonly string[]; scope: "market" | "reader" }[] = [
  {
    label: "chain · pronoun follow-up",
    turns: [`how is ${S.healthy} doing`, "and HDFCBANK?", "compare them"],
    scope: "market",
  },
  {
    // ⚠ THE CLARIFY-SEEDS-CONTEXT DEFECT. A turn that resolved nothing must not tell the next turn
    //   what the subject was — "how is HDFC doing" is ambiguous, and the bare ticker after it must
    //   still be treated as a bare ticker rather than inheriting an operation nobody settled.
    label: "chain · clarify then bare",
    turns: ["how is HDFC doing", S.healthy],
    scope: "market",
  },
  {
    // ⚠ THE SELF-CONTAINED DEFECT. An advice question after any other question must keep its own
    //   unresolved operation rather than inheriting the previous turn's.
    label: "chain · question then advice",
    turns: [`why did ${S.healthy} fall today?`, `should I buy ${S.healthy}?`],
    scope: "market",
  },

  // ═══ ★ T-1 · THE THREE CHAINS THAT ASSERT INHERITANCE **NOT** FIRING ═══════════════════════════
  //
  // ⚠ THIS IS THE GAP THAT LET THE T-1 BLEED SHIP, AND IT IS AS MUCH THE FINDING AS THE DEFECT WAS.
  //   Every chain above tests inheritance WORKING. Not one tested it staying out of the way, so a
  //   predicate that fired too often passed all three suites while answering three questions about
  //   the wrong company. A guard with no negative case is a guard nobody has tested.
  //
  // The invariant: **a message that names a subject never inherits one, and a screen never inherits
  // a subject at all.** Each chain below is one of the Operator's live sequences.
  {
    // ⚠ WORSE THAN A WRONG SUBJECT. Tesla is OUT OF UNIVERSE, so the honest answer is a stop —
    //   inheritance turned a correct refusal into a confident answer about SHIPROCKET. The empty
    //   resolved-subject list meant "not ours", and the old test read it as "named nothing".
    label: "chain · named-but-unresolvable must not inherit",
    turns: [`how is ${S.thin} doing`, "how is Tesla doing"],
    scope: "market",
  },
  {
    // ⚠ THE AMBIGUOUS DOOR INTO THE SAME HOLE. "how is HDFC doing" sets needsSubjectChoice AND left
    //   the resolved list empty, so the previous subject was inherited, the composer read
    //   resolvedSymbols[0], and the reader was never asked which HDFC they meant.
    label: "chain · named-but-ambiguous must not inherit",
    turns: ["how is TCS doing", "how is HDFC doing"],
    scope: "market",
  },
  {
    // ⚠ A SCREEN IS UNIVERSE-SCOPED. Three words, no company named, none needed — and it inherited
    //   RELIANCE and then `perspective: "reader"`, reporting the reader's position in it.
    label: "chain · a screen must not inherit a subject",
    turns: [`how is ${S.healthy} doing`, "find undervalued stocks"],
    scope: "market",
  },
];

/**
 * The connection ceiling the harness must stay under — see the note at the pool site.
 * ⚠ MIRRORS `src/db/prisma.ts`'s `max`. If that moves, this must; `assertPoolMatches` below is what
 *   makes the mismatch loud instead of silent.
 */
export const DB_POOL_MAX = 5;

/**
 * ★ THE MIRROR IS CHECKED, NOT TRUSTED. `DB_POOL_MAX` above is a copy of a number that lives in
 *   another file, and a copy nobody verifies is a copy that drifts — silently, back into the hang
 *   this whole mechanism exists to prevent. Reading the source is crude and it is enough: the two
 *   numbers cannot disagree without this saying so.
 */
export function poolMirrorDrift(): string | null {
  try {
    const src = readFileSync(new URL("../db/prisma.ts", import.meta.url), "utf8");
    const m = /max:\s*(\d+)/.exec(src);
    if (!m) return "could not read `max` from src/db/prisma.ts — the mirror is unverifiable";
    const real = Number(m[1]);
    return real === DB_POOL_MAX
      ? null
      : `src/db/prisma.ts caps the pool at ${real}, DB_POOL_MAX says ${DB_POOL_MAX} — update matrix.ts`;
  } catch (e) { return `could not read src/db/prisma.ts: ${(e as Error).message}`; }
}

/** How long one composition may take before the run is declared stuck. */
const CASE_TIMEOUT_MS = Number(process.env.HARNESS_CASE_TIMEOUT_MS ?? "") || 90_000;

/**
 * ★ A HANG BECOMES A FAILURE.
 *
 * ⚠ THE FIRST VERSION HAD NO TIMEOUT AND SIMPLY STOPPED — no error, no output, a log frozen
 *   mid-section for minutes while it waited on a connection that was never coming. A gate that hangs
 *   is worse than one that fails: a failure names the problem, a hang gets attributed to "the suite
 *   is slow" and then to "the suite is not worth running".
 */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const bomb = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(
        `[matrix] "${label}" did not finish in ${CASE_TIMEOUT_MS / 1000}s.\n` +
        `  The usual cause is connection starvation: the pg pool in src/db/prisma.ts is capped at ` +
        `${DB_POOL_MAX}, and a dev server holding connections alongside this run exhausts it.\n` +
        `  Stop the dev servers, or lower HARNESS_POOL (currently ${process.env.HARNESS_POOL ?? DB_POOL_MAX - 1}).`,
      )),
      CASE_TIMEOUT_MS,
    );
  });
  try { return await Promise.race([p, bomb]); } finally { clearTimeout(timer!); }
}

export interface MatrixAnswer extends AnswerUnderTest {
  /**
   * The slots this answer was DRIVEN BY, as a comparable string — what `I-DISTINCT` discriminates on.
   * Absent for lexically-routed cases, where the slots are the thing under test rather than an input.
   */
  readonly slotKey?: string;
  /** The turn result kind — `composed`, `clarify_subject`, … Asserted separately from the sections. */
  readonly kind: string;
  /** The router's own slots, so "right slots, wrong answer" is checkable (stage 9's four defects). */
  readonly slots: {
    scope: string; operation: string; lens: string | null;
    action: string | null; perspective: string; timeframe: string | null;
    subjects: readonly string[]; corrections: readonly string[];
  };
}

/** Produce one answer. Deterministic: lexical router, and the planner arm chosen by the caller. */
export async function answerFor(
  c: Case,
  reader: { userId: string } | null,
  prior: TurnContext | null = null,
): Promise<{ answer: MatrixAnswer; context: TurnContext }> {
  // ⚠ A MARKET CASE IS GIVEN NO READER, DELIBERATELY. Handing one to every case would let a
  //   market question quietly answer with the reader's book and still look fine.
  const who = c.scope === "reader" ? reader : null;
  // Slot-driven when the case is about the COMPOSITION; lexical when it is about the ROUTING.
  const classify = c.slots ? fixedClassifier(c) : lexicalClassifier;
  const turn = await route(c.question, classify, who, prior);
  const res = await composeTurn(turn, who);
  const sections = res.kind === "composed" ? res.sections : res.render.sections;
  const prose = res.kind === "composed" ? res.prose : res.render.prose;
  const r = turn.router;
  return {
    answer: {
      label: c.label,
      question: c.question,
      // ⚠ THE DECLARED slots, not the resolved ones. An inheriting follow-up ends up with the same
      //   resolved slots as the turn it inherited from — which is correct, and would make every
      //   chain look like a duplicate if the key were read off the result.
      slotKey: c.slots
        ? `op=${c.slots.operation} lens=${c.slots.lens ?? "-"} tf=${c.slots.timeframe ? `${c.slots.timeframe.kind}:${c.slots.timeframe.n}` : "-"} act=${c.slots.action ?? "-"} persp=${c.slots.perspective ?? "-"} subj=${(c.slots.subjects ?? []).join("+")}`
        : undefined,
      kind: res.kind,
      compositionId: res.kind === "composed" ? res.compositionId : res.kind,
      // ★ THE DIGEST TRAVELS TOO, FROM PHASE 2 · BATCH 1. It is the half the MODEL reads and no
      //   invariant could see it — see `AnswerUnderTest.digest`.
      sections: sections.map((s) => ({ kind: s.kind, renderer: s.renderer, payload: s.payload, digest: s.digest })),
      // ★ WHAT THE QUESTION ASKED FOR, from the router's own slot — see `AnswerUnderTest.askedPeriods`.
      askedPeriods: r.timeframe && r.timeframe.kind !== "latest" ? r.timeframe.n : null,
      prose: {
        opening: prose.opening, leads: prose.leads, after: prose.after, close: prose.close,
      },
      slots: {
        scope: r.scope, operation: r.operation, lens: r.lens, action: r.action,
        perspective: r.perspective,
        timeframe: r.timeframe ? `${r.timeframe.kind}:${r.timeframe.n ?? "?"}` : null,
        subjects: turn.subjects.map((s) => (s.kind === "stock" ? s.symbol : s.kind)),
        corrections: turn.corrections,
      },
    },
    context: turn.context,
  };
}

/**
 * Build every answer in the matrix.
 *
 * ★ `plannerless: true` PINS THE DETERMINISTIC PLANNER FOR THE WHOLE BUILD. Restored in a `finally`,
 *   because leaving `AI_PROVIDER` mutated would silently disarm every later gate in the same process.
 */
export async function buildMatrix(
  reader: { userId: string } | null,
  opts: { plannerless: boolean },
): Promise<MatrixAnswer[]> {
  // ★ T-0b · EVERY TURN THE MATRIX DRIVES IS A HARNESS TURN, AND THE ROWS MUST SAY SO.
  //
  //   The matrix composes real turns, so it writes real miss-log rows. T-0's first live day: 4 of the
  //   7 rows in `composition_misses` came from here, all asking "TCS" through the lexical classifier
  //   — which made ONE genuine reader ask read as five.
  //
  //   The rows are KEPT, never skipped. A log that behaves differently under test is a log that lies,
  //   and it would lie in exactly the environment where someone is checking that it works. They are
  //   stamped instead, and `miss-log-report.ts` / `/admin/miss-log` exclude them at READ time while
  //   still printing how many were excluded.
  //
  //   Set HERE rather than in the calling gate so that a future consumer of `buildMatrix` inherits it
  //   without having to know. It is process-wide and never reset: a process that has built the matrix
  //   is a harness process for the rest of its life.
  setMissLogOrigin("harness");

  const saved = process.env.AI_PROVIDER;
  if (opts.plannerless) process.env.AI_PROVIDER = "mock";
  try {
    const out: MatrixAnswer[] = [];
    const single = [...MARKET_CASES, ...(reader ? [...READER_CASES, ...ACTION_CASES] : [])];

    // ★ THE SINGLE-TURN CASES RUN CONCURRENTLY, AND THE WIDTH IS BOUNDED BY THE CONNECTION POOL.
    //
    //   Serially this took 210 seconds per arm — seven minutes for both, and a suite that slow gets
    //   moved out of the build and then out of the habit. Every case is an independent read, so the
    //   wall clock was almost entirely round-trip latency rather than work.
    //
    // ⚠ FOUR, BECAUSE `src/db/prisma.ts` CAPS THE PG POOL AT FIVE. The first version used six and
    //   HUNG — not failed, hung. Each case issues several queries, so six concurrent cases want more
    //   connections than exist; they queue, and with a dev server holding connections too the run
    //   stops making progress with no error to read. Concurrency above the pool size was never a
    //   speedup in the first place, only a queue with extra steps.
    //
    //   Deriving it rather than hardcoding it means the two cannot drift apart: raise the pool and
    //   this follows, which is the failure mode that would otherwise return silently.
    const POOL = Number(process.env.HARNESS_POOL ?? "") || Math.max(1, DB_POOL_MAX - 1);
    for (let i = 0; i < single.length; i += POOL) {
      const batch = await Promise.all(
        single.slice(i, i + POOL).map((c) => withTimeout(answerFor(c, reader), c.label)),
      );
      for (const r of batch) out.push(r.answer);
    }

    // ⚠ THE CHAINS STAY SEQUENTIAL, AND THEY MUST. Each turn is an INPUT to the next — that is the
    //   entire property they exist to test. Parallelising them would test three unrelated first turns.
    for (const chain of CHAINS) {
      let ctx: TurnContext | null = null;
      for (const [i, q] of chain.turns.entries()) {
        // Annotated because `ctx` feeds back into the call that produces it — TypeScript cannot
        // infer through that cycle on its own.
        const r: { answer: MatrixAnswer; context: TurnContext } = await withTimeout(answerFor(
          { label: `${chain.label} [${i}] "${q}"`, question: q, scope: chain.scope },
          reader, ctx,
        ), `${chain.label} [${i}]`);
        out.push(r.answer);
        // ⚠ THE CONTEXT ONLY CARRIES FORWARD FROM AN ANSWERED TURN — the same rule the controller
        //   applies. A harness that carried it from a clarify turn would be testing a path that
        //   production does not take.
        ctx = r.answer.kind === "composed" ? r.context : null;
      }
    }
    return out;
  } finally {
    if (saved === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = saved;
  }
}

/**
 * ★ THE POPULATION FLOORS (§9.3, and stage 4's Gate 1).
 *
 * A suite asserting universals over an empty set passes green and tests nothing. These are concrete
 * numbers rather than `> 0` for the reason stage 8b already recorded: a matrix that collapses from
 * thirty answers to one is broken in a way `length > 0` cannot see.
 *
 * ⚠ THROWS. A warning here would be a warning nobody reads on a run that reports success.
 */
export function assertPopulated(answers: readonly MatrixAnswer[], hasReader: boolean): void {
  const MIN_ANSWERS = hasReader ? 24 : 18;
  const MIN_SECTIONS = 60;
  const MIN_COMPOSED = 14;
  const sections = answers.reduce((a, x) => a + x.sections.length, 0);
  const composed = answers.filter((a) => a.kind === "composed").length;
  const problems: string[] = [];
  if (answers.length < MIN_ANSWERS) problems.push(`${answers.length} answers, floor is ${MIN_ANSWERS}`);
  if (sections < MIN_SECTIONS) problems.push(`${sections} sections, floor is ${MIN_SECTIONS}`);
  if (composed < MIN_COMPOSED) problems.push(`${composed} composed answers, floor is ${MIN_COMPOSED}`);
  // A matrix where nothing carries a set cannot exercise the reconciliation invariant at all.
  const withSets = answers.filter((a) => a.sections.some((s) => Array.isArray((s.payload as Record<string, unknown>)?.members))).length;
  if (hasReader && withSets < 2) problems.push(`${withSets} answers carry a member set, floor is 2 — I-SET-RECONCILES is unexercised`);
  if (problems.length) {
    throw new Error(
      `[matrix] EMPTY OR COLLAPSED MATRIX — these invariants would have passed on nothing.\n` +
      problems.map((p) => `  · ${p}`).join("\n") +
      `\nFix the matrix, never the floor (§9.3).`,
    );
  }
  console.log(
    `  matrix: ${answers.length} answers · ${composed} composed · ${sections} sections · ` +
    `${withSets} carrying a member set  [populated ✓]`,
  );
}
