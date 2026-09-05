// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: F · FUNDAMENTALS — the filed figures. Revenue, margins, the balance sheet, the cash flow.
//
// ── ★★ THE ONE THING THIS FAMILY MUST DO, AND THE MEASUREMENT THAT MAKES IT UNSAFE NOT TO ─────────
// **IT STATES THE BASIS.** Re-measured this batch: 1,492 of 2,175 non-financial stocks file BOTH
// standalone and consolidated results, across 15,932 stock-periods. Consolidated-only is zero.
//
// ⚠ AND THE PRODUCT DOES NOT PICK ONE UNIFORMLY, WHICH IS WHAT TURNS AN OMISSION INTO A HAZARD.
//   `chooseBasis` prefers a per-family default, so measured live: **TCS resolves consolidated and
//   HDFCBANK resolves standalone.** Two answers in one session, on two different sets of books, and
//   nothing on screen to tell them apart. A reader who checks our revenue figure against one they
//   found elsewhere has no way to know whether a mismatch is our error or a different basis.
//
// So the basis is stated in FOUR places, and each one is load-bearing for a different reader:
//
//   · the OPENING PROSE          — someone who reads only the sentences (§4.3's own test) gets it
//   · the statement PAYLOAD      — it is on the component, beside the figures it bounds
//   · the statement DIGEST       — first group, before any figure, so the model cannot write a
//                                  sentence about a number whose basis it did not know to name
//   · the CONCLUSION             — because the conclusion is what gets quoted back
//
// One home for the sentence itself (`basisSentence`), so those four cannot phrase it differently.
//
// ── ★ WHY THIS IS ONE COMPOSITION AND OA IS FOUR ──────────────────────────────────────────────────
// F's four statement questions — the P&L, the balance sheet, the cash flow, the returns — read the
// SAME filing and produce the SAME section sequence with different rows in the table. That is a
// parameter (`StatementFocus`), and splitting it into four compositions would be building the variant
// §4.1 warns about, one layer up. OA's four read four different tables and produce four different
// sequences, so they are four answers. The test was run in both directions and gave different answers,
// which is the only reason to trust either.
//
// ── ★★ THE DEPTH FLOOR APPLIES HERE, AND IT IS THE ANNUAL AXIS THAT IS THIN ───────────────────────
// Measured across all five annual tables: median 2 years · 1,644 stocks at exactly 2 · 134 at 1 ·
// nothing above 9. Eligibility at a 5-year floor is **425 stocks**; the quarterly sibling at 8
// quarters is **1,868**. So a balance-sheet answer and a revenue answer look like the same question
// and have universes 4.4× apart. The composition does not pretend otherwise: the P&L runs quarterly,
// the other three run annual, and the answer says how many periods it actually got.
//
// ⚠ AND THE FLOOR IS NOT IN THE PREDICATE, DELIBERATELY. `Predicate.depthFloor` counts QUARTERS, and
//   the constraint here is YEARS on three of the four focuses. A predicate cannot see which focus a
//   question has (that is code-extracted from the sentence), so a quarters floor would gate the
//   annual answers on the wrong axis. It is enforced where §5 says data-dependent gating belongs —
//   inside the build, which renders the honest short answer rather than declining the turn.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scoreQuestion } from "../../router/question-shape.js";
import {
  FAMILY_PHRASE, resolveStatements, statementFocus, statementWindow,
  type StatementFocus, type StatementRead, type StatementWindow,
} from "../../resolve/statements.js";
import { resolveCompanySnapshot } from "../../resolve/company-snapshot.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { anchorSection } from "../../section/kinds/anchor.js";
import { basisSentence, statementTableSection, type StatementCell, type StatementGroup } from "../../section/kinds/statement-table.js";
import { relativeSection, type RelativeMark } from "../../section/kinds/relative.js";
import { calloutSection } from "../../section/kinds/callout.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import { reasonPhrase } from "../../relational/coverage.js";
import { buildAnswer, SHAPE_ASSERTIONS, type Block } from "../answer.js";
import { stockCoverage } from "../../resolve/contract.js";
import type { AnySection, Composition } from "../contract.js";

// ── FORMATTERS. One home per unit, so a figure cannot be spoken two ways down one column (N-5). ────
//
// ⚠ SCALE-AWARE MONEY, AND `blocks.ts#money` IS WHY. A single crore formatter that rounds to whole
//   crore printed "₹0 Cr" for every position in a real book; the same formatter asked to span a
//   ₹1.4 lakh-crore revenue line and a ₹3 crore premium-deficiency reserve has the same problem in
//   the other direction. The unit follows the number.
const cr = (v: number): string => {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  const n = (x: number, dp: number) => x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (a === 0) return "₹0 Cr";
  if (a >= 100000) return `${sign}₹${n(a / 100000, 2)} lakh Cr`;
  if (a >= 100) return `${sign}₹${Math.round(a).toLocaleString("en-IN")} Cr`;
  return `${sign}₹${n(a, 2)} Cr`;
};
const fmt = (v: number, unit: "cr" | "pct" | "x" | "inr"): string =>
  unit === "cr" ? cr(v)
  : unit === "pct" ? `${v.toFixed(2)}%`
  : unit === "x" ? `${v.toFixed(2)}×`
  : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** What a reader sees where a line was not reported. Authored, never a dash (N-4). */
const NOT_FILED = blockCopy("quarters_not_reported");

/** The resolver's rows, formatted into the renderer's cells. The only place a figure becomes text. */
function toGroups(d: StatementRead): StatementGroup[] {
  return d.groups.map((g) => ({
    label: g.label,
    note: g.note,
    lines: g.lines.map((l) => ({
      key: l.key,
      label: l.label,
      unit: l.unit,
      role: l.role,
      cells: l.cells.map((c): StatementCell =>
        c.filed && c.value !== null
          ? { display: fmt(c.value, l.unit), value: c.value, filed: true }
          : { display: NOT_FILED, value: null, filed: false },
      ),
    })),
  }));
}

const FOCUS_HEADING: Record<StatementFocus, string> = {
  pnl: "What it earned, quarter by quarter",
  balance_sheet: "What it owns and what it owes",
  cash_flow: "What the profit turned into",
  returns: "What it earns on what it uses",
};

/** The lead sentence before the table — says what is coming AND why the cadence is what it is. */
const FOCUS_LEAD: Record<StatementFocus, string> = {
  pnl: "The profit and loss account as filed, one column per quarter, oldest on the left.",
  balance_sheet:
    "The balance sheet as filed. This one is annual — a balance sheet is struck at the year end, " +
    "so there are fewer columns here than on the quarterly lines above.",
  cash_flow:
    "The cash-flow statement as filed, annually. Profit is an accounting figure and cash is not, " +
    "so the net-profit line is repeated at the bottom for the comparison that matters.",
  returns:
    "The return and efficiency ratios as filed, annually — each one is a full-year figure, not an " +
    "annualised quarter.",
};

/**
 * ★ THE ONE SENTENCE THAT SAYS HOW MUCH HISTORY THIS ANSWER ACTUALLY HAS, and it is required rather
 *   than nice: see the header's 425-against-1,868 measurement. A three-column table and a
 *   nine-column table are different answers and look alike from a distance.
 */
function depthSentence(d: StatementRead): string {
  const n = d.periods.length;
  const word = d.cadence === "quarterly" ? (n === 1 ? "quarter" : "quarters") : (n === 1 ? "financial year" : "financial years");
  // ★★ THE SHORTFALL IS STATED FIRST WHERE THERE IS ONE (§3.3 — resolved, never as-requested). A
  //    reader who asked for ten years and silently received two has been answered with a different
  //    question, and nothing on screen would tell them. Measured: the annual axis holds at most 9
  //    years anywhere in this universe, and a median of 2.
  if (d.asked !== null && d.asked > d.heldAtCadence) {
    return `You asked for ${d.asked} ${d.cadence === "quarterly" ? "quarters" : "years"} and we hold ${d.heldAtCadence}` +
      `${d.cadence === "annual" ? " — nothing in our coverage reaches past nine annual years" : ""}. ` +
      `The ${n} ${word} below are what there is.`;
  }
  if (d.cadence === "annual") {
    return n <= 2
      ? `That is ${n} ${word} — which is the median for this universe rather than a gap in this company: ` +
        `annual filings only reach back to ${d.periods[0]} for most of what we cover, and nothing anywhere reaches past nine years.`
      : `That is ${n} ${word}, ${d.periods[0]} to ${d.periods[n - 1]} — deeper than most, since fewer than a fifth of the companies we cover file five or more years with us.`;
  }
  return n >= 8
    ? `That is ${n} ${word}, ${d.periods[0]} to ${d.periods[n - 1]}.`
    : `That is ${n} ${word} — all we hold, so there is less here than a full two-year read.`;
}

async function buildFundamentals(
  symbol: string,
  focus: StatementFocus,
  window: StatementWindow,
  /** The operation that routed here. `decompose` is a reader asking what the figures MEAN. */
  ctxOperation: string,
  /**
   * ★★ THE BROAD QUESTION GETS A SECOND STATEMENT, AND THE HARNESS IS WHY IT NOW DOES.
   *
   * ⚠ "tell me about TCS financials" (`orient`, no statement named) AND "what is TCS revenue"
   *   (`lookup`, names the P&L) produced ONE byte-identical answer — `I-DISTINCT`, caught in this
   *   batch's own run. They are not the same question: the second asks for a line, the first asks to
   *   be oriented on the financials, and a quarterly P&L alone is a thin answer to the second.
   *
   * ★ TWO SECTIONS RATHER THAN TWO GROUPS IN ONE TABLE, and the reason is the columns. A statement
   *   table's periods are shared by every group in it, and the P&L is quarterly while the ratios are
   *   annual — putting them in one table would either mislabel one set of columns or force the P&L
   *   onto the annual axis, which is the narrow question's answer rather than the broad one's.
   */
  alsoReturns = false,
) {
  const [cov, snap, st, extra] = await Promise.all([
    resolveStockCoverage(symbol),
    resolveCompanySnapshot(symbol),
    resolveStatements(symbol, focus, window),
    // ⚠ ONLY WHEN ASKED FOR. A second resolve on every fundamentals turn would double the cost of the
    //   commonest question in the family to serve the less common one.
    alsoReturns
      ? resolveStatements(symbol, "returns", { cadence: "annual", asked: null })
      : Promise.resolve(null),
  ]);
  const d = st.ok ? st.data : null;
  // The broad question's second statement, when one was asked for and resolved.
  const e = extra !== null && extra.ok ? extra.data : null;
  const sc = stockCoverage(cov.coverage);
  const tier = sc?.tier ?? 0;

  // ── THE BASIS SENTENCE. One home, four destinations — see the header. ─────────────────────────
  const basis = d
    ? { read: d.basisRead, available: d.basisAvailable, sentence: basisSentence(d.basisRead, d.basisAvailable) }
    : null;

  // ═══ OPENING — THE ANSWER, IN SENTENCES, FOR A READER WHO STOPS HERE ══════════════════════════
  const opening: string[] = [];
  if (d) {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ A "WHY" OPENS WITH THE FIGURES, NOT WITH THE FILING BASIS — MT · Phase 3.
    //
    // ⚠ `I-DISTINCT` CAUGHT THIS THE HOUR IT WAS INTRODUCED. Adding `decompose` to this family's
    //   predicate fixed the routing — a bare "why" after a fundamentals answer stopped falling to the
    //   planner — and produced an answer BYTE-IDENTICAL to the plain lens question. Same subject,
    //   same lens, same evidence, and the family had no way to tell the two apart.
    //
    // ★ THE EVIDENCE IS RIGHTLY THE SAME; THE ORDER IS NOT. A reader who asked "why" has already been
    //   shown the table and is asking what it means, so the movement leads and the filing basis —
    //   which they have just read — follows. Same lever as `trajectoryLead`, `attributionLead` and
    //   `peerLead`: prose order only, never a different fact.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const explaining = ctxOperation === "decompose";
    const basisSentence =
      `${snap.ok ? snap.data.name : symbol} files as ${FAMILY_PHRASE[d.family]}, so the line items below ` +
      `are that industry's rather than a generic set. ${basis!.sentence}`;
    // The headline figure, in words, from the snapshot rather than re-derived off the table.
    const figureSentence = (() => {
      if (focus === "pnl" && snap.ok && snap.data.latest?.revenue != null) {
        const q = snap.data.latest;
        return `In ${q.periodKey} it reported revenue of ${cr(q.revenue!)}` +
          `${q.revenueYoyPct != null ? `, ${q.revenueYoyPct > 0 ? "up" : "down"} ${Math.abs(q.revenueYoyPct).toFixed(1)}% against the same quarter a year earlier` : ""}` +
          `${q.operatingMargin != null ? `, on an operating margin of ${q.operatingMargin.toFixed(1)}%` : ""}.`;
      }
      if (focus === "returns" && snap.ok && snap.data.annual?.roe != null) {
        const a = snap.data.annual;
        return `Across ${a.fiscalYear} it returned ${a.roe!.toFixed(1)}% on equity` +
          `${a.roce != null ? ` and ${a.roce.toFixed(1)}% on capital employed` : ""}` +
          `${a.debtToEquity === 0 ? ", carrying no debt against equity" : ""}.`;
      }
      return null;
    })();

    // ⚠ THE FIRST VERSION OF THIS REORDER PUT THE DEPTH SENTENCE FIRST — "That is 8 quarters, FY25Q2
    //   to FY27Q1" — which is the weakest sentence in the set opening an answer to "why". Reading the
    //   output is what caught it. The figure leads or nothing does.
    for (const sentence of explaining
      ? [figureSentence, depthSentence(d), basisSentence]
      : [basisSentence, depthSentence(d), figureSentence]) {
      if (sentence) opening.push(sentence);
    }
  } else {
    // ★ THE ABSENT OPENING NAMES WHICH AXIS IS SHORT, and that is the whole value of splitting the
    //   cadence. MANIPALHOS (measured: 1 quarter, 0 annual years) can answer a revenue question and
    //   cannot answer a balance-sheet one — "we hold no financials" would be false about the first.
    const phrase = st.ok ? "" : reasonPhrase(st.absent.reason);
    opening.push(
      focus === "pnl"
        ? `We hold no quarterly profit-and-loss filings for ${symbol}. That needs ${phrase}.`
        : `We hold no annual accounts for ${symbol}, so there is no ${focus === "balance_sheet" ? "balance sheet" : focus === "cash_flow" ? "cash-flow statement" : "set of full-year ratios"} to show. That needs ${phrase}.`,
    );
    if (sc && sc.depth.quarters > 0 && focus !== "pnl") {
      // ⚠ THE OTHER HALF OF THE ABSENCE. A reader told "no annual accounts" while we hold 32 quarters
      //   of results will conclude we hold nothing. Naming what we DO hold is what stops that.
      opening.push(
        `We do hold ${sc.depth.quarters} ${sc.depth.quarters === 1 ? "quarter" : "quarters"} of quarterly results for it — ` +
        `the quarterly lines are answerable, the annual statement is not yet.`,
      );
    }
  }

  // ═══ THE RELATIVE SECTION — the headline line against ITS OWN filed history ════════════════════
  //
  // ★ AGAINST ITSELF, NOT AGAINST PEERS, AND THAT IS THE HONEST REFERENCE HERE. A margin against a
  //   peer average needs a peer group with data (`score_peer_stats` / `stock_peer_groups` — T-9's
  //   subject, and not settled); a margin against its own eight filed quarters needs only this
  //   company's own filings, which is exactly what we just read. `own-history-band`'s reference is
  //   `referenceCount` filings of itself.
  //
  // ⚠ AND IT IS DROPPED UNDER TWO PERIODS. `relativeSection`'s own guard would empty the marks, and a
  //   band drawn against one observation is the stock compared with itself.
  const headline = d?.groups[0]?.lines.find((l) => l.role === "total")
    ?? d?.groups[0]?.lines.find((l) => l.role === "subtotal")
    ?? d?.groups[0]?.lines[0]
    ?? null;
  let historyBand: AnySection | null = null;
  if (d && headline && d.periods.length >= 2) {
    const filed = headline.cells
      .map((c, i) => (c.filed && c.value !== null ? { at: d.periods[i]!, value: c.value } : null))
      .filter((x): x is { at: string; value: number } => x !== null);
    if (filed.length >= 2) {
      const latest = filed[filed.length - 1]!;
      const lo = filed.reduce((a, b) => (b.value < a.value ? b : a));
      const hi = filed.reduce((a, b) => (b.value > a.value ? b : a));
      const marks: RelativeMark[] = [
        { label: `${headline.label} now (${latest.at})`, value: latest.value, display: fmt(latest.value, headline.unit), role: "subject" },
        { label: `lowest filed (${lo.at})`, value: lo.value, display: fmt(lo.value, headline.unit), role: "reference" },
        { label: `highest filed (${hi.at})`, value: hi.value, display: fmt(hi.value, headline.unit), role: "reference" },
      ];
      historyBand = relativeSection({
        renderer: "own-history-band",
        heading: `${headline.label} against its own filed range`,
        unit: headline.unit === "cr" || headline.unit === "inr" ? "cr" : headline.unit === "x" ? "x" : "pct",
        marks,
        referenceLabel: `its own ${filed.length} filed ${d.cadence === "quarterly" ? "quarters" : "years"}`,
        referenceCount: filed.length,
        windowLabel: `${filed[0]!.at} to ${latest.at}`,
      }, cov.coverage) as AnySection;
    }
  }

  const blocks: Block[] = [
    {
      lead: "What the business is, and the headline figures from the period it last reported.",
      section: snap.ok ? (anchorSection(snap) as AnySection) : null,
    },
    {
      // ⚠ THE P&L LEAD NAMES THE CADENCE IT ACTUALLY GOT. `FOCUS_LEAD.pnl` says "one column per
      //   quarter", which is false once a trend question has put the P&L on the annual axis — and a
      //   lead sentence describing a table the reader is looking at is the one place a mismatch is
      //   immediately visible.
      lead: !d ? ""
        : focus === "pnl" && d.cadence === "annual"
          ? "The profit and loss account as filed, one column per financial year — a trend question is a question about years, so these are the annual lines rather than the quarterly ones."
          : FOCUS_LEAD[focus],
      // ★ THE BASIS RIDES ON THE COMPONENT ITSELF. A reader who scrolls past the prose straight to the
      //   table still sees which set of books it is.
      after: d && d.basisAvailable.length > 1
        ? `Every figure in that table is on the ${d.basisRead} basis. The ${d.basisRead === "consolidated" ? "standalone" : "consolidated"} filings for the same periods are a different set of numbers, and this answer has not read them.`
        : undefined,
      section: d
        ? (statementTableSection({
            heading: FOCUS_HEADING[focus],
            periods: d.periods,
            cadence: d.cadence,
            groups: toGroups(d),
            basis: basis!,
            familyLabel: d.familyLabel,
            emptyPhrase: d.cadence === "annual" ? blockCopy("annual_none") : blockCopy("quarters_none"),
          }, cov.coverage) as AnySection)
        : null,
    },
    {
      // ★ THE SECOND STATEMENT, ON THE BROAD QUESTION ONLY. Annual, because that is when a return
      //   ratio is struck — so it carries its own columns and its own basis sentence.
      lead: e
        ? "And what those figures come to over a full year — the returns and margins as filed, annually."
        : "",
      section: e
        ? (statementTableSection({
            heading: FOCUS_HEADING.returns,
            periods: e.periods,
            cadence: e.cadence,
            groups: toGroups(e),
            basis: { read: e.basisRead, available: e.basisAvailable, sentence: basisSentence(e.basisRead, e.basisAvailable) },
            familyLabel: e.familyLabel,
            emptyPhrase: blockCopy("annual_none"),
          }, cov.coverage) as AnySection)
        : null,
    },
    {
      lead: headline
        ? `And where the latest ${headline.label.toLowerCase()} sits inside everything this company has filed.`
        : "",
      section: historyBand,
    },
    {
      lead: "Separately, everything code checks against these filings — whether or not it found anything.",
      section: calloutSection(
        `${symbol}'s filed accounts for anything that needed raising`, [], cov.coverage, "findings",
      ) as AnySection,
    },
  ];

  // ═══ CONCLUSION — THE SYNTHESIS, AND THE BASIS AGAIN BECAUSE THIS IS WHAT GETS QUOTED ═════════
  const bits: string[] = [];
  if (d) {
    const totalLine = d.groups[0]?.lines.find((l) => l.role === "total");
    const latestFiled = totalLine?.cells[d.periods.length - 1];
    if (totalLine && latestFiled?.filed && latestFiled.value !== null) {
      bits.push(`${totalLine.label.toLowerCase()} of ${fmt(latestFiled.value, totalLine.unit)} in ${d.periods[d.periods.length - 1]}`);
    }
    const shortAnnual = d.cadence === "annual" && d.periods.length <= 2;
    if (shortAnnual) bits.push(`a ${d.periods.length}-year annual read — ${blockCopy("annual_thin")}`);
  }
  // ⚠ ITS OWN SENTENCE, NOT ANOTHER COMMA-SEPARATED CLAUSE. Appended to `bits` it produced "In short:
  //   total equity of ₹1.17 lakh Cr in FY26, we hold these filings and do not score this company, so
  //   there is no health reading behind the figures." — a comma splice joining a figure to a coverage
  //   statement, which is two different kinds of claim in one breath. Caught live on BAJFINANCE.
  //
  // ★ AND IT IS STATED AT ALL BECAUSE THE FIGURES LOOK IDENTICAL EITHER WAY. All 142 NBFCs, 5 life
  //   insurers and 6 general insurers are tier 1 — we hold their filings and score none of them — so
  //   an answer full of real figures reads as a scored company unless it says otherwise.
  const unscoredNote = d && tier < 2 ? ` These are ${blockCopy("statement_unscored")}.` : "";
  const conclusion = d
    ? `In short: ${bits.length ? bits.join(", ") : "the filings as they stand"}.${unscoredNote} ` +
      `${basis!.sentence} These are figures the company filed, not our reading of them — ` +
      `nothing above is a forecast.`
    : `We cannot answer that from what we hold on ${symbol} today. That is a gap in our coverage, not a statement about the company.`;

  const margin = snap.ok ? snap.data.metrics.find((m) => m.label === "Operating margin") : undefined;

  const built = buildAnswer({
    coverage: cov.coverage,
    opening,
    blocks,
    conclusion,
    symbol,
    signals: {
      scored: tier === 2,
      findings: [],
      // ⚠ PLEDGING IS NOT THIS FAMILY'S TO CLAIM AND IS NEVER TRUE HERE. See resolve/pledge.ts: the
      //   old `(pledgedPctOfPromoter ?? 0) > 0` signal was reading a column measured to be
      //   unreliable, and a chip offering a pledge figure promises what we decline to state.
      pledged: false,
      instSold: (snap.ok ? snap.data.shareholding?.instDeltaPp ?? 0 : 0) < -0.25,
      thin: d ? (d.cadence === "annual" ? d.periods.length < 3 : d.periods.length < 8) : true,
      marginFell: (margin?.qoqPct ?? 0) < -2,
    },
  });

  // ★ WHICH STATEMENT THIS ANSWER WAS — so the split is measurable. See ComposedAnswer.variantId.
  return { ...built, variantId: `fundamentals.${alsoReturns ? "overview" : focus}` };
}

export const fundamentals: Composition = {
  id: "fundamentals.statements",
  family: "fundamentals",
  // ★ THE THREE OPERATIONS A FILED-FIGURES QUESTION ARRIVES UNDER, and `lens: ["fundamentals"]` is
  //   what keeps it off the un-narrowed question — `orientation.company` owns `lens: null` and
  //   answers the whole company, of which these figures are one section.
  //
  // ⚠ `minTier: 1` IS LOAD-BEARING AND IT IS WHY THE THIN FIXTURE HAD TO CHANGE. A tier-0 stock has
  //   no quarterly row in ANY of the five tables, so every statement here would be absent and the
  //   answer would be four sentences of apology. Tier 0 falls through to the planner, which reads the
  //   same manifest and will not plan blocks the subject cannot fill. (The harness's old thin subject
  //   MOLBIO is tier 0 — measured — so it could never have reached this family: see fixtures.ts.)
  /**
   * ⚠ `decompose` ADDED AT PHASE 3 — MT · MULTI-TURN. A bare "why" after this family's answer arrives
   *   as `decompose` (the router's own word map: "why" states its operation) with THIS LENS carried
   *   from the previous turn. Measured before this: `decompose + fundamentals` was claimed by nothing, so the
   *   follow-up fell to the deterministic planner and the reader got a whole-company page instead of
   *   the explanation they asked for.
   *
   * ★ THE LENS IS WHAT MAKES IT SAFE. `decompose` alone is an enormous class; `decompose` narrowed to
   *   fundamentals is this family's question by definition.
   */
  when: {
    operation: ["orient", "lookup", "history", "decompose"], lens: ["fundamentals"], subject: "required", minTier: 1,
    /**
     * ★ THE SENTENCE GUARD — AND IT EXISTS ONLY BECAUSE OF `decompose`, WHICH THIS BATCH ADDED.
     *
     * ⚠ CAUGHT BY `verify:ux` AS A REGRESSION, NOT BY REASONING. `U12 · the shortfall walk rendered`
     *   went red — "no shortfall section found — the A renderer is UNEXERCISED in the browser" —
     *   because "why is INDUSINDBK SCORED the way it is" reached the live router, came back with a
     *   `fundamentals` lens, and this family answered a question about the score with a P&L table.
     *
     * ★ NO SLOT TEST COULD HAVE SEPARATED THEM. Attribution claims `lens: ["health"]` and this family
     *   claims `lens: ["fundamentals"]`; they never overlap, so the lens was simply WRONG, and the one
     *   thing that is never wrong is that a reader who typed "scored" is asking about the score.
     *
     * ⚠ IT NARROWS `decompose` AND NOTHING ELSE. The other three operations are what they were before
     *   this batch, and a guard that also fenced them would be fixing a bug nobody has reported by
     *   changing behaviour nobody asked about.
     */
    question: (raw, router) => router.operation !== "decompose" || !scoreQuestion(raw),
  },

  // ★ EXAMPLES FEED THE ROUTER AND THE EVAL (§5.2). Deliberately spread across all four focuses and
  //   both cadences, because an example set that only exercises the default focus teaches the router
  //   one shape and leaves the other three untested in the same commit that adds them.
  examples: [
    "what is TCS revenue",
    "how are RELIANCE margins",
    "show me INFY financials",
    "what does HDFCBANK earn on equity",
    "how much debt does TATAMOTORS carry",
    "what is LT balance sheet like",
    "does ITC convert profit into cash",
    "what is TCS free cash flow",
    "what is ASIANPAINT return on capital",
    "how has BAJFINANCE net interest income moved",
  ],
  build: async (ctx) => {
    // ★ THE FOCUS COMES FROM THE SENTENCE AND THE WINDOW FROM THE SLOTS, and both are needed. The
    //   focus decides WHICH statement; the window decides at what cadence and how far back — and
    //   ignoring the second is what made "what is TCS's revenue trend" and "what is TCS revenue"
    //   one answer (I-DISTINCT, caught in this batch's own harness run).
    const { focus, explicit } = statementFocus(ctx.turn.raw);
    // ★ BROAD = the reader narrowed to the fundamentals lens and named no statement inside it. That
    //   is "show me the financials", and it gets the P&L AND the full-year returns.
    const broad = !explicit;
    return buildFundamentals(
      ctx.symbol!, focus,
      statementWindow(focus, ctx.turn.router.operation, ctx.turn.router.timeframe),
      ctx.turn.router.operation,
      broad,
    );
  },
  assertions: [
    ...SHAPE_ASSERTIONS,
    {
      // ★★ THE FAMILY'S OWN CONSTRAINT, AS AN ASSERTION IN ITS OWN FILE (§5.2). If this ever fails,
      //    the answer has become unsafe in exactly the way the header describes — and it fails in the
      //    commit that broke it rather than in a design review.
      name: "a filed statement always names the basis it was read on",
      check: (s) => {
        const t = s.find((x) => x.renderer === "statement-table");
        if (!t) return null; // an answer with no statement makes no basis claim to get wrong
        const p = t.payload as { basis?: { read?: string; sentence?: string } } | null;
        if (!p?.basis?.read) return "statement-table carries no basis";
        if (!p.basis.sentence || p.basis.sentence.length < 20) return "statement-table's basis has no reader sentence";
        const inDigest = t.digest.groups.some((g) => g.lines.some((l) => l.label === "Basis"));
        return inDigest ? null : "the basis is on the payload but not in the digest — the model cannot see it";
      },
    },
    {
      name: "the statement's columns are periods, and they are not offered as sortable",
      check: (s) => {
        const t = s.find((x) => x.renderer === "statement-table");
        if (!t) return null;
        return t.interactions.some((i) => i.kind === "sort")
          ? "statement-table offers a sort — a statement sorted by year is not a statement"
          : null;
      },
    },
    {
      name: "no statement row is empty in every period",
      check: (s) => {
        const t = s.find((x) => x.renderer === "statement-table");
        if (!t) return null;
        const p = t.payload as { groups?: { lines?: { label: string; cells: { filed: boolean }[] }[] }[] } | null;
        const dead = (p?.groups ?? []).flatMap((g) => (g.lines ?? []).filter((l) => l.cells.every((c) => !c.filed)));
        return dead.length === 0
          ? null
          : `${dead.map((d) => d.label).join(", ")} filed in no period — a row of dashes reads as a broken component`;
      },
    },
  ],
};
