// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: T · TRAJECTORY — "how has this moved", "when did it turn", "has it been getting worse".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE §4.1 TEST, RUN A FOURTH TIME — AND FOR THE FIRST TIME THE ANSWER IS A **DEPTH FLOOR**.
//
// The three earlier answers were all about the composition COUNT: F took one composition with a focus
// parameter, OA took four compositions, PG took one with no parameter. Running the same test on T
// gives a different KIND of answer, so it is worth being explicit that it was actually run rather than
// pattern-matched onto the nearest predecessor.
//
//   "how has TCS's score moved"        arc      the whole window
//   "when did INDUSINDBK start falling" turn    the same window, led by the change point
//   "has X been improving"             verdict  the same window, led by the last phase
//   "how has MANIPALHOS changed"       thin     ★ a DIFFERENT SERIES ENTIRELY
//
// The first three read one source and want one sequence — PG's answer. The fourth does not, and it is
// the interesting one: a company we cover and do not score has **no score history at all**, and
// answering "how has it changed over time" with an absent card would be false, because we hold its
// filings. So the split in this family is not by focus and not by lens: it is by WHETHER THE SCORE
// SERIES EXISTS, which is a data fact and therefore cannot be a predicate (a predicate is slot-only,
// §5). It is a branch INSIDE one composition, and the branch is announced to the reader by name —
// `SeriesBasis`, which every trajectory answer carries.
//
// ⚠ SO THE PARAMETER THAT MATTERS HERE IS NOT `trajectoryLead`. That one exists and it only re-orders
//   prose, exactly as `peerLead` does. The load-bearing parameter is the SERIES BASIS, and it is
//   chosen by the data rather than by the question.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── SECTION ORDER, AND WHY ────────────────────────────────────────────────────────────────────────
//   COVERAGE : coverage-header        what we hold, before any line is drawn (N-6)
//   SERIES   : phase-shaded-spine     the arc — bands behind it, phases over it, turns marked
//   RELATIVE : own-history-band       WHICH of the four parts moved across the window
//   RAIL     : event-rail             what fired and expired AT the turns
//   NEXT     : chips
//
// The shape comes first because "how has it moved" is a question about a shape, and every sentence
// after it is about something visible on that chart. The pillar band comes second because the reader's
// next question on seeing a turn is always "which part" — and it is a band rather than a second line on
// the spine because five lines on one 0-100 axis is a chart whose shape means nothing (the same
// argument `statement-table` used for not plotting a balance sheet).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  resolveTrajectory, redistributionSentence, witnessSentence, MIN_PHASE, MIN_STEP,
  bandWord, type TrajectoryRead,
} from "../../resolve/trajectory.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { quarterSeriesBlock } from "../../compose/blocks.js";
import { phaseSpineSection } from "../../section/kinds/series.js";
import { relativeSection, type RelativeMark } from "../../section/kinds/relative.js";
import { railSection, type RailItem } from "../../section/kinds/rail.js";
import { LABEL_BAND_MAP } from "../../scoring/composite/label.js";
import { stockCoverage } from "../../resolve/contract.js";
import { buildAnswer, SHAPE_ASSERTIONS, type Block } from "../answer.js";
import { windowShortfall } from "../window-shortfall.js";
import { healthQuestion } from "../../router/question-shape.js";
import type { AnySection, ComposedAnswer, Composition } from "../contract.js";

/**
 * ★ WHICH SENTENCE LEADS. Prose order ONLY — the evidence is identical, and that is the point.
 *
 * ⚠ THE ASSERTION THAT KEEPS THIS HONEST IS `I-DISTINCT`, AND IT CAUGHT PG's VERSION OF THIS EXACT
 *   CLAIM IN THE LAST BATCH. `peer-group.ts`'s header said "the difference lives entirely in which
 *   sentence leads" while the two answers were byte-identical, because the lead had been designed and
 *   not implemented. So the rule for this file: if a lead is declared, a reader must be able to see the
 *   difference in the first sentence, and the harness must be able to see it too.
 */
export type TrajectoryLead = "arc" | "turn" | "verdict";

const TURN_WORDS = ["when", "start", "started", "begin", "began", "turn", "turned", "point", "since"];
const VERDICT_WORDS = ["improving", "improved", "better", "worse", "worsening", "deteriorating", "declining", "recovering", "getting"];

const wordsOf = (raw: string): Set<string> =>
  new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));

/** Code-extracted from the SENTENCE, never asked of the model — the §6.5 rule for question shape. */
export function trajectoryLead(raw: string): TrajectoryLead {
  const w = wordsOf(raw);
  if (TURN_WORDS.some((x) => w.has(x))) return "turn";
  if (VERDICT_WORDS.some((x) => w.has(x))) return "verdict";
  return "arc";
}

const pts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;

/**
 * ★ THE METHOD SENTENCE, ON THE CARD RATHER THAN IN A TOOLTIP.
 *
 * A phase is a DERIVED object — nobody filed it — and the one thing a reader is owed about a derived
 * object is how it was derived. Both numbers in it come from somewhere the reader can check: the floor
 * is a count of quarters, the step is the width of a band we publish on the methodology page.
 */
function methodNote(): string {
  return `A phase is a run of at least ${MIN_PHASE} quarters whose average sits at least ${MIN_STEP} points ` +
    `away from the run beside it — ${MIN_STEP} being the narrowest band we publish, so a step smaller ` +
    `than that could not move a company from one label to another.`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCORED ARM
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function scoredAnswer(
  symbol: string,
  d: TrajectoryRead,
  lead: TrajectoryLead,
  cov: ReturnType<typeof stockCoverage>,
  coverage: Parameters<typeof buildAnswer>[0]["coverage"],
  /** What the reader asked for, so a shorter answer can say so — see `windowShortfall`. */
  ctxTimeframe: { kind: "latest" | "quarters" | "years"; n: number | null } | null,
): ComposedAnswer {
  const last = d.points[d.points.length - 1];
  const latestPhase = d.phases[d.phases.length - 1];
  const turns = d.phases.filter((p) => p.stepFromPrior !== null);
  const oneLevel = d.phases.length === 1;

  // ── THE OPENING. Three orders over one set of facts, and each one answers a different question
  //    FIRST. `arc` opens with the shape, `turn` opens with the date, `verdict` opens with where it
  //    has ended up. Every opening states the window, because a trajectory sentence with no window is
  //    a claim with no scope.
  const shapeSentence = oneLevel
    ? `Across ${d.basis.periods} quarters ${symbol} has held one level, averaging ${latestPhase.mean.toFixed(1)}, which reads as ${bandWord(latestPhase.bandLabel).toLowerCase()}.`
    : `Across ${d.basis.periods} quarters ${symbol} has moved through ${d.phases.length} distinct levels, ` +
      `from ${d.phases[0].mean.toFixed(1)} to ${latestPhase.mean.toFixed(1)}.`;

  const turnSentence = turns.length === 0
    ? (d.largestStep && Math.abs(d.largestStep.delta) >= MIN_STEP
        // ★ THE LT CASE, AND IT IS THE ONE A PHASE COUNT ALONE GETS WRONG. LT's range is 19.3 points
        //   and binary segmentation correctly returns ONE phase, because the moves cancel: it fell
        //   19.3 in a single quarter and took most of it back. Saying "no turn" and stopping there
        //   would describe the most eventful series in the set as uneventful.
        ? `There is no point at which ${symbol} settled at a new level, but it did move sharply once: ` +
          `it ${d.largestStep.delta < 0 ? "fell" : "rose"} ${Math.abs(d.largestStep.delta).toFixed(1)} ` +
          `points between ${d.largestStep.from} and ${d.largestStep.at}, and did not hold there.`
        : `There is no point at which ${symbol} changed level — the score has stayed within ` +
          `${d.range.toFixed(1)} points of itself for the whole window.`)
    : `${symbol} changed level ${turns.length === 1 ? "once" : `${turns.length} times`}: ` +
      turns.map((t) => `${t.fromPeriod}, ${t.stepFromPrior! > 0 ? "up" : "down"} ${Math.abs(t.stepFromPrior!).toFixed(1)} points`).join("; ") + ".";

  // ⚠ THE ONE-LEVEL VERDICT USED TO SAY "it has been at that level for the whole window", AND ON LT
  //   THAT SENTENCE IS FALSE. LT is one phase and fell 19.3 points in a single quarter before taking
  //   most of it back; "no change" is what the phase COUNT says and it is not what happened. A
  //   segmentation that finds no new level is a statement about the LEVEL, never about the line.
  const bigSwing = d.largestStep !== null && Math.abs(d.largestStep.delta) >= MIN_STEP;
  const verdictSentence = oneLevel
    ? bigSwing
      ? `${symbol} reads ${last.composite.toFixed(1)} today, and across the window it has come back to ` +
        `roughly where it started — but not smoothly: it moved ${Math.abs(d.largestStep!.delta).toFixed(1)} ` +
        `points between ${d.largestStep!.from} and ${d.largestStep!.at} and then gave most of it back.`
      : `${symbol} reads ${last.composite.toFixed(1)} today, and it has been at that level for the whole ` +
        `window — neither improving nor deteriorating in a way our own bands would register.`
    : `${symbol} reads ${last.composite.toFixed(1)} today. Its most recent level is ` +
      `${latestPhase.stepFromPrior! > 0 ? "above" : "below"} the one before it by ` +
      `${Math.abs(latestPhase.stepFromPrior!).toFixed(1)} points, and it has held there for ` +
      `${latestPhase.periods} quarter${latestPhase.periods === 1 ? "" : "s"}.`;

  // ── THREE ORDERS, AND EACH ONE'S SECOND SENTENCE IS DIFFERENT TOO. Reversing a pair would have
  //    been a "lead" a reader could not feel, which is the defect PG's `peerLead` shipped and had to
  //    be sent back for. `arc` gives the shape then the turns; `turn` gives the turns then what was
  //    firing at them; `verdict` gives where it stands then how it got there.
  const atTurn = turns.length > 0
    ? (() => {
        const near = d.events.filter((e) => e.kind === "fired" && turns.some((t) => t.fromPeriod === e.periodKey));
        return near.length
          ? `In that quarter ${near.length === 1 ? "one check started applying" : `${near.length} checks started applying`}, ` +
            `beginning with ${near[0].label.toLowerCase()}.`
          : `Nothing code checks started or stopped applying in that quarter, so the move is in the ` +
            `filed figures rather than in anything we flagged.`;
      })()
    : shapeSentence;

  const opening =
    lead === "turn" ? [turnSentence, atTurn]
    : lead === "verdict" ? [verdictSentence, turnSentence]
    : [shapeSentence, turnSentence];

  // ⚠ THE EPOCH IS STATED ON EVERY ANSWER, NOT ONLY WHEN SOMEONE ASKS FOR MORE. A reader shown 14
  //   quarters with no explanation reads 14 as all we could find. It is all there is.
  //
  // ★ AND WHERE THEY DID ASK FOR MORE, THE ASK IS ACKNOWLEDGED — DX, Phase 3. "Show me the last 20
  //   quarters" returned 14 with a correct label and no acknowledgement, leaving the reader to notice
  //   by counting. The epoch sentence is the REASON, so the two travel together: "you asked for 20;
  //   there are 14" followed by why there are only 14.
  const askedQuarters = ctxTimeframe?.kind === "quarters" ? ctxTimeframe.n : null;
  const shortfall = windowShortfall(askedQuarters, d.basis.periods, "quarter", d.epochSentence);
  opening.push(shortfall ?? d.epochSentence);

  const bands = LABEL_BAND_MAP.map((b) => ({
    band: b.band,
    label: b.label,
    min: Number.isFinite(b.min) ? b.min : null,
    max: b.max,
  }));

  const spine = phaseSpineSection({
    heading: "How the score has moved",
    label: `${symbol} health score`,
    points: d.points.map((p) => ({ at: p.periodKey, value: p.composite, band: p.band, pillars: p.pillars })),
    phases: d.phases.map((p) => ({
      fromIndex: p.fromIndex, toIndex: p.toIndex, fromLabel: p.fromPeriod, toLabel: p.toPeriod,
      mean: p.mean, band: p.band, bandLabel: p.bandLabel, stepFromPrior: p.stepFromPrior, periods: p.periods,
    })),
    bands,
    events: d.events.map((e) => ({ at: e.periodKey, kind: e.kind, label: e.label, detail: e.detail })),
    windowLabel: `${d.basis.fromPeriod} to ${d.basis.toPeriod}`,
    basisNote: d.basis.sentence,
    methodNote: methodNote(),
    facts: [
      { label: "Highest to lowest", value: `${d.range.toFixed(1)} points`, absentPhrase: "" },
      { label: "Largest single move",
        value: d.largestStep ? `${pts(d.largestStep.delta)} into ${d.largestStep.at}` : null,
        absentPhrase: "only one reading held, so there is no move between quarters" },
      { label: "Reading now", value: `${last.composite.toFixed(1)} at ${last.periodKey}`, absentPhrase: "" },
    ],
  }, coverage) as AnySection;

  // ── WHICH PART MOVED. `own-history-band` is the renderer for "the subject against its own history",
  //    which is precisely this: four parts, each measured against where it started.
  //    ⚠ A REDISTRIBUTED PILLAR CARRIES `value: null` AND ITS OWN WORDS. VEDL's Market is unscorable in
  //      its two most recent quarters; a 0 there would draw a 71-point collapse that never happened.
  const marks: RelativeMark[] = d.pillarMoves.map((m) => ({
    label: m.pillar,
    value: m.delta,
    display: m.delta === null ? "" : `${pts(m.delta)} across the window`,
    // ⚠ THE NOTE IS A FIELD, NOT A SUFFIX — see `RelativeMark.note`. Appending it here is what made
    //   the card 662px wide in a 346px panel, and deleting it would have been the worse fix.
    note: m.note ?? null,
    role: "member" as const,
  }));
  const pillarBand = relativeSection({
    renderer: "own-history-band",
    heading: "Which part of the score moved",
    unit: "score",
    marks,
    referenceLabel: "where each part started this window",
    referenceCount: d.points.length,
    windowLabel: `${d.basis.fromPeriod} to ${d.basis.toPeriod}`,
    unavailablePhrase: "only one scored quarter, so no part has a move to state",
  }, coverage) as AnySection;

  // ── WHAT WAS HAPPENING AT THE TURNS. Nothing at all when there was no turn, and that empty is a
  //    SENTENCE rather than an empty card (§4.5 rule 2).
  const items: RailItem[] = d.events.map((e) => ({
    at: e.periodKey,
    title: e.label,
    detail: e.detail ?? "",
    tag: e.kind === "turn" ? "level change" : e.kind === "redistribution" ? "scoring change" : e.kind,
    when: "past" as const,
    source: null,
    url: null,
  }));
  const rail = railSection({
    renderer: "event-rail",
    heading: "What was happening at the turns",
    lookedFor: "checks that started or stopped applying where the level changed, and parts that stopped being scorable",
    items,
    emptyPhrase: turns.length === 0
      ? "The level never changed, so there is no turn to look around."
      : "Nothing started or stopped applying in the quarters where the level changed.",
  }, coverage) as AnySection;

  const redistributedNow = last.redistributed.length
    ? redistributionSentence("missing_pillar", last.redistributed)
    : null;
  const witness = witnessSentence(d.witnessedEmpty.length, d.unwitnessed.length, d.basis.periods);

  const blocks: Block[] = [
    {
      lead: `${d.basis.sentence} The shaded bands behind it are the five labels we publish, so a line ` +
        `crossing into a new band is a company changing label.`,
      section: spine,
      after: oneLevel
        ? `No run of ${MIN_PHASE} quarters sits ${MIN_STEP} points clear of the run beside it, which is why ` +
          `this reads as one level rather than several.`
        : `The steps are where the level itself changed, not where the line happened to be steep.`,
    },
    {
      lead: (() => {
        const m = d.pillarMoves.find((x) => x.delta !== null);
        return m
          // ⚠ THE NOTE TRAVELS WITH THE NUMBER. VEDL's Market and LT's Momentum are each measurable
          //   over only part of the window, and quoting "-16.7 pts across the window" without saying
          //   which quarters it was measurable in is a partial-window figure wearing a whole-window
          //   label — the same class of quiet lie as an unstated depth floor.
          ? `A composite is four parts, so a move in it is a move in at least one of them — and here ` +
            `it is ${m.pillar}, ${pts(m.delta!)}` +
            (m.note ? ` ${m.note}.` : ` across the window.`)
          : `A composite is four parts, and none of them has enough scored quarters here to state a move.`;
      })(),
      section: pillarBand,
      after: redistributedNow ?? undefined,
    },
    {
      lead: turns.length === 0
        ? `And whether anything code checks started or stopped applying along the way.`
        : `And what code was flagging in the quarters where the level changed.`,
      section: rail,
      after: witness ?? undefined,
    },
  ];

  const strongest = d.pillarMoves.find((m) => m.delta !== null) ?? null;
  const conclusion = oneLevel
    ? `In short: ${symbol} has not settled at a new level across the ${d.basis.periods} quarters we have scored it` +
      (bigSwing
        ? `, though it moved ${Math.abs(d.largestStep!.delta).toFixed(1)} points in one quarter and gave most of it back.`
        : `.`) +
      ` This describes what has been filed, not what happens next.`
    : `In short: ${d.phases.length} levels across ${d.basis.periods} quarters, the most recent being ` +
      `${bandWord(latestPhase.bandLabel).toLowerCase()}` +
      (strongest && strongest.delta !== null
        ? `, and ${strongest.pillar} is the part that moved most (${pts(strongest.delta)}).`
        : `.`) +
      ` This describes what has been filed, not what happens next.`;

  return buildAnswer({
    coverage,
    opening,
    blocks,
    conclusion,
    symbol,
    signals: {
      scored: true,
      findings: d.events.filter((e) => e.kind === "fired" && e.key !== null).slice(0, 2).map((e) => e.label),
      pledged: false,
      instSold: false,
      thin: (cov?.depth.quarters ?? 0) < 8,
      marginFell: false,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNSCORED ARM — the branch the §4.1 test actually turned on.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function filedAnswer(symbol: string, coverage: Parameters<typeof buildAnswer>[0]["coverage"]): Promise<ComposedAnswer> {
  const cov = stockCoverage(coverage);
  const quarters = cov?.depth.quarters ?? 0;
  const filed = quarters > 0 ? await quarterSeriesBlock(symbol, Math.min(quarters, 12)) : null;

  // ⚠ THE BASIS IS STATED FIRST AND IN THE READER'S WORDS, because this answer is the one most likely
  //   to be mistaken for the other. A page of real filed figures reads as a scored company unless the
  //   first sentence says otherwise.
  const opening = [
    `We do not score ${symbol}, so there is no score history to trace — the line this question usually ` +
      `gets does not exist for this company.`,
    quarters > 0
      ? `What we do hold is what it has filed: ${quarters} quarter${quarters === 1 ? "" : "s"} of results. ` +
        `That is a record of the business rather than a reading of it, and it is what is below.`
      : `We hold no quarterly results for it either, so there is nothing to draw over time.`,
  ];

  const blocks: Block[] = [
    {
      lead: `Its filed quarters, in the order they were reported. These step rather than slope, because ` +
        `a company files four times a year and nothing is true between the filings.`,
      section: filed,
      after: quarters > 0
        ? `This is the company's own history, not ours. Where a scored company would also have a ` +
          `trajectory through our bands, this one has filings and no reading laid over them.`
        : undefined,
    },
  ];

  return buildAnswer({
    coverage,
    opening,
    blocks,
    conclusion: quarters > 0
      ? `In short: a filed history of ${quarters} quarter${quarters === 1 ? "" : "s"} and no scored one. ` +
        `The absence of a score is a coverage gap on our side, not a judgement about the company.`
      : `In short: we hold neither a score nor a filed series for ${symbol}. That is a coverage gap, ` +
        `not a judgement about the company.`,
    symbol,
    signals: { scored: false, findings: [], pledged: false, instSold: false, thin: true, marginFell: false },
  });
}

export const trajectory: Composition = {
  id: "trajectory.arc",
  family: "trajectory",
  /**
   * ⚠ `minTier: 1`, NOT 2, AND THAT IS THE WHOLE POINT OF THE UNSCORED ARM. A `minTier: 2` predicate
   *   would send every tier-1 company's trajectory question to the generic composition, which draws
   *   whatever the planner thinks fits and never says the score series does not exist. That is the
   *   MOLBIO lesson from the last two batches in its other form: not "the fixture cannot reach the
   *   family", but "the family refuses the subject and nobody notices, because something still renders".
   *
   * ⚠ AND IT CLAIMS `orient` ALONGSIDE `history`. Measured across the live router in the last batch,
   *   the same sentence classifies two ways run to run (§6.5, 80–88%): "how has TCS's score moved over
   *   time" is `history` on one roll and `orient · health` on the next. A family that claimed only
   *   `history` would give the deep answer on one roll and a generic one on the next, with nothing on
   *   either screen saying why. The lens keeps it from swallowing `orient` at large.
   */
  when: {
    // ★ `explain` FOR THE SAME REASON AS ATTRIBUTION'S — see the note there. It is added to BOTH
    //   halves of the health lens deliberately: giving it only to attribution would have left
    //   "explain how TCS's score has moved" — which `healthQuestion` reads as trajectory — falling
    //   into the hole the other fix had just closed.
    // ★ `lookup` ON BOTH HALVES, for the reason `explain` is on both — see attribution's note. The
    //   `healthQuestion` partition below is what keeps them apart, and it reads the SENTENCE, so
    //   widening the operation set cannot make these two collide.
    operation: ["history", "orient", "explain", "lookup"], lens: ["health"], subject: "required", minTier: 1,
    // ★ THE SENTENCE GUARD, AND IT IS HALF OF A PARTITION. `attribution` claims the same slots and
    //   tests the same function for the other value, so the two are disjoint and total and the order
    //   of `COMPOSITIONS` decides nothing. Without it, this family answered "what is dragging TCS's
    //   score down" with a phase chart — see `healthQuestion`'s header.
    question: (raw) => healthQuestion(raw) === "trajectory",
  },
  examples: [
    "how has TCS's score moved over time",
    "when did INDUSINDBK start declining",
    "has HDFCBANK been getting better or worse",
    "show me EICHERMOT's health history",
  ],
  build: async (ctx) => {
    const symbol = ctx.symbol!;
    const [cov, traj] = await Promise.all([resolveStockCoverage(symbol), resolveTrajectory(symbol)]);
    const coverage = cov.coverage;
    if (!traj.ok) return filedAnswer(symbol, coverage);
    return scoredAnswer(symbol, traj.data, trajectoryLead(ctx.turn.raw), stockCoverage(coverage), coverage, ctx.turn.router.timeframe);
  },
  assertions: [
    ...SHAPE_ASSERTIONS,
    {
      name: "the answer says which series it drew (score or filed)",
      check: (s) => {
        const spine = s.find((x) => x.renderer === "phase-shaded-spine");
        if (spine) {
          const p = spine.payload as { basisNote?: string };
          return p.basisNote && p.basisNote.length > 20 ? null : "the phase spine carries no basis note";
        }
        // The unscored arm states it in the OPENING, which the assertion cannot see — but it must then
        // carry no phase spine at all, which it can.
        return null;
      },
    },
    {
      name: "no pillar is drawn at zero because it could not be scored",
      check: (s) => {
        const spine = s.find((x) => x.renderer === "phase-shaded-spine");
        if (!spine) return null;
        const p = spine.payload as { points?: { pillars?: Record<string, number | null> }[] };
        for (const pt of p.points ?? []) {
          for (const [k, v] of Object.entries(pt.pillars ?? {})) {
            if (v === 0) return `${k} plotted at exactly 0 — a redistributed pillar must be null`;
          }
        }
        return null;
      },
    },
    {
      name: "the phase method is stated on the card, not assumed",
      check: (s) => {
        const spine = s.find((x) => x.renderer === "phase-shaded-spine");
        if (!spine) return null;
        const p = spine.payload as { methodNote?: string };
        return p.methodNote && /quarters/.test(p.methodNote) ? null : "no method note on a derived segmentation";
      },
    },
  ],
};
