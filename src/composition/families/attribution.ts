// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: A · ATTRIBUTION — "why is it scored that way", "what is dragging it down".
//
// The family that justifies the product. §0.1's own worked example is here, and the claim the whole
// build rests on is that a score which can explain itself is worth more than a score.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE §4.1 TEST, RUN A FIFTH TIME — AND THE ANSWER IS "ONE COMPOSITION, AND IT **REPLACES** ONE".
//
// ⚠ THE FIRST THING THE TEST FOUND WAS NOT A SHAPE QUESTION. IT WAS THAT THIS QUESTION ALREADY HAS A
//   COMPOSITION. `orientation.scored` claims `{operation: [orient, decompose], lens: [health]}` and its
//   own first example is the literal string "why is TCS scored the way it is". Registering an
//   attribution family beside it would put TWO compositions behind ONE predicate, and the registry is
//   an ORDERED array — so which answer a reader got would depend on array position, with nothing in
//   either file saying so. That is precisely the hazard `Predicate.subject` was added in batch 1 to
//   remove, arriving through a different door.
//
// ★ SO THIS FILE IS A REPLACEMENT, NOT AN ADDITION — the same move `ownership` took in batch 1.
//   `orientation.scored` is deleted in the same commit; `orientation.company` (the BROAD question,
//   `lens: null`) is untouched and still renders the four-pillar waterfall as one section among five.
//   That is not a duplicate: the pillar anatomy inside a whole-company answer and the field-level walk
//   inside a "why" answer are different grains of a different question, and only one file owns each.
//
// ── AND THEN THE ORDINARY TEST, WHICH GAVE "ONE COMPOSITION, NO PARAMETER" ────────────────────────
//   "why is TCS scored 65"           the walk
//   "what is dragging LT down"       the walk, top row first — which it already is
//   "which part carries HDFCBANK"    the walk, read by group rather than by bar
//   "why did LT's score fall"        ★ THE CHANGE BRIDGE — built at Phase 2 · Batch 2, once the
//                                      Operator ruled `margin-walk` → `bridge`. It is the same
//                                      family and a THIRD lead, not a fourth composition: the walk
//                                      and the bridge are two views of one score and a reader who
//                                      asks "why did it fall" wants both, in that order.
// The first three read one source and want one sequence. PG's answer, for PG's reason.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── SECTION ORDER, AND WHY ────────────────────────────────────────────────────────────────────────
//   COVERAGE      : coverage-header    what we hold (N-6)
//   DECOMPOSITION : waterfall          the WALK — 100 down to the score, one bar per measure, grouped
//   NEXT          : chips
//
// ⚠ ONE EVIDENCE SECTION, AND THE FIRST DRAFT HAD TWO. It opened with a four-pillar frame above the
//   field walk, and that is wrong for a reason worth keeping: a reader shown two bar charts of the
//   same score has to work out which one IS the score. The pillar structure is not a second answer,
//   it is the GROUPING of the first — so it moved into `WaterfallPayload.groups` and the second card
//   went away. Fifteen ungrouped bars would have been the other error.
//
// ★ AND ONE SECTION IS NOT A THIN ANSWER HERE, BECAUSE THE PROSE IS THE PRODUCT. The brief is explicit
//   — "a waterfall with three sentences under it is not what this family is for" — and §4.3 as amended
//   says prose carries the reasoning while sections carry the evidence. The evidence for "why is this
//   score what it is" is one walk. The reasoning is four paragraphs, and it is what a reader keeps.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveAttribution, type AttributionRead } from "../../resolve/attribution.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { shortfallSection, bridgeSection } from "../../section/kinds/decomposition.js";
import { resolveScoreChange } from "../../resolve/trajectory.js";
import { stockCoverage } from "../../resolve/contract.js";
import { buildAnswer, SHAPE_ASSERTIONS, type Block } from "../answer.js";
import { healthQuestion } from "../../router/question-shape.js";
import type { AnySection, Composition } from "../contract.js";

const pts = (v: number) => `${v.toFixed(1)} points`;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ WHICH SENTENCE LEADS — AND `I-DISTINCT` IS WHY THIS EXISTS RATHER THAN A DESIGN NOTE.
 *
 * ⚠ THE FIRST DRAFT HAD NO LEAD AND THE HARNESS CAUGHT IT: *"why is TCS scored the way it is"* and
 *   *"what is dragging TCS's score down"* produced BYTE-IDENTICAL answers, three sections and the same
 *   prose. They are not the same question. The first asks what the score is made of and expects the
 *   whole picture; the second has already accepted the score and wants the things costing it.
 *
 * ★ IT IS PROSE ORDER ONLY, exactly as `peerLead` and `trajectoryLead` are — the walk is the same walk
 *   and the ordering inside it is "largest drag first" either way. What changes is which fact the
 *   reader is given first, and on `drag` the standing is demoted to context rather than dropped, so
 *   the §4.3 test still holds: read only the sentences and the answer is complete.
 *
 * ⚠ AND IT IS CODE-EXTRACTED FROM THE SENTENCE (§6.5), not a slot. Both questions arrive as
 *   `decompose · health` or `orient · health` depending on the roll; no slot separates them and none
 *   should be asked to.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export type AttributionLead = "standing" | "drag" | "change";

const DRAG_WORDS = ["dragging", "drag", "drags", "hurting", "holding", "costing", "weakest", "worst", "problem"];
/**
 * ★★ THE THIRD LEAD — "why did it FALL", added Phase 2 · Batch 2 with `bridge`.
 *
 * ⚠ IT IS A DIFFERENT QUESTION FROM THE OTHER TWO AND IT WAS BEING ANSWERED AS ONE OF THEM. "Why is
 *   TCS scored 65" asks what the score is made of; "why did LT's score fall 19 points" asks what
 *   MOVED it. Batch 1 raised this and could not build it, because the honest decomposition of a move
 *   splits each part in two and `WaterfallPayload` had nowhere to put the second half. `bridge` does.
 *
 * ⚠ "down" IS NOT IN EITHER LIST ANY MORE. It was a DRAG word and it is the commonest way a reader
 *   says CHANGE — "why did TCS go down", "what brought it down". A word that fits both lists belongs
 *   in the more specific one, and here the tell is a past-tense verb of motion rather than the word
 *   "down" itself.
 */
const CHANGE_WORDS = [
  "fall", "fell", "fallen", "drop", "dropped", "rose", "rise", "risen", "jumped", "slipped",
  "changed", "change", "moved", "move", "went", "gone", "lost", "gained", "improved", "worsened",
];

export function attributionLead(raw: string): AttributionLead {
  const w = new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));
  // ★ CHANGE IS TESTED FIRST. "What dragged TCS down last quarter" carries both a drag word and a
  //   change word, and the reader is asking about the move — the drags are what they want ATTRIBUTED
  //   to it, not listed at the current reading.
  if (CHANGE_WORDS.some((x) => w.has(x))) return "change";
  return DRAG_WORDS.some((x) => w.has(x)) ? "drag" : "standing";
}

/**
 * ★ THE MECHANISM SENTENCE — "what is happening in the business", never "what happens to the stock".
 *
 * ⚠ THIS IS WHERE PART 4's FORWARD-LANGUAGE BAN BITES HARDEST, because the shape of the answer invites
 *   the violation. A reader asking "what is dragging this down" is one clause away from being told
 *   what to do about it, and the honest sentence is always about the FILING: a cost-to-income ratio at
 *   the distress end of its range is a fact about how much of this bank's income its operations
 *   consume. `verify-copy-register.ts` and `verify-trajectory.ts` both scan for the other kind.
 */
function mechanismOf(b: AttributionRead["bars"][number]): string | null {
  if (b.gap === null || b.grain !== "field" || b.band === null) return null;
  const landing = b.band.replace(/_/g, " ");
  return `${b.label} is the largest of those, landing in the ${landing} part of its range and costing ` +
    `${pts(b.gap)} of the ${pts(b.ceilingShare)} it could have accounted for.`;
}

export const attribution: Composition = {
  id: "attribution.score",
  family: "attribution",
  /**
   * ⚠ IT CLAIMS BOTH `orient` AND `decompose`, INHERITED FROM WHAT IT REPLACES AND KEPT ON PURPOSE.
   *   §6.5 measured the live router at 80–88% run-to-run agreement, and "why is TCS scored the way it
   *   is" is exactly the sentence that lands on `orient · health` on one roll and `decompose · health`
   *   on the next. A family claiming one of them answers the question half the time.
   */
  when: {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ `explain` IS HERE BECAUSE THE LIVE ROUTER USES IT AND NOTHING ON THE HEALTH LENS CLAIMED IT.
    //
    // ⚠ MEASURED, NOT REASONED. `verify:ux`'s U12 read "no shortfall section found — the A renderer
    //   is UNEXERCISED in the browser", and the first assumption was that this batch's `decompose`
    //   change had stolen the question. It had not. Routing "why is INDUSINDBK scored the way it is"
    //   through the MODEL classifier three times returned `operation: "explain", lens: "health"`
    //   every time — an operation this family had never claimed — so the question fell to the
    //   PLANNER, which assembled a creditable answer with a waterfall in it and none of the authored
    //   shortfall copy. A gate that reads the copy is why anyone noticed.
    //
    // ★ THE LEXICAL PATH SAYS `decompose` FOR THE SAME SENTENCE. That disagreement is exactly what
    //   §6.5 describes and exactly why a family claims a SET of operations rather than one: the two
    //   classifiers may name the same intent differently, and both names have to lead here.
    //
    // ⚠ IT CANNOT LEAK. `meta` claims `explain` with `subject: "none"` and a definition guard;
    //   `patterns` claims it behind a findings guard; both sit after this family. The health-lens
    //   split with `trajectory` is unchanged and is still `healthQuestion`, below.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ⚠ `lookup` ADDED BY THE VERIFICATION PASS, AND MEASURED RATHER THAN GUESSED. "How healthy is
    //   TCS" rolls `lookup/health` FOUR TIMES IN FIVE against `orient/health` once (30 live rolls,
    //   ROUTER_CACHE=off). `lookup` was claimed by no health-lens family, so four readers in five got
    //   a PLANNER answer to the plainest health question in the product. Phase 3 wrote that "the model
    //   classifier is expected to resolve it" — it does, to a value nothing claimed.
    operation: ["orient", "decompose", "explain", "lookup"], lens: ["health"], subject: "required",
    /**
     * ⚠ `minTier: 1`, NOT 2, AND IT WAS 2 UNTIL THE COMPOSED OUTPUT WAS READ. With a floor of 2 a
     *   tier-1 subject never reached this file, so the authored "we do not score this company"
     *   branch below was dead code and the question fell to the PLANNER — which answered "why is
     *   BAJFINANCE scored the way it is" with *"Evaluating the health score of Bajaj Finance Limited
     *   requires looking across its multi-quarter financial trajectory"* and closed with "specific
     *   pillar breakdowns remain unavailable". Every clause of that implies a score exists. The
     *   honest answer to a why-question about an unscored company is that there is no score, and
     *   only this family can say it, so it has to be allowed to see the subject.
     */
    minTier: 1,
    // ★ THE OTHER HALF OF THE PARTITION — see `trajectory.ts` and `healthQuestion`'s header. This is
    //   the DEFAULT arm: an un-narrowed health question is a question about where a company stands.
    question: (raw) => healthQuestion(raw) === "attribution",
  },
  examples: [
    "why is TCS scored the way it is",
    "what is dragging LT's score down",
    "which part of HDFCBANK's score is doing the work",
    "how healthy is RELIANCE",
  ],
  build: async (ctx) => {
    const symbol = ctx.symbol!;
    const [cov, att] = await Promise.all([resolveStockCoverage(symbol), resolveAttribution(symbol)]);
    const coverage = cov.coverage;
    const d = att.ok ? att.data : null;

    if (!d) {
      // ⚠ AN ABSENT ANSWER STILL HAS TO SAY WHAT WE DO HOLD. The first draft of this branch was two
      //   sentences about a missing score and nothing else, on a company we hold 32 quarters of
      //   filings for. "We cannot answer that" and "we cannot answer that, and here is what we can"
      //   are different products, and only the second is true of BAJFINANCE.
      const quarters = stockCoverage(coverage)?.depth.quarters ?? 0;
      return buildAnswer({
        coverage,
        opening: [
          `We have not scored ${symbol}, so there is no breakdown to explain — the walk this question ` +
          `asks for starts from a score, and there is not one.`,
          quarters > 0
            ? `That is a gap in our coverage rather than a gap in the company's reporting: we hold ` +
              `${quarters} quarter${quarters === 1 ? "" : "s"} of its filed results, and every ` +
              `figure in them is available. What is missing is our own reading laid over them.`
            : `We hold no quarterly results for it either, so there is nothing behind the missing ` +
              `score to fall back on.`,
        ],
        blocks: [],
        conclusion: quarters > 0
          ? `In short: no score, and therefore no attribution — but ${quarters} filed quarters that ` +
            `answer most of the same questions directly. That is a coverage gap on our side, not a ` +
            `judgement about the company.`
          : `We hold no score for ${symbol}. That is a coverage gap on our side, not a judgement ` +
            `about the company.`,
        symbol,
        signals: { scored: false, findings: [], pledged: false, instSold: false, thin: true, marginFell: false },
      });
    }

    const drawn = d.bars.filter((b) => b.gap !== null);
    const top = drawn[0] ?? null;
    const missing = d.bars.filter((b) => b.gap === null);
    const fields = drawn.filter((b) => b.grain === "field");
    const distance = Math.round((d.ceiling - d.composite) * 100) / 100;

    // ── THE OPENING. §4.3's test is that the sentences alone are a complete and true answer, so both
    //    orders state the score, the distance from a perfect reading, and what most of that distance
    //    is made of. They differ in which comes first, and on `drag` the standing is demoted to a
    //    clause rather than dropped.
    const lead = attributionLead(ctx.turn.raw);
    const standingSentence =
      `${symbol} scores ${d.composite.toFixed(1)} out of 100 for ${d.periodKey}, which reads as ` +
      `${d.bandLabel.toLowerCase()}. The interesting number is the other one: it is ` +
      `${pts(distance)} short of a perfect reading, and that shortfall is made of specific things.`;
    const dragSentence = top && top.gap !== null
      ? `The single biggest thing costing ${symbol} is ${top.label}, at ${pts(top.gap)} of the ` +
        `${pts(top.ceilingShare)} it could have accounted for — against a score of ` +
        `${d.composite.toFixed(1)} out of 100, which reads as ${d.bandLabel.toLowerCase()}.`
      : standingSentence;

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ THE CHANGE BRIDGE — raised at batch 1, ruled and built at batch 2.
    //
    // It leads on a change question and is OMITTED entirely otherwise, rather than always drawn: a
    // reader asking what a score is made of has not asked what moved it, and two decompositions of
    // one number is the "which one IS the score" problem this family already solved once by putting
    // the pillar frame inside the walk rather than beside it.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const change = lead === "change" ? await resolveScoreChange(symbol) : null;
    const changeSection = change ? (bridgeSection(change) as AnySection) : null;
    const cd = change?.ok ? change.data : null;

    // ⚠ THE CHANGE LEAD NEEDS ITS OWN OPENING AND THE FIRST DRAFT REUSED THE STANDING ONE. A reader
    //   who asked "why did LT's score fall" was answered with "the largest single drag is Market,
    //   which costs 5.8 points" — a true sentence about the current reading and not an answer to the
    //   question. `changeSentence` is built after `change` resolves, so it is assembled below.
    const changeSentence = cd
      ? `${symbol} ${cd.delta < 0 ? "fell" : cd.delta > 0 ? "rose" : "held"} `
        + `${Math.abs(cd.delta).toFixed(1)} point${Math.abs(cd.delta) === 1 ? "" : "s"} between `
        + `${cd.fromPeriod} and ${cd.toPeriod}, from ${cd.fromComposite.toFixed(1)} to `
        + `${cd.toComposite.toFixed(1)}`
        + (cd.fromBandLabel !== cd.toBandLabel
          ? ` — which moved it from ${cd.fromBandLabel.toLowerCase()} to ${cd.toBandLabel.toLowerCase()}.`
          : `, without changing its label.`)
      : lead === "change"
        // ⚠ AN HONEST DECLINE, NOT A SILENT FALLBACK TO THE STANDING ANSWER. If a reader asked what
        //   moved the score and we cannot say, the answer must say that before it says anything else.
        ? `We hold too few scored quarters for ${symbol} to say what moved its score, so what follows `
          + `is where the score stands rather than how it got there.`
        : null;

    const opening: string[] = [
      lead === "change" && changeSentence ? changeSentence
        : lead === "drag" ? dragSentence
        : standingSentence,
    ];
    // On a change question the standing reading is the SECOND sentence, not the missing one — a move
    // with no level is half a fact.
    if (lead === "change" && changeSentence) opening.push(standingSentence);
    if (top && top.gap !== null && lead !== "drag") {
      const mech = mechanismOf(top);
      opening.push(mech ??
        `The largest single drag is ${top.label}, which costs ${pts(top.gap)} of the ` +
        `${pts(top.ceilingShare)} it could have accounted for.`);
    }
    // ⚠ THE GRAIN CAVEAT RUNS ON BOTH LEADS. The bars are not all the same grain and the top one is
    //   usually the coarse kind — Market and Ownership are whole pillars at a fifth of the score each,
    //   a Foundation field is a seventh of a third. So "the biggest thing costing you" almost always
    //   names a pillar, and a reader takes that as "Market is the problem" when the honest reading is
    //   "Market covers more ground". This is what stops the ordering from quietly becoming a verdict,
    //   and it matters MORE on the `drag` lead, where that ordering is the opening sentence.
    if (top && top.gap !== null && top.grain === "pillar" && fields.length > 0) {
      const topField = fields[0];
      const landing = topField.band;
      opening.push(
        `${top.label} covers more ground than any single measure does, which is part of why it sits ` +
        `at the top — it is ${Math.round(top.ceilingShare)}% of the score in one bar. Of the ` +
        `individual measures we can open up, ${topField.label} costs the most at ${pts(topField.gap!)}` +
        (landing ? `, landing in the ${landing.replace(/_/g, " ")} part of its range.` : `.`),
      );
    }
    if (missing.length) {
      // ⚠ THE REDISTRIBUTION IS IN THE OPENING, NOT IN A FOOTNOTE. A reader who does not know that a
      //   part was unmeasurable will read every other bar as its nominal weight, and every other bar
      //   is bigger than its nominal weight precisely because of it.
      opening.push(d.redistributionNote ??
        `${missing.map((m) => m.label).join(" and ")} could not be scored this period.`);
    }
    if (!d.reconciles) {
      // ★ THE ANSWER SAYS SO RATHER THAN DRAWING A WALK THAT DOES NOT CLOSE. This is the one branch
      //   here that is about our own machinery, and it earns its place: the alternative is a chart
      //   whose bars silently do not add up to the number above them.
      opening.push(
        `One caution before the chart: the parts below account for ${pts(d.gapAccountedFor)} of the ` +
        `${pts(distance)} shortfall, so ${Math.abs(d.residual).toFixed(2)} points are unaccounted for. ` +
        `Read the ordering rather than the totals until that is resolved.`,
      );
    }

    const walk = shortfallSection(att) as AnySection;


    const blocks: Block[] = [
      ...(changeSection
        ? [{
            lead: cd
              ? `${symbol} went from ${cd.fromComposite.toFixed(1)} at ${cd.fromPeriod} to `
                + `${cd.toComposite.toFixed(1)} at ${cd.toPeriod}. This is where that ${Math.abs(cd.delta).toFixed(1)} `
                + `points went.`
              : `We hold too little history for ${symbol} to show what moved the score.`,
            section: changeSection,
            after: cd?.basisSentence,
          }]
        : []),
      {
        lead: `Inside those parts, each measure starts at a perfect 100 and gives back what it scored. ` +
          `What is left is the distance from 100 down to ${d.composite.toFixed(1)}, and this is where it went.`,
        section: walk,
        after: fields.length > 0
          // ⚠ D-2 IS DECLINED AND THE ANSWER SAYS WHAT IT THEREFORE DOES NOT SHOW, rather than leaving
          //   a reader to notice. Naming the omission is cheaper than the reader deriving a threshold
          //   from the bar heights and getting it wrong.
          ? `Each measure is scored against a band we hold for its industry and size. What is shown ` +
            `here is where the company landed in that band, not the cut-off it was measured against.`
          : undefined,
      },
    ];

    const carrying = d.pillars
      .filter((p) => p.subtotal !== null)
      .sort((a, b) => (b.subtotal! * b.weightApplied) - (a.subtotal! * a.weightApplied))[0] ?? null;

    return buildAnswer({
      coverage,
      opening,
      blocks,
      conclusion: lead === "drag"
        ? `In short: ${top && top.gap !== null ? `${top.label} is what costs ${symbol} most` : `no single measure dominates`}` +
          (carrying ? `, and ${carrying.label} is what is holding the score up` : "") +
          `. This describes what has been filed, not what happens next.`
        : `In short: ${symbol} reads ${d.bandLabel.toLowerCase()} because ` +
          (carrying ? `${carrying.label} carries most of what it does have` : `of the parts shown above`) +
          (top && top.gap !== null ? `, while ${top.label} costs it the most` : "") +
          `. This describes what has been filed, not what happens next.`,
      symbol,
      signals: {
        scored: true,
        findings: [],
        pledged: false,
        instSold: false,
        thin: (stockCoverage(coverage)?.depth.quarters ?? 0) < 8,
        marginFell: false,
      },
    });
  },
  assertions: [
    ...SHAPE_ASSERTIONS,
    {
      name: "the walk reconciles, or the answer says it does not",
      check: (s) => {
        const w = s.find((x) => x.kind === "DECOMPOSITION" && x.renderer === "waterfall"
          && (x.payload as { basis?: string } | null)?.basis === "shortfall");
        if (!w) return null;
        const p = w.payload as { reconciles: boolean; residual: number };
        if (p.reconciles) return null;
        const said = w.digest.groups.some((g) => g.lines.some((l) => l.state === "absent" && /unexplained/.test(l.value)));
        return said ? null : `the walk is off by ${p.residual} and nothing says so`;
      },
    },
    {
      name: "no measure that could not be scored is drawn at zero (#5)",
      check: (s) => {
        for (const sec of s) {
          if (sec.kind !== "DECOMPOSITION") continue;
          const p = sec.payload as { bars?: { label: string; state: string; gap?: number | null; value: number | null }[] } | null;
          for (const b of p?.bars ?? []) {
            if (b.state !== "scored" && (b.gap === 0 || b.value === 0)) {
              return `${b.label} is ${b.state} and drawn at 0 — that reads as "perfect", not as "unmeasured"`;
            }
          }
        }
        return null;
      },
    },
    {
      name: "a redistributed weight is stated, not left in the arithmetic",
      check: (s) => {
        for (const sec of s) {
          if (sec.kind !== "DECOMPOSITION") continue;
          const p = sec.payload as { bars?: { state: string }[]; redistributionNote?: string | null } | null;
          if (!p) continue;
          const hasMissing = (p.bars ?? []).some((b) => b.state === "unavailable_redistributed");
          if (hasMissing && !p.redistributionNote) return "a pillar was redistributed and the payload carries no sentence for it";
        }
        return null;
      },
    },
    {
      name: "no reader-facing string is a raw engine token",
      check: (s) => {
        for (const sec of s) {
          const p = sec.payload as { redistributionNote?: string | null; walkNote?: string } | null;
          for (const v of [p?.redistributionNote, p?.walkNote]) {
            if (typeof v === "string" && /\b(missing_pillar|market_unavailable|unavailable_redistributed|not_scored)\b/.test(v)) {
              return `an engine token reached a reader-facing string: ${v.slice(0, 60)}`;
            }
          }
        }
        return null;
      },
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ RAISED AT BATCH 1, RULED AND BUILT AT BATCH 2 — "WHY DID THE SCORE FALL".
//
// The gap this note used to describe is closed. What is worth keeping is WHY the obvious build was
// wrong, because the naive version is easy, looks right, and misattributes the best example in the
// data.
//
// LT, FY26Q3 → FY26Q4: the composite falls 75.4 → 56.1. Each pillar's contribution now minus then:
//
//     Foundation  30.0 → 19.3   −10.7        Market      24.6 → 11.8   −12.8
//     Momentum     0.0 →  9.9    +9.9        Ownership   20.8 → 15.0    −5.8
//
// A reader shown that concludes Market and Foundation collapsed. They did not. Momentum had been
// UNSCORABLE for four quarters with its 0.25 weight carried by the other three; when it came back the
// weights snapped to standard. Measured through the built split: Foundation's −10.7 is −4.3 from its
// own reading and −6.4 from its share shrinking; Ownership's −5.8 is −0.8 and −5.0. The naive chart
// blames two pillars for moves they did not make.
//
//     Δ(s·w)  =  Δs · w_before   +   s_after · Δw          ← exact, and both halves are drawn
//
// ⚠ AND THE ARITHMETIC TURNED OUT TO BE THE EASY HALF. Where a pillar crosses INTO or OUT OF being
//   scorable, both terms stay exact and both become fiction — the stored subtotal of an unscorable
//   pillar is 0, so "its reading did not move" (Momentum, coming back) and "its reading fell 17.3"
//   (VEDL's Market, going away) are what the identity produces and neither is true about the business.
//   `ChangeStep.crossing` marks those; the split is suppressed and the note carries the only
//   description that holds. That is the zero-for-unknown defect resurfacing one level up, inside a
//   delta, where two guards against it already existed and neither reached.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
