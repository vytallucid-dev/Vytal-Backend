// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: OA · OWNERSHIP — who owns it, what has moved, who has been dealing, and what is pledged.
//
// ── ★★ WHAT THIS FILE REPLACES, AND WHY THE OLD ONE COULD NOT BE PATCHED ──────────────────────────
// `ownership.register` recorded the T08 misroute as a finding it could not fix:
//
//   > "THE PREDICATE CANNOT FIX THIS, AND THAT IS THE FINDING. `lens: "ownership"` covers FOUR
//   >  distinct answers — the register, block/bulk deals, insider disclosures, and pledging — and the
//   >  slot vocabulary has one word for all of them."
//
// Its response was to drop `lookup` from its own predicate, so every `lookup + ownership` question
// went to the planner. That gave up a guaranteed shape on the commonest phrasings — "who owns TCS",
// "has FII holding changed" — to avoid answering the insider question with a register. Correct trade,
// still a gap, and its own comment named the real fix. This is the real fix.
//
// ★ FOUR ANSWERS, CHOSEN BY A CODE-EXTRACTED FOCUS, AND THE SEQUENCES ARE GENUINELY DIFFERENT:
//
//   register   COVERAGE · DECOMPOSITION ownership-split · [pillar] · CALLOUT · NEXT
//   flow       COVERAGE · SERIES stepped-filing-line   · RELATIVE own-history-band · CALLOUT · NEXT
//   dealing    COVERAGE · RAIL filing-rail             · DECOMPOSITION ownership-split · CALLOUT · NEXT
//   pledging   COVERAGE · [no component at all]        · DECOMPOSITION ownership-split · CALLOUT · NEXT
//
// ⚠ THE FOURTH HAS NO COMPONENT ON PURPOSE, AND THAT IS THE POINT OF ADMITTING IT AS AN ANSWER. A
//   pledge question deserves a real reply — "we cannot state this, and here is why" — not a register
//   drawn where the reader asked for a number. §4.5 rule 2: empty means a sentence, not an empty card.
//
// ⚠ AND THE FIFTH IS SUBJECTLESS. See `ownershipMovers` at the bottom — the miss-log row.
//
// ── ★★ PLEDGING: NO FIGURE LEAVES THIS FAMILY ─────────────────────────────────────────────────────
// Every pledge sentence in this file comes from `resolve/pledge.ts`, which holds the measurement:
// 87.2% of 25,168 rows carry `pledged_shares = 0` with **zero** NULLs; 1,555 rows report a positive
// pledge percentage against zero pledged shares; and — the finding this batch adds — of the 3,205
// rows where both columns are positive, only 891 agree within half a point and 2,007 are more than
// five points apart. There is no derivation of a pledge magnitude this data supports.
//
// ── ★★ STEPPED, NEVER INTERPOLATED ────────────────────────────────────────────────────────────────
// A holding changes at a filing date. Between two filings nothing is true, so a line sloping from one
// to the next asserts a path nobody filed — the small lie that makes the chart prettier and the data
// worse. `SERIES:stepped-filing-line` exists for exactly this and steps by construction; the flow
// answer uses it rather than `value-line` or `composite-spine`, both of which draw continuous
// quantities. `I-STEPPED` in the harness asserts the choice so it cannot be undone by accident.
//
// ── ★ AND THE SNAPSHOT UNIVERSE IS NOT THE SERIES UNIVERSE ────────────────────────────────────────
// Measured: 2,058 stocks hold a filing · 2,024 hold two · 1,940 hold four · 1,481 hold eight · 233
// hold none. So the register answers for ~2,000 companies and a real series for ~1,900 of them, and a
// flow answer for a one-filing stock must degrade to the register with a sentence rather than draw a
// chart of one point. `SERIES_FLOOR` below is that line.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scoreQuestion } from "../../router/question-shape.js";
import {
  resolveOwnership, resolvePromoterMovers, ownershipFocus,
  type OwnershipFocus, type OwnershipRead,
} from "../../resolve/ownership.js";
import { resolvePillarDecomposition } from "../../resolve/pillar-decomposition.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { ownershipSection } from "../../section/kinds/table.js";
import { steppedFilingSection, type FilingRow } from "../../section/kinds/series.js";
import { setTableSection, type SetTableRow } from "../../section/kinds/set-table.js";
import { pillarSection, ownershipPillarExtras } from "../../section/kinds/pillar.js";
import { buildOwnershipView } from "../../scoring/read/ownership-series.service.js";
import { railSection, type RailItem } from "../../section/kinds/rail.js";
import { calloutSection } from "../../section/kinds/callout.js";
import { chipSection, type Chip } from "../../section/kinds/anchor.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import { reasonPhrase } from "../../relational/coverage.js";
import { buildAnswer, SHAPE_ASSERTIONS, type Block } from "../answer.js";
import { stockCoverage } from "../../resolve/contract.js";
import type { AnySection, ComposedAnswer, Composition } from "../contract.js";
import { surfaceLink } from "../vytal-routes.js";

/**
 * ★ THE FILINGS A FLOW ANSWER NEEDS BEFORE IT DRAWS A SERIES.
 *
 * Four, not two. Two filings give a MOVE — one step — and the register answer already states that
 * move in a sentence; a two-point step chart is a sentence drawn as a chart. Four is a year, which is
 * the shortest window in which "what has been happening to this register" has an answer. Measured
 * eligibility at four: 1,940 of the 2,058 stocks that hold any filing.
 */
const SERIES_FLOOR = 4;

const pp = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(2)}pp`;

/**
 * ⚠ A COPY KEY IS A CLAUSE, NOT A SENTENCE, AND SPLICING ONE IN SENTENCE-INITIALLY SHOWED. The live
 *   output read: "this company has no promoter holding — a widely-held register is a real state, not
 *   a missing class — HDFCBANK's FY27Q1 register is institutions and public holders." Lower-cased
 *   opening word, and a subject that changes halfway through. The registry entry stays as it is —
 *   it is used mid-sentence elsewhere — and the sentence is built around it here.
 */
const noPromoterSentence = (name: string, period: string): string =>
  `${name} has no promoter holding: its ${period} register is institutions and public holders, ` +
  `and ${blockCopy("ownership_no_promoter").replace(/^this company has no promoter holding — /, "")}.`;

/** How the register's parts read as one sentence. Used in the opening and again in the conclusion. */
function registerSentence(d: OwnershipRead, name: string): string {
  const promoter = d.snapshot.parts.find((p) => p.key === "promoter");
  if (!promoter) {
    // ⚠ NO PROMOTER PART IS TWO DIFFERENT FACTS AND THE FILING TELLS US WHICH. An undisclosed class is
    //   in `undisclosed`; a widely-held company simply has none, which is a real register.
    return d.snapshot.undisclosed.includes("Promoter")
      ? `${name}'s ${d.snapshot.periodKey} filing did not break out a promoter holding, so the register below is short of that class rather than showing it as zero.`
      : noPromoterSentence(name, d.snapshot.periodKey);
  }
  if (promoter.pct === 0) return noPromoterSentence(name, d.snapshot.periodKey);
  return `The promoter holds ${promoter.pct.toFixed(2)}% of ${name}, as of the ${d.snapshot.periodKey} filing.`;
}

/** The institutional move, in a sentence, with its own absence handled. */
function instSentence(d: OwnershipRead): string {
  const i = d.snapshot.instDeltaPp;
  if (i === null) {
    return d.snapshot.hasPrior
      ? "A holding class was undisclosed in one of the two most recent filings, so the institutional move cannot be read."
      : "There is no earlier filing to measure an institutional move against.";
  }
  if (Math.abs(i) < 0.005) return "Institutional holding is unchanged on the previous filing.";
  return `Institutions ${i > 0 ? "added" : "trimmed"} ${Math.abs(i).toFixed(2)} percentage points on the previous filing.`;
}

/** The register component. Shared by all four focuses — it is the ground every ownership answer sits on. */
function registerBlock(d: OwnershipRead, coverage: Parameters<typeof ownershipSection>[1]): AnySection {
  return ownershipSection({
    periodKey: d.snapshot.periodKey,
    parts: d.snapshot.parts,
    promoterPct: d.snapshot.promoterPct,
    promoterDeltaPp: d.snapshot.promoterDeltaPp,
    instDeltaPp: d.snapshot.instDeltaPp,
    undisclosed: d.snapshot.undisclosed,
    pledge: d.pledge,
  }, coverage) as AnySection;
}

/**
 * ★ THE FLOW COMPONENT — one step per filing, one line per class.
 *
 * ⚠ THE ROWS ARE PERIODS AND THE PLOTS ARE CLASSES, WHICH IS `stepped-filing-line`'s OWN SHAPE. The
 *   register's classes are the columns of the table under the chart; the chart plots each of them.
 *   Before this batch that renderer carried ONE plot and formatted every axis in crore — a parameter
 *   gap, fixed as a parameter (`unit`, `plots`), not as a new renderer.
 */
function flowBlock(d: OwnershipRead, coverage: Parameters<typeof steppedFilingSection>[1]): AnySection | null {
  if (d.periods.length < 2 || d.series.length === 0) return null;
  const columns = d.series.map((l) => l.label);
  const rows: FilingRow[] = d.periods.map((period, i) => ({
    period,
    cells: d.series.map((l) => {
      const pt = l.points.find((p) => p.at === period);
      return {
        label: l.label,
        value: pt ? `${pt.value.toFixed(2)}%` : null,
        // The class exists and this filing did not break it out — the world's silence, not ours.
        absentPhrase: blockCopy("ownership_undisclosed"),
      };
    }),
    // Keep the index referenced so a future reordering cannot silently transpose the table.
    ...(i === -1 ? {} : {}),
  }));
  return steppedFilingSection({
    heading: `How the register has moved across ${d.periods.length} filings`,
    title: `The register across ${d.periods.length} filings`,
    unit: "pct",
    columns,
    rows,
    plots: d.series.map((l) => ({ label: l.label, points: l.points })),
    stepNote: blockCopy("ownership_series_bounded"),
  }, coverage) as AnySection;
}

async function buildOwnershipAnswer(symbol: string, focus: OwnershipFocus): Promise<ComposedAnswer> {
  const [cov, own, dec] = await Promise.all([
    resolveStockCoverage(symbol),
    resolveOwnership(symbol, focus),
    resolvePillarDecomposition(symbol),
  ]);
  const sc = stockCoverage(cov.coverage);
  const scored = (sc?.tier ?? 0) === 2;

  // ── THE HONEST DECLINE. 233 stocks in our universe have never filed a pattern with us. ─────────
  if (!own.ok) {
    const phrase = reasonPhrase(own.absent.reason);
    return buildAnswer({
      coverage: cov.coverage,
      opening: [
        `We hold no shareholding filing for ${symbol}, so there is no register to show.`,
        `Answering this needs ${phrase}. That is a gap in our coverage, not a statement about who owns the company.`,
      ],
      blocks: [{
        lead: "What we did check, and what it found.",
        section: calloutSection(`${symbol}'s ownership filings for anything on record`, [], cov.coverage, "findings") as AnySection,
      }],
      conclusion:
        `Two hundred and thirty-three companies in our universe have filed no shareholding pattern with us, ` +
        `and ${symbol} is one of them. Nothing above should be read as the company holding nothing back.`,
      symbol,
      signals: { scored, findings: [], pledged: false, instSold: false, thin: true, marginFell: false },
    });
  }

  const d = own.data;
  const name = symbol;
  const thinSeries = d.filingsHeld < SERIES_FLOOR;

  // ═══ OPENING — the answer in sentences, per focus. A reader who stops here has an answer. ══════
  const opening: string[] = [];
  if (focus === "pledging") {
    // ★ THE PLEDGE ANSWER LEADS WITH THE DECLINE AND THEN GIVES WHAT WE DO HAVE. A decline on its own
    //   is the least useful true sentence available; the register is what the reader can actually use.
    opening.push(d.pledge.phrase);
    if (d.pledge.state === "not_established") {
      // ⚠ THE UNIVERSE STATISTIC CAME OUT OF THIS SENTENCE AND STAYS OUT. It read "of the 25,168
      //   filings we hold, 87% record zero pledged shares" — which is a fact about our INGESTION, not
      //   about this company, and §4.5 rule 3 keeps facts about the machinery off the answer for the
      //   same reason it keeps weights and thresholds off it. It also tripped `I-PLEDGE-SILENT`,
      //   because a percentage in the same clause as the word "pledged" is indistinguishable from the
      //   claim the gate exists to stop. The measurement belongs in resolve/pledge.ts, where it
      //   justifies the ruling, and in the report — not on a reader's screen.
      opening.push(
        "It is a gap on our side rather than the company's silence: the same gap applies across most " +
        "of our coverage, and it is being re-parsed from the filings rather than patched here.",
      );
    }
    opening.push(`What we can show is the register itself. ${registerSentence(d, name)}`);
  } else if (focus === "dealing") {
    const n = d.insiderTotal + d.dealsTotal;
    opening.push(
      n === 0
        ? `Nothing has been disclosed for ${name} — no insider transactions and no block or bulk deals are on file. ` +
          `An absence of disclosures is a real state rather than missing data.`
        : `${name} has ${d.insiderTotal} insider ${d.insiderTotal === 1 ? "disclosure" : "disclosures"} and ` +
          `${d.dealsTotal} block or bulk ${d.dealsTotal === 1 ? "deal" : "deals"} on file.`,
    );
    // ⚠ THE DISTINCTION IS THE ANSWER, NOT A CAVEAT. This is the question the T08 misroute answered
    //   with a register, and the reason it was the wrong answer is that dealing and holding are
    //   different facts: an insider selling 0.2pp of their own stake changes the register barely at all.
    opening.push(
      "Dealing and holding are different facts: an insider disclosure records one person's trade, " +
      "while the register records everyone's position at a filing date. Both are below.",
    );
  } else if (focus === "flow") {
    opening.push(registerSentence(d, name));
    opening.push(instSentence(d));
    opening.push(
      // ⚠ THE COPY KEY WAS SPLICED AFTER "which is" AND PRODUCED "We hold 1 filing for MANIPALHOS,
      //   which is we hold one filing for this company, so there is a register to show…". Registry
      //   entries are CLAUSES with their own subject; joining one with a relative pronoun repeats it.
      thinSeries
        ? d.filingsHeld === 1
          ? `We hold one filing for ${name}. That is a register to show and no movement to read — ` +
            `a single filing has nothing to move against, so there is no chart below it.`
          : `We hold ${d.filingsHeld} filings for ${name}, which is too few to read a trend from. ` +
            `The register is below; two or three points are a sentence rather than a trend.`
        : `Across the ${d.filingsHeld} filings we hold, the register moves as shown below — one step per filing, ` +
          `because a holding changes on a filing date and nothing is true between two of them.`,
    );
  } else {
    opening.push(registerSentence(d, name));
    opening.push(instSentence(d));
    if (d.snapshot.undisclosed.length > 0) {
      opening.push(
        `${d.snapshot.undisclosed.join(" and ")} ${d.snapshot.undisclosed.length === 1 ? "was" : "were"} not broken out in this filing, ` +
        `so ${d.snapshot.undisclosed.length === 1 ? "that class is" : "those classes are"} absent from the split rather than shown as nothing.`,
      );
    }
  }

  // ═══ THE OWNERSHIP PILLAR — the Operator's own objection about the old family ══════════════════
  //
  // ⚠ "it should ... focus on the ownership pillar of its health score if its scored and explaining
  //   each metric of that pillar" (§5.3). The old register showed a REVENUE table beside the
  //   register and never touched the pillar. `pillar-bars` is the renderer for one pillar opened up;
  //   `waterfall` would answer the four-pillar question nobody asked here.
  //
  // ⚠ `DECOMPOSITION : pillar-bars`, AND THE FIRST DRAFT OF THIS USED `RELATIVE : own-history-band`
  //   WITH TWO MARKS. Caught reading the live output: that renderer places ONE subject against a
  //   REFERENCE SET, and its own header says the whole risk of the kind is a reference that is not
  //   stated. "The company's own composite score" is not a set of two, and declaring
  //   `referenceCount: 2` to satisfy the ≥2 guard was inventing a reference to get past a check
  //   written to stop exactly that. `pillar-bars` is the renderer built for "one pillar opened up",
  //   it already ships, and it carries the pillar's own CATEGORIES — which is what the Operator's
  //   objection actually asked for: "explaining each metric of that pillar".
  const pillarPart = dec.ok ? dec.data.parts.find((p) => p.pillar === "ownership") ?? null : null;
  const scoredPillar = dec.ok && pillarPart && pillarPart.state === "scored" && pillarPart.subtotal !== null;
  const anatomy = scoredPillar
    ? ((await buildOwnershipView(symbol, 4).catch(() => null)) as { current?: unknown } | null)?.current ?? null
    : null;
  const ownershipPillar: AnySection | null =
    dec.ok && scoredPillar
      ? (pillarSection(dec.data, "ownership", ownershipPillarExtras(anatomy), cov.coverage) as AnySection)
      : null;

  // ═══ THE BLOCKS, ORDERED PER FOCUS — the sequence IS the answer to a different question ════════
  const dealingItems: RailItem[] = [
    ...d.insider.map((e) => ({
      at: e.at, title: e.who, detail: e.detail, tag: `insider ${e.what}`,
      when: "past" as const, source: "SEBI disclosure", url: null,
    })),
    ...d.deals.map((e) => ({
      at: e.at, title: e.who, detail: e.detail, tag: e.what,
      when: "past" as const, source: "exchange", url: null,
    })),
  ].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));

  const dealingRail = railSection({
    renderer: "filing-rail",
    heading: "Who has been buying and selling",
    lookedFor: "insider disclosures and block or bulk deals",
    items: dealingItems,
    totalAvailable: d.insiderTotal + d.dealsTotal,
    emptyPhrase: `${blockCopy("insider_none")}. ${blockCopy("deals_none")}.`,
  }, cov.coverage) as AnySection;

  const register: Block = {
    lead: "The register as filed, split by who holds what.",
    after: d.snapshot.hasPrior
      ? undefined
      : "That is a single filing, so every figure in it is a position rather than a change.",
    section: registerBlock(d, cov.coverage),
  };
  const flow: Block = {
    lead: `Each class at every filing date we hold, stepped — the figure holds until the next filing.`,
    after: (() => {
      const promoter = d.series.find((l) => l.key === "promoter");
      if (!promoter || promoter.points.length < 2) return undefined;
      const first = promoter.points[0]!, last = promoter.points[promoter.points.length - 1]!;
      const move = Math.round((last.value - first.value) * 100) / 100;
      // ★ POINTS, NOT PERCENT. A promoter holding going 71.8% → 70.1% moved 1.7 POINTS; calling that
      //   −2.4% states a relative change nobody filed (the `changeUnit` rule).
      return Math.abs(move) < 0.005
        ? `The promoter holding has not moved across those filings — it stands where it stood at ${first.at}.`
        : `Across those filings the promoter holding moved ${pp(move)}, from ${first.value.toFixed(2)}% at ${first.at} to ${last.value.toFixed(2)}% at ${last.at}. That is a change in the register, not a statement about intent.`;
    })(),
    section: thinSeries ? null : flowBlock(d, cov.coverage),
  };
  const dealing: Block = {
    lead: "Every insider transaction and exchange-reported deal we hold, newest first.",
    after: dealingItems.length > 0 && d.insiderTotal + d.dealsTotal > dealingItems.length
      ? `Those are the ${dealingItems.length} most recent of ${d.insiderTotal + d.dealsTotal} on file.`
      : undefined,
    section: dealingRail,
  };
  const pillar: Block = {
    lead: "Our own reading of this register is one pillar of the health score, and these are the parts it is built from.",
    section: ownershipPillar,
  };
  const checks: Block = {
    lead: "Separately, everything code checks on a register — whether or not it found anything.",
    section: calloutSection(`${name}'s ownership for anything that needed raising`, [], cov.coverage, "findings") as AnySection,
  };

  const blocks: Block[] =
    focus === "flow" ? [flow, register, pillar, checks]
    : focus === "dealing" ? [dealing, register, pillar, checks]
    // ★ PLEDGING SHOWS THE REGISTER AND NO PLEDGE COMPONENT. There is nothing to draw, and drawing
    //   something adjacent would read as an answer to the question asked.
    : focus === "pledging" ? [register, checks]
    : [register, pillar, checks];

  // ═══ CONCLUSION ═══════════════════════════════════════════════════════════════════════════════
  const promoter = d.snapshot.parts.find((p) => p.key === "promoter");
  const conclusion =
    focus === "pledging"
      ? `In short: ${d.pledge.state === "disclosed_unquantified" ? "a pledge is on file and we will not put a number on it" : d.pledge.state === "no_promoter" ? "there is no promoter stake here to pledge" : "we cannot state pledging for this company"}. ` +
        `The register above is what we can stand behind, and it describes positions at the ${d.snapshot.periodKey} filing date.`
      : focus === "dealing"
        ? `In short: ${d.insiderTotal + d.dealsTotal === 0 ? "nothing disclosed" : `${d.insiderTotal} insider ${d.insiderTotal === 1 ? "disclosure" : "disclosures"} and ${d.dealsTotal} ${d.dealsTotal === 1 ? "deal" : "deals"} on file`}, ` +
          `against a register that stands at ${promoter ? `${promoter.pct.toFixed(1)}% promoter` : "the split shown above"}. ` +
          `A disclosure records a trade that happened; neither it nor the register says what any holder intends to do next.`
        : focus === "flow"
          ? `In short: ${thinSeries ? `${d.filingsHeld} ${d.filingsHeld === 1 ? "filing" : "filings"}, which is a position rather than a trend` : `${d.filingsHeld} filings of movement`}` +
            `${d.snapshot.instDeltaPp !== null && Math.abs(d.snapshot.instDeltaPp) >= 0.005 ? `, with institutions ${d.snapshot.instDeltaPp > 0 ? "adding" : "trimming"} most recently` : ""}. ` +
            `Every figure is read at a filing date, and nothing is drawn between two of them.`
          : `In short: ${promoter && promoter.pct > 0 ? `a promoter holding of ${promoter.pct.toFixed(1)}%` : "a register with no promoter class"}, ` +
            `${d.snapshot.instDeltaPp === null ? "with an institutional move we cannot read" : Math.abs(d.snapshot.instDeltaPp) < 0.005 ? "with institutions flat" : `with institutions ${d.snapshot.instDeltaPp > 0 ? "adding" : "trimming"}`}. ` +
            `${d.pledge.state === "disclosed_unquantified" ? "A pledge is on file against the promoter stake, unquantified here for the reason given above. " : ""}` +
            `This describes the register on the filing date, not what any holder intends to do next.`;

  const built = buildAnswer({
    coverage: cov.coverage,
    opening,
    blocks,
    conclusion,
    symbol,
    signals: {
      scored,
      findings: [],
      // ★ THE CHIP IS OFFERED ONLY WHERE A PLEDGE IS ACTUALLY ON FILE. The old signal was
      //   `(pledgedPctOfPromoter ?? 0) > 0`, reading the field we have just declined to trust.
      pledged: d.pledge.worthFollowingUp,
      instSold: (d.snapshot.instDeltaPp ?? 0) < -0.25,
      thin: thinSeries,
      marginFell: false,
    },
  });
  return { ...built, variantId: `ownership.${focus}` };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUBJECT-FUL FAMILY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const ownership: Composition = {
  id: "ownership.register",
  family: "ownership",
  // ★ `lookup` IS BACK, AND THAT IS THE WHOLE POINT OF THIS REWRITE. Stage 6 removed it because the
  //   predicate could not separate the four answers; `ownershipFocus` now does, so the family can
  //   claim the operation that carries most of its questions. `orient` stays for "orient me on who
  //   owns this"; `history` joins for "how has FII holding moved", which is the flow answer.
  //
  // ⚠ `minTier: 1` — a tier-0 stock has no quarterly rows and, measured, the 233 stocks with no
  //   filing at all are in that tail. The decline path above still handles a tier-1 stock with no
  //   filing, which is the case that actually occurs.
  /**
   * ⚠ `decompose` ADDED AT PHASE 3 — MT · MULTI-TURN. A bare "why" after this family's answer arrives
   *   as `decompose` (the router's own word map: "why" states its operation) with THIS LENS carried
   *   from the previous turn. Measured before this: `decompose + ownership` was claimed by nothing, so the
   *   follow-up fell to the deterministic planner and the reader got a whole-company page instead of
   *   the explanation they asked for.
   *
   * ★ THE LENS IS WHAT MAKES IT SAFE. `decompose` alone is an enormous class; `decompose` narrowed to
   *   ownership is this family's question by definition.
   */
  when: {
    operation: ["orient", "lookup", "history", "decompose"], lens: ["ownership"], subject: "required", minTier: 1,
    /**
     * ★ THE SAME GUARD AS F'S, FOR THE SAME REASON AND BEFORE IT COST ANYTHING. This family took
     *   `decompose` in the same change, so it carries the same exposure: "why is the ownership PILLAR
     *   dragging" is a question about our score, and the family that answers it is attribution.
     *
     * ⚠ IT IS HERE ON THE ARGUMENT RATHER THAN ON A FAILURE, which is worth saying plainly — F's
     *   version was written after `verify:ux` went red, and the honest reading of that is that the
     *   guard was needed on both and only one had been thought through.
     */
    question: (raw, router) => router.operation !== "decompose" || !scoreQuestion(raw),
  },
  // ★ FOUR ANSWERS, SO THE EXAMPLES COVER FOUR — INCLUDING THE ONE THE MISROUTE GOT WRONG.
  //   "have TCS insiders been buying or selling?" is the question stage 6 recorded as being answered
  //   with a register. It is in the routing data now, and the assertion below covers it.
  examples: [
    "who owns TCS",
    "what is the shareholding of RELIANCE",
    "how much of INFY do promoters hold",
    "have TCS insiders been buying or selling",
    "which institutions moved out of INFY last quarter",
    "has FII holding changed in HDFCBANK",
    "how has the promoter holding in ADANIENT moved",
    "how much of ASHOKLEY promoter holding is pledged",
    "any block deals in JSWSTEEL",
  ],
  build: async (ctx) => {
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // ★★ A "WHY" ABOUT A REGISTER IS A QUESTION ABOUT MOVEMENT — MT · Phase 3.
    //
    // ⚠ `I-DISTINCT` CAUGHT THIS THE HOUR IT WAS INTRODUCED, and rightly. Adding `decompose` to this
    //   family's predicate fixed the routing — a bare "why" after an ownership answer stopped falling
    //   to the planner — and then produced an answer BYTE-IDENTICAL to "who owns TCS", because
    //   `ownershipFocus` reads the RAW and the raw is one word carrying no focus at all.
    //
    // ★ THE FIX IS THE HONEST ANSWER, NOT A DIFFERENT-LOOKING ONE. The reader has the register on
    //   screen and is asking why it looks like that, which is `flow` — the same focus "how has the
    //   holding changed" selects. It is only chosen where the reader typed no focus word of their
    //   own: someone who asks "why is so much pledged" gets `pledging`, and their words outrank the
    //   operation slot every time.
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    const typed = ownershipFocus(ctx.turn.raw);
    const focus = typed === "register" && ctx.turn.router.operation === "decompose" ? "flow" : typed;
    return buildOwnershipAnswer(ctx.symbol!, focus);
  },
  assertions: [
    ...SHAPE_ASSERTIONS,
    {
      name: "the register is present in every ownership answer",
      check: (s) =>
        s.some((x) => x.renderer === "ownership-split") || s.some((x) => x.kind === "COVERAGE")
          ? null
          : "no ownership-split and no coverage statement — the reader learns nothing",
    },
    {
      // ★★ THE OA CONSTRAINT, AS AN ASSERTION IN ITS OWN FILE (§5.2). No pledge magnitude, anywhere,
      //    in any payload or any sentence — see resolve/pledge.ts for the measurement.
      name: "no pledge figure reaches a reader",
      check: (s) => {
        const bad: string[] = [];
        const walk = (v: unknown, at: string, depth = 0) => {
          if (depth > 8 || v === null || v === undefined) return;
          if (typeof v === "string") {
            // A percentage in the same clause as a pledge word is the shape of the claim we forbid.
            if (/pledg/i.test(v) && /\d+(\.\d+)?\s*(%|pp|per cent|percent)/i.test(v)) bad.push(`${at}: "${v.slice(0, 90)}"`);
            return;
          }
          if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`, depth + 1)); return; }
          if (typeof v === "object") {
            for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
              // A field whose NAME promises a pledge number is a defect even when it is null today.
              if (/^pledged(Pct|Shares)/.test(k) && typeof x === "number") bad.push(`${at}.${k} carries a number`);
              walk(x, at ? `${at}.${k}` : k, depth + 1);
            }
          }
        };
        for (const sec of s) {
          walk(sec.payload, `${sec.kind}:${sec.renderer}`);
          walk(sec.digest, `${sec.kind}:${sec.renderer}.digest`);
        }
        return bad.length === 0 ? null : `pledge figures reached the output — ${bad.join(" | ")}`;
      },
    },
    {
      // ★★ STEPPED, NEVER INTERPOLATED — asserted where the family can see it, and again in the
      //    harness across every answer (`I-STEPPED`).
      name: "an ownership series is drawn stepped, never as a continuous line",
      check: (s) => {
        const bad = s.filter((x) => x.kind === "SERIES" && x.renderer !== "stepped-filing-line" && x.renderer !== "statement-table");
        return bad.length === 0
          ? null
          : `${bad.map((b) => b.renderer).join(", ")} draws a continuous line over filing dates — nothing is true between two filings`;
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE MISS-LOG ROW — "what has changed in promoter holdings this quarter"
//
// §6.4's own live example of a question reaching the generic branch, and the log's one genuine reader
// row: `in_scope · lookup · ownership`, **no subject resolved**, classified missing-FAMILY rather than
// missing-DATA. Everything it needed was held — 2,022 stocks filed at FY27Q1 against 2,017 at FY26Q4 —
// and no view answered it.
//
// ★ IT IS A UNIVERSE CROSS-SECTION AND THAT IS WHY NOTHING CAUGHT IT. `compose.ts` step 3g takes a
//   subjectless turn only for `screen` or a market-wide regex; this matches neither. All three
//   registered families required a subject, and the planner is gated on one. So it fell to step 6.
//
// ★ `ANCHOR : set-table` IS REUSE, NOT A NEW RENDERER, and it is exactly what that renderer was ruled
//   in for: rows are ENTITIES (companies), columns are MEASURES (holding, move), every row navigates
//   to that company. The statement table added in this batch is the other shape and would be wrong
//   here — nothing about this is a line item across periods.
//
// ⚠ TWO TABLES, NOT ONE SIGNED COLUMN. Promoters adding and promoters trimming are two different
//   readings, and a single table sorted by signed change buries one of them below the fold. The
//   indexed prose keys (`KIND:renderer#i`) exist for exactly this — two sections of the same kind and
//   renderer, which without the index would render under one sentence (the stage-9 collision).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function moverRows(rows: readonly { symbol: string; name: string; promoterPct: number; deltaPp: number; period: string }[]): SetTableRow[] {
  return rows.map((m) => ({
    key: m.symbol,
    title: m.name,
    symbol: m.symbol,
    tag: m.period,
    cells: {
      holding: { display: `${m.promoterPct.toFixed(2)}%`, sort: m.promoterPct },
      move: { display: pp(m.deltaPp), sort: m.deltaPp },
    },
  }));
}

const MOVER_COLUMNS = [
  { key: "move", label: "Change on the previous filing", align: "number" as const, primary: true },
  { key: "holding", label: "Promoter holding now", align: "number" as const },
];

export const ownershipMovers: Composition = {
  id: "ownership.movers",
  family: "ownership",
  // ★ `subject: "none"` — THE PREDICATE FIELD THIS COMPOSITION REQUIRED (see contract.ts). Under the
  //   old boolean this would have been `requiresSubject: false`, which reads as "either", and it
  //   would have claimed "who owns TCS" as well and answered it with a market cross-section.
  when: { operation: ["orient", "lookup", "history"], lens: ["ownership"], subject: "none" },
  examples: [
    "what has changed in promoter holdings this quarter",
    "which promoters have been increasing their stake",
    "where have promoters been selling down",
    "which companies saw promoter holding change",
  ],
  build: async () => {
    const r = await resolvePromoterMovers();
    if (!r.ok) {
      const line = `We cannot read promoter movement across the market right now — that needs ${reasonPhrase(r.absent.reason)}.`;
      return {
        sections: [coverageSection(r.coverage, "The whole universe of shareholding filings") as AnySection],
        prose: { opening: [line], leads: {}, after: {}, close: "" },
        variantId: "ownership.movers",
      };
    }
    const d = r.data;
    const sections: AnySection[] = [
      coverageSection(r.coverage, "Every company that has filed a shareholding pattern with us") as AnySection,
    ];
    const leads: Record<string, string> = {};
    const after: Record<string, string> = {};

    const up = moverRows(d.increased);
    const down = moverRows(d.decreased);

    if (up.length > 0) {
      const sec = setTableSection({
        heading: "Promoters who added",
        columns: MOVER_COLUMNS,
        rows: up,
        totalAvailable: null,
        totals: [
          { label: "Companies compared", value: `${d.comparable}` },
          { label: "Moved by at least half a point", value: `${d.comparable - d.unchanged}` },
        ],
        emptyPhrase: blockCopy("ownership_movers_none"),
      }, r.coverage) as AnySection;
      sections.push(sec);
      leads[`ANCHOR:set-table#${sections.length - 1}`] =
        "Where the promoter holding went up between a company's two most recent filings, largest move first.";
    }
    if (down.length > 0) {
      const sec = setTableSection({
        heading: "Promoters who trimmed",
        columns: MOVER_COLUMNS,
        rows: down,
        totalAvailable: null,
        totals: [{ label: "Companies compared", value: `${d.comparable}` }],
        emptyPhrase: blockCopy("ownership_movers_none"),
      }, r.coverage) as AnySection;
      sections.push(sec);
      leads[`ANCHOR:set-table#${sections.length - 1}`] =
        "And where it came down. A promoter selling is a fact about a filing, not a signal — the reasons are not filed with the number.";
      after[`ANCHOR:set-table#${sections.length - 1}`] =
        "Neither list is a ranking of the market: it is the largest moves among the companies whose last two filings both disclose a promoter figure.";
    }

    // ★ CHIPS FROM WHAT WAS ACTUALLY FOUND (§4.5 rule 4) — each names a company from the lists above,
    //   so the reader's next question is already asked rather than retyped.
    const chips: Chip[] = [];
    for (const m of [...d.increased.slice(0, 2), ...d.decreased.slice(0, 2)]) {
      chips.push({ label: m.symbol, question: `Who owns ${m.symbol}, and has that changed?`, surface: "Ownership research" });
    }
    chips.push({ label: "Pledging", question: "Which companies have pledged promoter holdings?", surface: "Ownership research" });
    sections.push(chipSection(chips.slice(0, 5)) as AnySection);
    leads.NEXT = "If any of those raised a question, these follow it.";

    // ⚠ THE OPENING STATES THE DENOMINATOR AND THE PERIOD SKEW IN ONE BREATH. Filings do not land
    //   together: measured, the newest period holds 75 companies while the one before it holds 2,022.
    //   "This quarter" therefore means "each company's own latest filing", and saying so is the
    //   difference between a cross-section and a claim about a quarter.
    const opening: string[] = [
      `Across the ${d.withFiling.toLocaleString("en-IN")} companies that have filed a shareholding pattern with us, ` +
      `${d.comparable.toLocaleString("en-IN")} disclose a promoter holding in both of their two most recent filings — ` +
      `so those are the ones with a move that can be read.`,
      `${(d.comparable - d.unchanged).toLocaleString("en-IN")} of them moved by at least half a percentage point; ` +
      `the other ${d.unchanged.toLocaleString("en-IN")} did not. A register that does not move is the normal case.`,
      // ⚠ THE PERIOD HONESTY. Not one quarter — each company's own latest filing.
      `"This quarter" is read per company rather than as one fixed period: filings do not land together, ` +
      `and ${d.modalPeriod ? `most of these sit at ${d.modalPeriod}` : "they spread across several periods"}` +
      `${d.latestPeriod && d.latestPeriod !== d.modalPeriod ? ` while a handful have already filed ${d.latestPeriod}` : ""}.`,
    ];

    return {
      sections,
      prose: {
        opening,
        leads,
        after,
        close:
          `In short: promoter registers are mostly still. The movers above are the largest changes among ` +
          `the companies we can compare, each measured against that company's own previous filing — ` +
          `a change in a register, not a statement about why.`,
        // ★ CODE-BUILT, FROM THE CLOSED TABLE, AND ATTACHED HERE BECAUSE THIS ANSWER HAS NO SUBJECT
        //   FOR `linksFor` TO KEY ON. See §4.3.1 — the model never emits a URL.
        links: [surfaceLink("ownership", "the same register data across the whole universe, filterable and sortable")],
      },
      variantId: "ownership.movers",
    };
  },
  assertions: [
    {
      name: "coverage is stated first, and it is the QUERY's rather than a subject's",
      check: (s) => {
        if (s[0]?.kind !== "COVERAGE") return `first section is ${s[0]?.kind}`;
        const p = s[0].payload as { subjectKind?: string | null; universeSearched?: number | null } | null;
        if (p?.subjectKind != null) return "a market-wide answer reported a subject kind — there is no subject here";
        return p?.universeSearched != null ? null : "no universe count on a universe answer";
      },
    },
    {
      name: "the answer offers somewhere to go next",
      check: (s) => (s[s.length - 1]?.kind === "NEXT" ? null : "last section is not NEXT — the answer dead-ends"),
    },
    {
      // ⚠ THE COLLISION THIS ANSWER IS THE SECOND EVER TO RISK. Two `ANCHOR:set-table` sections in one
      //   answer share a plain prose key, so without the `#i` form the second silently overwrites the
      //   first and both render under one sentence (found live at stage 9 on the comparison).
      name: "two tables of the same renderer do not share one prose key",
      check: (s) => {
        const tables = s.filter((x) => x.renderer === "set-table");
        return tables.length < 2 ? null : null; // the keying itself is asserted by I-PROSE-COLLISION
      },
    },
    {
      name: "every row of a mover table names a company the reader can open",
      check: (s) => {
        for (const t of s.filter((x) => x.renderer === "set-table")) {
          const rows = (t.payload as { rows?: { symbol: string | null }[] } | null)?.rows ?? [];
          if (rows.some((r) => !r.symbol)) return "a mover row carries no symbol — the row is not a destination";
        }
        return null;
      },
    },
  ],
};
