// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUBJECT-KIND FAMILIES — instrument · comparison · universe · screen. Stage 7.
//
// ── ★ THESE ARE THE ANSWERS THE PLANNER CANNOT PLAN ───────────────────────────────────────────────
// The planner reads a `CapabilityManifest`, which describes ONE STOCK. A mutual fund has no manifest;
// two companies have two; a screen has none at all. Rather than invent three more manifest shapes so
// the model can choose blocks it was never told about, these are deterministic compositions keyed on
// what the subject IS — §5.3's guaranteed-shape exception, used for the cases where the shape is not
// in question.
//
// ── ★ EACH ONE STATES ITS OWN COVERAGE HALF ───────────────────────────────────────────────────────
// An instrument answer carries `InstrumentCoverage` (no tier — a fund is not on that ladder). A screen
// and a universe scan carry `QueryCoverage` with `subject: null`, because nobody named a subject and
// a tier read off one would describe a company nobody asked about.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { instrumentBlock, fundBlock, comparisonBlock, comparisonMetricsBlock, universeBlock, screenBlock } from "../../compose/blocks-subject.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { nextSection } from "../../section/kinds/anchor.js";
import { resolveComparison } from "../../resolve/blocks-market.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import type { ScreenCondition } from "../../resolve/blocks-market.js";
import type { InstrumentSubjectRef } from "../../resolve/subject.js";
import type { AnySection, AnswerProse } from "../contract.js";
import type { DeclinedFrame } from "../../router/question-shape.js";

export interface MarketTurnResult {
  readonly kind: "composed";
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
  readonly missLogged: boolean;
}

const wrap = (
  id: string, opening: string[], sections: AnySection[], leads: Record<string, string>, close: string,
  /** ★ §4.3 as amended — what each section SHOWED, said after it. Keyed like `leads`, optional. */
  after: Record<string, string> = {},
): MarketTurnResult => ({ kind: "composed", compositionId: id, sections, prose: { opening, leads, after, close }, missLogged: false });

// ═══ INSTRUMENT (+ fund analytics when it is a scheme we compute) ══════════════════════════════════
export async function composeInstrumentAnswer(subject: InstrumentSubjectRef): Promise<MarketTurnResult> {
  const sections: AnySection[] = [coverageSection({ subject: subject.coverage, query: null }) as AnySection];
  const leads: Record<string, string> = {};

  const detail = await instrumentBlock(subject.identifier);
  if (detail) {
    sections.push(detail.section);
    leads[`${detail.section.kind}:${detail.section.renderer}`] = "What it is, and the last value we hold for it.";
  }

  // ★ ANALYTICS ONLY WHERE THEY EXIST. `analytics: false` is not a failure — most non-fund
  //   instruments have no NAV history to compute over, and rendering an empty performance card would
  //   imply we tried and the scheme underperformed.
  let hasAnalytics = false;
  if (subject.coverage.analytics) {
    const fund = await fundBlock(subject.identifier);
    if (fund) {
      hasAnalytics = true;
      sections.push(fund.section);
      leads[`${fund.section.kind}:${fund.section.renderer}`] = "How it has performed, and what that performance cost in volatility.";
    }
  }

  const kind = subject.coverage.instrumentType.replace(/_/g, " ");
  return wrap(
    "instrument.detail",
    [
      `${subject.name} is a ${kind} in our instrument catalogue.`,
      // ⚠ SAID PLAINLY, EVERY TIME. A reader who asked about a fund next to a page full of health
      //   scores will otherwise assume one exists and is merely hidden.
      "We do not score it the way we score a listed company — the health score is built on quarterly results, and this does not file any.",
    ],
    sections,
    leads,
    hasAnalytics
      ? "Those are computed from its own NAV history, not from anything we score."
      : `${blockCopy("instrument_no_analytics")}, so there is nothing here beyond what the catalogue holds.`,
  );
}

// ═══ COMPARISON ════════════════════════════════════════════════════════════════════════════════════
export async function composeComparisonAnswer(a: string, b: string): Promise<MarketTurnResult | null> {
  const r = await resolveComparison(a, b);
  if (!r.ok) return null;
  const d = r.data;

  const sections: AnySection[] = [
    // Two subjects, so `subject` is null — and the reader is told what the answer IS based on rather
    // than which internal field came back empty.
    coverageSection(r.coverage, `${d.left.symbol} and ${d.right.symbol}, both read at their latest filed quarter`) as AnySection,
  ];
  const leads: Record<string, string> = {};
  // ═══ ★★ THE HEALTH SECTION IS OMITTED WHOLE WHEN ONE SIDE IS UNSCORED ═══════════════════════════
  //
  // ⚠ NOT GREYED, NOT HALF-DRAWN, NOT A BAR WITH A CAPTION. `relativeSection` empties the marks on an
  //   incomparable verdict, so the section renders as a titled card with an absent state — and a
  //   reader who sees a card headed "Side by side" with nothing in it reads the blank as zero, and
  //   zero as a verdict about the company. On `one_unscored` there is no chart to draw and no card
  //   worth drawing: what the reader needs is one sentence saying a pillar comparison needs both
  //   stocks scored, and it belongs in the prose where it cannot be mistaken for a figure.
  //
  // ★ `different_groups` STILL RENDERS THE CARD, and the difference is real: there both scores exist
  //   and the reader is entitled to know they exist and why they are not being placed side by side.
  const omitHealth = !d.comparable && (d.reason === "one_unscored" || d.reason === "neither_scored");
  const block = omitHealth ? null : await comparisonBlock(a, b);
  if (block) {
    sections.push(block.section);
    // ★ INDEXED: this answer has TWO `RELATIVE:opposed-bars`, so the plain key collides. See
    //   AnswerProse.leads.
    leads[`${block.section.kind}:${block.section.renderer}#${sections.length - 1}`] = d.comparable
      ? "Both scores, on the same scale, because both are judged against the same set."
      : "The scores are held, and they are not on one scale — see why below.";
  }
  // ★ THE PAIRED METRICS — its own section because its own axis. See comparisonMetricsBlock.
  const metrics = await comparisonMetricsBlock(a, b);
  let metricsKey: string | null = null;
  if (metrics) {
    sections.push(metrics.section);
    metricsKey = `${metrics.section.kind}:${metrics.section.renderer}#${sections.length - 1}`;
    leads[metricsKey] =
      "Underneath the scores, the measures they are computed from — the same line for each company.";
  }

  // ── §4.3 AS AMENDED: WHAT THE CHARTS SHOWED ─────────────────────────────────────────────────────
  // ★ THE PILLAR GAP IS THE ANSWER TO "COMPARE THEM", AND IT WAS NEVER STATED. Two composites tell a
  //   reader which is higher, which they can see. WHERE the two differ is the thing they cannot, and
  //   it is computable: the pillar with the widest gap is where the comparison actually lives.
  const PILLARS = ["foundation", "momentum", "market", "ownership"] as const;
  const gaps = PILLARS
    .map((k) => ({ k, a: d.left.pillars[k], b: d.right.pillars[k] }))
    .filter((g): g is { k: typeof PILLARS[number]; a: number; b: number } => g.a !== null && g.b !== null)
    .map((g) => ({ ...g, gap: Math.abs(g.a - g.b) }))
    .sort((x, y) => y.gap - x.gap);
  const widest = gaps[0];
  const after: Record<string, string> = {};
  if (d.comparable && widest && widest.gap >= 1) {
    const ahead = widest.a > widest.b ? d.left : d.right;
    const behind = widest.a > widest.b ? d.right : d.left;
    // The pillar conclusion belongs under the SCORE chart (index 1), not under the percentages.
    after["RELATIVE:opposed-bars#1"] =
      `The two are furthest apart on ${widest.k}, where ${ahead.name} leads ${behind.name} — that pillar is where the ` +
      `difference between these scores actually sits, and the ${gaps.length > 1 ? "others are closer together" : "rest we do not hold for both"}.` +
      (d.left.rank && d.right.rank
        ? ` Inside their shared peer group they rank ${d.left.symbol} ${d.left.rank.rank} of ${d.left.rank.outOf} and ${d.right.symbol} ${d.right.rank.rank} of ${d.right.rank.outOf}.`
        : "");
  } else if (d.comparable && gaps.length > 0) {
    after["RELATIVE:opposed-bars#1"] =
      "No pillar separates them by much, so the two scores are close for the same reasons rather than for different ones offsetting each other.";
  }

  if (metricsKey && metrics) {
    after[metricsKey] = d.comparable
      ? "These are the universal measures — the ones defined the same way for both companies, so a gap here is a gap in the thing itself rather than in how it is reported."
      : "These lines are defined the same way for both, which is why they are drawn at all when the scores are not. Everything family-specific is left out rather than paired across shapes it does not fit.";
  }

  sections.push(nextSection(a, { scored: true, findings: [], pledged: false, instSold: false, thin: false, marginFell: false }) as AnySection);
  leads.NEXT = "If either side raised a question, these follow it.";

  const opening = [
    `${d.left.name} and ${d.right.name}, side by side.`,
    // ★ THE VERDICT LEADS. It is the thing a reader cannot derive from two numbers, and putting it
    //   after the bars means they have already compared them.
    //
    // ⚠ AND IT NAMES WHICH DECLINE THIS IS. One sentence served all three until Batch 2 — "judged
    //   against different peer sets" — which is true of the third case and misleading about the
    //   first two, because it sends a reader looking for a comparison that exists nowhere.
    d.comparable
      ? `They share a peer group, so the two scores mean the same thing.`
      : `⚠ There is no health comparison to draw here: ${d.basis}.`,
  ];
  if (omitHealth) {
    // ★★ THE ONE LINE THAT REPLACES THE OMITTED SECTION. It says what is missing and why, in words,
    //    which is what N-4 asks for — and it says it where a blank card would otherwise have been.
    opening.push(
      `A pillar-by-pillar comparison needs both companies scored, so there is no score chart below — ` +
      `${d.reason === "neither_scored" ? "neither side has one" : "one side has none"}. ` +
      `What both sides do have is what they filed, and that is what is compared instead.`,
    );
  }
  // ★ THE SERVICE'S OWN COMPARABILITY BOUNDARIES, SAID RATHER THAN DROPPED. `buildComparisonView`
  //   computes them precisely because two companies can be paired on a page and still not line up.
  if (d.warnings.length > 0) opening.push(d.warnings.slice(0, 2).join(" "));

  return wrap(
    "market.comparison",
    opening,
    sections,
    leads,
    d.comparable
      ? "Same reference set, so the gap between them is a real gap."
      : omitHealth
        ? "The filed figures above are defined the same way for both, which is why they are drawn at all. A score comparison is not missing from this answer — it does not exist to be drawn."
        : "Put side by side anyway, the two numbers would look comparable and would not be. That is why the bars are not drawn.",
    after,
  );
}

// ═══ UNIVERSE SCAN ═════════════════════════════════════════════════════════════════════════════════
export async function composeUniverseAnswer(): Promise<MarketTurnResult | null> {
  const block = await universeBlock();
  if (!block) return null;
  const sections: AnySection[] = [coverageSection(block.coverage, "The scored universe, as a whole") as AnySection, block.section];
  return wrap(
    "market.universe",
    ["Here is the market as we score it."],
    sections,
    { [`${block.section.kind}:${block.section.renderer}`]: "Every scored company, spread across the health bands." },
    // ⚠ THE MIXED-PERIOD CAVEAT IS PART OF THE ANSWER, not a footnote. Roughly a third of the
    //   universe sits at an earlier quarter than the label, and "as of FY27Q1, N stocks are X" is
    //   false about those.
    "Each company sits at its own most recent reported quarter, so this is a cross-section of latest readings rather than of one date.",
  );
}


// ═══ ★★ THE FRAME DECLINE — SC-05 AND SC-12 ═══════════════════════════════════════════════════════
//
// "Show me undervalued stocks" and "what are the best stocks to buy" are legitimate questions with a
// frame we do not answer in. The bank calls them DECLINES rather than refusals, and both were being
// mishandled in opposite directions — see `question-shape.ts#declinedFrame` for what each did.
//
// ★ THE SHAPE: DECLINE THE WORD, NAME WHAT WE SUBSTITUTED, THEN GIVE THE SUBSTANCE. It is the same
//   move `DECLINE_ADVICE` already makes for "should I buy TCS?" — refuse the frame in one breath and
//   answer the answerable part in the next — because a refusal on its own is the least useful true
//   sentence available.
//
// ⚠ THE BASIS IS PROMINENT BECAUSE THE CRITERION THE READER GOT IS NOT THE ONE THEY TYPED. It leads
//   the opening, it is the coverage label, and it closes the answer. A substituted criterion stated
//   once at the bottom is a footnote on a list the reader has already read as their answer.
//
// ⚠ AND THE SUBSTITUTE IS A RANKING, NEVER AN INVENTED CUT-OFF. `screenUniverse` with zero conditions
//   returns the scored universe ordered by health — measured: 95 considered, sorted "health score,
//   highest first". Picking a threshold here would be a number nobody typed selecting the rows the
//   reader then reads as the answer, which is the whole reason conditions are code-extracted (§6.5).
const FRAME_COPY: Record<DeclinedFrame, { decline: string; basis: string; coverage: string }> = {
  valuation: {
    decline:
      "We do not publish a view on whether a share is cheap or expensive, and in this case we could " +
      "not filter on one even if we did: nothing in the screen is a price multiple.",
    basis:
      "Every field a screen can filter on is a reading of the filings — returns, margins, leverage, " +
      "the health score. There is no price-to-earnings, no price-to-book, no market cap. So what " +
      "follows is ranked on financial health, which is a different question from what a share costs.",
    coverage: "The scored universe, ranked on health — not on price",
  },
  superlative: {
    decline:
      "“Best” is a conclusion, and we publish readings rather than conclusions — what counts as best " +
      "depends on what you already own, your horizon and your tax position, none of which we hold.",
    basis:
      "What we can do is rank by our health score, which is a reading of what these companies have " +
      "filed. A high score is not a recommendation and a low one is not a warning.",
    coverage: "The scored universe, ranked highest health score first",
  },
};

/**
 * The answer to a question whose frame we decline. Runs the real screen underneath it.
 *
 * ⚠ IT IS AN ANSWER, NOT A STOP. §6.3's `out_of_scope` branch is "one line, no improvisation", and
 *   that is right for a question about a celebrity. This is a question about Indian listed companies
 *   asked in words we will not use, which is a different thing entirely.
 */
export async function composeFrameDeclinedScreen(frame: DeclinedFrame): Promise<MarketTurnResult | null> {
  const copy = FRAME_COPY[frame];
  // Zero conditions ⇒ the ranked universe, capped by the projection itself. No invented threshold.
  const block = await screenBlock([], "ranking");
  if (!block) return null;

  const sections: AnySection[] = [coverageSection(block.coverage, copy.coverage) as AnySection, block.section];
  return wrap(
    `market.screen.declined.${frame}`,
    [
      // ★ THE DECLINE LEADS. Placed after the list it reads as a disclaimer on an answer we already
      //   gave; placed first it is the answer to the question actually asked.
      copy.decline,
      copy.basis,
    ],
    sections,
    {
      [`${block.section.kind}:${block.section.renderer}`]:
        "Every company we score, highest health score first — a ranking of the whole set rather than a filter over it.",
    },
    `That list answers a question about financial health. It is not the question you asked, and the ` +
    `difference is the point: a ranking we can stand behind is worth more than a verdict we cannot.`,
    {
      [`${block.section.kind}:${block.section.renderer}`]:
        "Nothing has been filtered out — these are the highest-scoring of everything we score, so a " +
        "company missing from the list scores lower rather than having failed a test.",
    },
  );
}

// ═══ SCREEN ════════════════════════════════════════════════════════════════════════════════════════
export async function composeScreenAnswer(conditions: readonly ScreenCondition[]): Promise<MarketTurnResult | null> {
  const block = await screenBlock(conditions);
  if (!block) return null;
  const sections: AnySection[] = [coverageSection(block.coverage, "A filter across the scored universe") as AnySection, block.section];
  return wrap(
    "market.screen",
    ["Here is what matched."],
    sections,
    { [`${block.section.kind}:${block.section.renderer}`]: "The companies meeting every condition, best health score first." },
    "A screen is a filter over what we hold — a company missing the figure a condition names was never in the running, and the count above says how many that was.",
  );
}
