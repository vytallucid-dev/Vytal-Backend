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
import { instrumentBlock, fundBlock, comparisonBlock, comparisonMetricsBlock, universeBlock, screenBlock, findingScreenBlock, lineItemScreenBlock } from "../../compose/blocks-subject.js";
import { resolveLineItemScreen } from "../../resolve/line-item-screen.js";
import type { LineItemCondition } from "../line-item-conditions.js";
import { resolveFindingScreen } from "../../resolve/blocks-market.js";
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
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ A COUNT IS A LEGITIMATE ANSWER SHAPE, AND IT IS THE SAME SET REPORTED SIZE-FIRST.
//
// "How many stocks are in the pristine band" wants A NUMBER and the set behind it. Neither of the two
// things it must not get is hypothetical:
//   · a refusal — the question is perfectly answerable and it names a term we publish;
//   · a silent conversion into a list of twelve — `LIST_CAP` is 12, so a reader who asked "how many"
//     and received twelve rows with no total has been answered with a number that is not the answer.
//
// ⚠ SO THE SHAPE CHANGES THE PROSE AND THE ORDER, AND NOTHING ELSE. Same filter, same denominator,
//   same bounded set, same coverage. `screenAsk` decides it from the sentence; a count and a list of
//   the same screen return the same rows, and the count is stated in words AND on the card so the two
//   cannot disagree (§4.3's amendment).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ A COUNT IS A NUMBER A READER READS, so it is grouped like every other one in this layer
 *   (`compose/blocks.ts` uses en-IN throughout). "2291 companies we hold" is four digits a reader has
 *   to parse; "2,291" is a figure they can see. It matters most exactly where these counts are
 *   largest, which is the finding screen.
 */
const n = (x: number): string => x.toLocaleString("en-IN");

/**
 * The bound, said out loud wherever the carried set is smaller than the matched set.
 *
 * ⚠ IT IS A TRANSPORT BOUND, NOT A DISPLAY ONE, AND THE WORDING HAD TO FOLLOW THE TABLE. It used to
 *   say "the list is capped at 12 so it stays readable" — true when twelve rows were all that
 *   existed and the reader could see every one of them at once. The table now PAGES, so the reader
 *   can reach every row it carries, and the honest sentence is about what the card holds rather than
 *   about what is on screen this second.
 *
 * ★ AND IT FALLS SILENT WHEN THE WHOLE SET FITS, which is the common case now. "All the stocks in the
 *   pristine band" is 15 and the card carries 15 — a cap sentence there would describe a filter that
 *   never fired, which is the same defect as declaring a depth floor that excludes nobody.
 */
function boundLine(matched: number, carried: number): string | null {
  if (matched <= carried) return null;
  return `The table carries ${n(carried)} of them, a page at a time — the other ${n(matched - carried)} `
    + `are not on this card, and they are not different in any way from the ones that are.`;
}

export async function composeScreenAnswer(
  conditions: readonly ScreenCondition[],
  /** ★ THE BAND — a filter on the published LABEL, which no `ScreenFieldId` can express. */
  band: string | null = null,
  shape: "list" | "count" = "list",
): Promise<MarketTurnResult | null> {
  const block = await screenBlock(conditions, "filter", band);
  if (!block) return null;

  // ⚠ READ OFF THE PAYLOAD, NEVER RECOMPUTED. The card's own "Matched" total and the sentence above
  //   it must be the same number; deriving one of them separately is how they come to differ.
  const payload = (block.section as { payload?: { rows?: unknown[]; totalAvailable?: number | null } }).payload;
  const shown = payload?.rows?.length ?? 0;
  const matched = payload?.totalAvailable ?? shown;

  const what = band
    ? conditions.length > 0
      ? `in the ${band} band and meeting every condition`
      : `in the ${band} band`
    : "meeting every condition";

  // ⚠ A BAND SCREEN LEADS WITH ITS COUNT IN EITHER SHAPE, AND A CONDITION SCREEN DOES NOT.
  //   "Here is what matched" is the right opening above a list whose bounds the reader chose — they
  //   already know what they asked for. It is the WRONG opening above a band: "all the stocks in the
  //   pristine band" is a question whose answer is a size as much as a list, and the size is the part
  //   the table cannot state in a sentence. So the count leads whenever the label is the only filter.
  const countLeads = shape === "count" || (band !== null && conditions.length === 0);
  const opening = countLeads
    // ★ THE NUMBER FIRST, AND IN WORDS THE READER ASKED IN. Nothing else in the answer changes.
    ? matched === 0
      // ⚠ A ZERO IS A RESULT AND IS SAID AS ONE. "None" with the denominator beside it is an answer;
      //   "no matches" on its own reads as a failure to search.
      ? [`None. No company we score is ${what}.`]
      : [`${n(matched)} ${matched === 1 ? "company is" : "companies are"} ${what}.`]
    : ["Here is what matched."];

  const bound = boundLine(matched, shown);
  if (bound) opening.push(bound);

  const sections: AnySection[] = [
    coverageSection(block.coverage, band ? `The ${band} band, across the scored universe` : "A filter across the scored universe") as AnySection,
    block.section,
  ];
  return wrap(
    band && conditions.length === 0 ? "market.screen.band" : "market.screen",
    opening,
    sections,
    {
      [`${block.section.kind}:${block.section.renderer}`]: band && conditions.length === 0
        // ⚠ NOT "meeting every condition" WHEN THE ONLY FILTER IS THE LABEL. A band screen applies no
        //   numeric condition at all, and saying it did would describe a test that never ran.
        ? `Every company we score whose label is ${band}, best health score first.`
        : "The companies meeting every condition, best health score first.",
    },
    band && conditions.length === 0
      ? `The label is cut at fixed points on the 0–100 scale and the cuts are the same for every `
        + `company and every industry, so this is one set measured against one line — not a ranking `
        + `and not a recommendation.`
      : "A screen is a filter over what we hold — a company missing the figure a condition names was never in the running, and the count above says how many that was.",
  );
}

// ═══ THE LINE-ITEM SCREEN ══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE UNIVERSE IS PER CONDITION, AND THE CARD SAYS WHICH ONE IT SEARCHED.
//
//   scored metrics · pillars · bands       95
//   filed line items                    2,284
//   findings · patterns                 2,291
//
// ⚠ A COMBINED FILTER INTERSECTS TO THE SMALLER, AND THAT IS INVISIBLE UNLESS STATED. "Health above
//   70 and revenue above 100cr" searched 95 companies, not 2,284 — because only 95 have a health
//   score at all. A reader who is not told that reads the result as a filter over the market.
//
// ★ SO THE OPENING NAMES THE POPULATION, ALWAYS, and names the narrowing where there is one. It is a
//   noun in the first sentence rather than a caveat underneath: the Operator's standing instruction
//   is that a warning register costs trust, and a denominator is not a warning.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function composeLineItemScreenAnswer(
  conditions: readonly LineItemCondition[],
  requestedBasis: "standalone" | "consolidated" | null,
  shape: "list" | "count",
  /** The scored side of a combined filter, when there is one — see the header. */
  narrowedTo: {
    readonly symbols: ReadonlySet<string>;
    readonly what: string;
    readonly population: number;
    /** The scored side's own conditions, in words — so the summary names what the reader asked. */
    readonly said: string;
  } | null = null,
): Promise<MarketTurnResult | null> {
  const r = await resolveLineItemScreen(conditions, requestedBasis, narrowedTo?.symbols ?? null);
  if (!r.ok) return null;
  const d = r.data;

  const block = await lineItemScreenBlock(conditions, requestedBasis, narrowedTo?.symbols ?? null);
  if (!block) return null;
  const payload = (block.section as { payload?: { rows?: unknown[]; totalAvailable?: number | null } }).payload;
  const shown = payload?.rows?.length ?? 0;
  const matched = payload?.totalAvailable ?? shown;

  // ⚠ BOTH SIDES OF THE SENTENCE. The first draft summarised only the FILED conditions, so
  //   "health score above 70 and revenue above 500cr" came back as "18 companies clear revenue ≥ 500
  //   cr" — the health condition applied, and invisible. A summary that drops half the filter is a
  //   different question answered without saying so.
  const what = [
    ...(narrowedTo?.said ? [narrowedTo.said] : []),
    ...d.conditions.map((c) => `${c.label.toLowerCase()} ${c.bound}`),
  ].join(" and ");
  const opening: string[] = [];

  if (matched === 0 && d.evaluable === 0) {
    // ⚠ NOTHING MATCHED AND NOTHING COULD BE READ ARE DIFFERENT ANSWERS, and only the second is about
    //   us. "No company clears revenue ≥ X, out of the 0 that have filed it" is a sentence with a
    //   zero denominator in it — arithmetically empty and, to a reader, indistinguishable from a
    //   filter that ran. This one says plainly that the figure is not on file.
    opening.push(
      `We hold no filed figure for ${d.conditions.map((c) => c.label.toLowerCase()).join(" or ")}, `
      + `so there is nothing to filter on — that is a gap in what companies have filed to us, not an `
      + `empty result.`,
    );
  } else if (matched === 0) {
    opening.push(
      `None — no company clears ${what}, out of the ${n(narrowedTo ? narrowedTo.population : d.evaluable)} `
      + `${narrowedTo ? narrowedTo.what : "that have filed every figure asked for"}.`,
    );
  } else {
    opening.push(
      `${n(matched)} ${matched === 1 ? "company clears" : "companies clear"} ${what}`
      // ⚠ THE POPULATION, IN THE SENTENCE. Not "of 2,291 companies we hold" — of the ones that could
      //   answer the question, which is the only denominator the count is true against.
      + `, out of the ${n(narrowedTo ? narrowedTo.population : d.evaluable)} `
      + `${narrowedTo ? narrowedTo.what : "that have filed every figure asked for"}.`,
    );
  }

  // ★★ THE INTERSECTION, SAID OUT LOUD. This is §2's requirement and it is the sentence a combined
  //    filter cannot be honest without.
  if (narrowedTo) {
    opening.push(
      `Those two conditions reach different sets of companies — ${n(d.evaluable)} have filed the `
      + `figures, and ${n(narrowedTo.population)} carry a score — so this is the overlap, and it can `
      + `only be as wide as the narrower of the two.`,
    );
  }

  // ★ BASIS. Named by the reader, or resolved per company — and where the set MIXES, the column says
  //   which each row is, because two rows on different bases are two sets of books.
  const { standalone, consolidated } = d.basisSplit;
  if (d.basisRequested) {
    opening.push(`Read on a ${d.basisRequested} basis, because you asked for one.`);
  } else if (standalone > 0 && consolidated > 0) {
    opening.push(
      `Each company is read on the basis we default to for its industry — ${n(consolidated)} `
      + `consolidated and ${n(standalone)} standalone here — and the column says which.`,
    );
  } else if (matched > 0) {
    opening.push(`All of these are read on a ${standalone > 0 ? "standalone" : "consolidated"} basis.`);
  }

  const bound = matched > shown
    ? `The table carries ${n(shown)} of the ${n(matched)}, a page at a time.`
    : null;
  if (bound) opening.push(bound);

  const sections: AnySection[] = [
    coverageSection(block.coverage, `Filed figures, across the ${n(d.considered)} companies that have filed`) as AnySection,
    block.section,
  ];

  return wrap(
    "market.screen.lineitem",
    opening,
    sections,
    {
      [`${block.section.kind}:${block.section.renderer}`]:
        `Each company's latest filed figure, ${d.sortedBy}.`,
    },
    `These are filed figures, read as the company reported them.`,
  );
}

// ═══ THE FINDING SCREEN ════════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE WIDER SCREEN, AND THE ONE WHERE THE THREE STATES CAN BE DESTROYED.
//
// The metric screen sees the 95 SCORED companies. This sees all 2,291, because `stock_findings` is
// the only evaluative layer with tier-0-inclusive reach. That difference is stated in the answer
// rather than left for the reader to infer from a total — "59 of 2,291" and "59 of 95" are different
// findings and only one of them is true.
//
// ⚠ AND THE PROSE CARRIES THE THIRD STATE, NOT ONLY THE CARD. A reader who reads the sentence and not
//   the totals must still come away knowing that "did not fire" and "could not be checked" are two
//   different things — because on some rules the second is five times the first, and a reader who
//   folds them has been told we checked 2,248 companies when we checked 359.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function composeFindingScreenAnswer(
  ruleKeys: readonly string[],
  what: string,
  band: string | null,
  shape: "list" | "count",
  /**
   * ★ THE CHECK'S OWN DEFINITION, from the catalogue. `null` for a KIND screen ("red flags"), which
   *   spans eleven rules and therefore has no single description to give.
   */
  definition: string | null = null,
): Promise<MarketTurnResult | null> {
  const r = await resolveFindingScreen(ruleKeys, what, band);
  if (!r.ok) return null;
  const d = r.data;
  const c = d.census;

  const block = await findingScreenBlock(ruleKeys, what, band);
  if (!block) return null;

  const shownRows = ((block.section as { payload?: { rows?: unknown[] } }).payload?.rows?.length) ?? 0;
  const kept = d.matches.length;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ COUNT, DEFINITION, LIST — AND NOTHING ELSE. Operator's ruling, and it corrects a real
  //    misjudgement in the first version of this answer rather than only softening its tone.
  //
  // ⚠ WHAT THIS ANSWER USED TO OPEN WITH, ON A QUESTION AS PLAIN AS "how many stocks are showing
  //   pledging red flag": a count, then a paragraph splitting 1,999 did-not-fire from 233 could-not-
  //   run and calling the 233 "not a clean bill of health", then a second paragraph saying the pledge
  //   column is zero-filled so a company we did not flag cannot be called unpledged. Three
  //   qualifications before the list. A reader who opens that does not come away better informed —
  //   they come away doubting the figure, which is the opposite of what the transparency was for.
  //
  // ★ AND THE SECOND PARAGRAPH WAS SIMPLY STALE. Re-measured on the live table (see resolve/pledge.ts):
  //   the rows-contradict-each-other defect it was written from is at ZERO, and the two pledge columns
  //   now agree on 98.1% of rows. It was warning about data that had already been repaired.
  //
  // ★ WHAT A READER ASKING THIS ACTUALLY WANTS is what the check looks for and who tripped it. The
  //   definition is the CATALOGUE's own rule-level copy — the same sentence the stock page and the
  //   Hub census show — so it is one home, and it names the criterion without publishing a threshold
  //   (`ServedPatternFacts` keeps every bar engine-side; nothing here quotes one).
  //
  // ⚠ THE ONE THING THAT STAYS IS THE HONEST DENOMINATOR, AND IT IS NOT A WARNING — it is a noun in
  //   the first sentence. "Out of the 2,058 the check could be run on" is shorter than the paragraph
  //   it replaces, carries no alarm word, and makes it impossible to read the answer as "the other
  //   2,232 are clean". `I-STATES-SURVIVE` is satisfied by that number being present, which is why it
  //   asserts the PROPERTY (the reader is given the checked denominator) rather than any wording.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const opening: string[] = [];
  const checked = c.fired + c.notFired;

  if (kept === 0) {
    // ⚠ THE ZERO CARRIES THE CHECKED DENOMINATOR TOO, and `I-STATES-SURVIVE` caught its absence. "None.
    //   No company we hold carries this flag" is the strongest claim in the product and it was being
    //   made over a book of 2,291 on a check that ran on 2,058 — the 233 it could not read are exactly
    //   the ones a reader would be wrong to count as clean, and a zero is where that costs most.
    opening.push(
      band
        ? `None — no company in the ${band} band carries this flag.`
          + (c.fired > 0
            ? ` ${n(c.fired)} of the ${n(checked)} the check could be run on ${c.fired === 1 ? "carries" : "carry"} it elsewhere.`
            : ` Nor does any of the ${n(checked)} the check could be run on.`)
        : `None — not one of the ${n(checked)} companies the check could be run on carries this flag.`,
    );
  } else {
    opening.push(
      `${n(kept)} ${kept === 1 ? "company is" : "companies are"} showing ${what}`
      + (band ? ` inside the ${band} band` : "")
      // ⚠ THE DENOMINATOR IS THE SET THE CHECK COULD RUN ON, never the whole book. On R1 that is 2,058
      //   of 2,291 — the other 233 have filed no shareholding at all, so a shareholding-grain rule has
      //   nothing to read. Stating the smaller number is what makes the sentence true without a caveat.
      + `, out of the ${n(checked)} the check could be run on.`,
    );
  }

  // ★ THE DEFINITION — the catalogue's own words, which is what the reader asked for.
  if (definition) opening.push(definition);

  const bound = kept > shownRows
    ? `The table carries ${n(shownRows)} of the ${n(kept)}, a page at a time.`
    : null;
  if (bound) opening.push(bound);

  const sections: AnySection[] = [
    coverageSection(block.coverage, `${what} — every company we hold, not only the scored ones`) as AnySection,
    block.section,
  ];

  return wrap(
    "market.screen.findings",
    opening,
    sections,
    {
      [`${block.section.kind}:${block.section.renderer}`]:
        `Each company where ${what} is standing at its latest filing, most recent first.`,
    },
    // ⚠ ONE SHORT CLOSE, AND IT IS A STATEMENT ABOUT THE LIST RATHER THAN A DISCLAIMER ABOUT IT.
    //   It used to be two sentences of boundary plus a caption under the table repeating the
    //   evaluation-state split — a third and fourth qualification on an answer that had already made
    //   two. The house's no-advice rule is kept ("what the check found", not "what to do"); the
    //   apologising is not.
    `Each of these met that description at its latest filing.`,
    // ⚠ AND NO CAPTION UNDER THE TABLE. The one that was here restated the evaluation states a third
    //   time, directly under the list, which is precisely where it read as a hedge on the figures.
  );
}
