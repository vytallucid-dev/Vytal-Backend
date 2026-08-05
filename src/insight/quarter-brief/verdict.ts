// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE VERDICT.
//
// Computed in the backend from the written-down rules below. NEVER the model's opinion: the model
// receives the chosen verdict and may reproduce its label and its sentence, nothing else.
//
// ── THE RULES DEGRADE, THEY NEVER BLOCK ─────────────────────────────────────────────────────────────
// Four inputs are available and only ONE is near-universal:
//
//   growth direction   504 / 504 stocks     ← the spine; everything else only REFINES it
//   margin direction   ~504 (net margin is ~100% populated in every family)
//   bad-loan direction  26 (banking only, but 26/26 have it at both this quarter and last)
//   profit source        4 events live (non-financial, scored, and genuinely rare)
//
// Every rule below reads its refinement as OPTIONAL. A stock with growth direction alone still gets a
// verdict — it lands on `grew`, `held`, `fell_back` or `pulled_both_ways`, which is the honest reading
// of what we actually know about it. Nothing is ever withheld because a refinement is missing, and a
// missing refinement never silently reads as its negative (no bad-loan data ≠ bad loans falling).
//
// ── ⚠ WHY BAND MOVEMENT IS DELIBERATELY *NOT* AN INPUT ──────────────────────────────────────────────
// It was on the candidate list and it is excluded on purpose. Only 95 of 504 stocks are scored, so a
// verdict that consumed band movement would mean something DIFFERENT for a scored stock than for an
// unscored one with identical financials — two companies that reported the same quarter would carry
// different verdicts because of our coverage, not their results. The verdict must be comparable across
// the whole universe or it is not a verdict. The score's own movement is not lost: it is reported in
// the health section, and where it CONTRADICTS the headline that contrast is its own computed fact
// (headlineHealthDivergence). Contrast beside the verdict, not folded into it.
//
// ── CN-8 — WHERE THE CUTS CAME FROM ─────────────────────────────────────────────────────────────────
// Every threshold here was set on reasoning BEFORE the distribution was run, and the distribution is
// reported both before and after any adjustment. See verify-quarter-brief-vocabulary.ts and
// quarter-brief-distribution.ts. The one axis that is deliberately SYMMETRIC (margins wider / thinner,
// same 1.0pp cut in both directions) is symmetric precisely so that it splits a large bucket without
// being fitted to it — an asymmetric cut chosen to break up "grew" would be exactly the curve-fitting
// CN-8 forbids.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Family } from "./types.js";

/** Direction of one reported line over the comparison period. */
export type LineDirection = "up" | "down" | "flat";

/** THE FIXED VOCABULARY. Verbs and verb phrases, never quality adjectives — thirty adjective-shaped
 *  words are already taken across Health, Portfolio, Construction, MetricBand, guardrail severity,
 *  sector heat, IngestionSeverity, StructureTier and CapitalTier, and Health↔Portfolio already
 *  collide on "Fragile"/"Steady" unresolved. A different grammatical register sidesteps the whole
 *  contested space. Asserted against the reserved list by verify-quarter-brief-vocabulary.ts. */
export const VERDICT_KEYS = [
  "grew_margins_wider",
  "grew",
  "grew_margins_thinner",
  "grew_bad_loans_up",
  "held",
  "pulled_both_ways",
  "fell_back",
  "loss_both_periods",
  "lifted_by_one_offs",
] as const;

export type VerdictKey = (typeof VERDICT_KEYS)[number];

export interface VerdictDef {
  key: VerdictKey;
  /** The badge word. Plain over clever — this is read by someone who cannot read a statement. */
  label: string;
  /** One sentence saying what the label means, in the reader's words. */
  meaning: string;
  /** Direction glyph. Carries the direction so COLOUR does not have to — see BADGE_TREATMENT. */
  glyph: "up" | "down" | "level" | "split" | "flag";
}

export const VERDICTS: Readonly<Record<VerdictKey, VerdictDef>> = Object.freeze({
  grew_margins_wider: {
    key: "grew_margins_wider",
    label: "Grew, margins wider",
    meaning: "Sales and profit were both higher, and the company kept more of each rupee of sales than it did a year ago.",
    glyph: "up",
  },
  grew: {
    key: "grew",
    label: "Grew",
    meaning: "Sales and profit were both higher than the comparison period.",
    glyph: "up",
  },
  grew_margins_thinner: {
    key: "grew_margins_thinner",
    label: "Grew, margins thinner",
    meaning: "Sales and profit were both higher, but the company kept less of each rupee of sales than it did a year ago.",
    glyph: "up",
  },
  grew_bad_loans_up: {
    key: "grew_bad_loans_up",
    label: "Grew, bad loans up",
    meaning: "Income and profit were both higher, but the share of loans the bank is not being repaid on rose.",
    glyph: "up",
  },
  held: {
    key: "held",
    label: "Held",
    meaning: "Profit finished close to where it was — no material move in either direction.",
    glyph: "level",
  },
  pulled_both_ways: {
    key: "pulled_both_ways",
    label: "Pulled both ways",
    meaning: "Sales and profit moved in opposite directions, so the quarter does not read the same way on both lines.",
    glyph: "split",
  },
  fell_back: {
    key: "fell_back",
    label: "Fell back",
    meaning: "Sales and profit were both lower than the comparison period.",
    glyph: "down",
  },
  // A company that lost money in BOTH periods is not "up", "down" or "flat" — a percentage change
  // between two losses is arithmetic without meaning. Before this bucket existed these 14 stocks got
  // NO verdict at all, which is the one outcome the degradation rule forbids: they filed a real
  // quarter and we had nothing to say about it. The verdict states the condition; the headline's two
  // absolute figures say whether the loss widened or narrowed.
  loss_both_periods: {
    key: "loss_both_periods",
    label: "Made a loss again",
    meaning: "The company made a loss this quarter, as it also did in the period being compared against.",
    glyph: "flag",
  },
  lifted_by_one_offs: {
    key: "lifted_by_one_offs",
    label: "Lifted by one-offs",
    meaning: "Profit rose, but a large part of the rise came from something outside the day-to-day business rather than from trading.",
    glyph: "flag",
  },
});

/** ⚠ 2f — SHIPS WITH THE BADGE, NEVER BELOW IT. The verdict is the most-read line on the page and the
 *  one a reader is most likely to act on, so the limit of what it claims travels with it. */
export const VERDICT_DOESNT_MEAN =
  "This describes one quarter's reported figures. It is not a view on the company, and not a view on the share price.";

// ═══ ★ THE ABSENT VERDICT IS A REAL STATE, AND THE COLUMN CANNOT HOLD IT ═══════════════════════════
//
// `computeVerdict` returns null when there is no comparison period worth naming — MMTC is the live
// case: a full brief, real prose, no verdict. But quarter_briefs.verdict_key is NOT NULL, because a
// brief is whole or absent and two more nullable columns would admit rows where key and label
// disagree. So the absence is WRITTEN as a sentinel and READ BACK as null, once each, and the API
// contract (`verdictKey: string | null`) stays honest for the surfaces that must render a
// badge-less brief.
//
// ⚠ Read it through `readVerdict`, never by comparing to the literal. The pair is returned together
// so a caller cannot end up with a key and no label, or a label and no key.
export const VERDICT_NONE = "none";

export function readVerdict(
  storedKey: string,
  storedLabel: string,
): { key: string; label: string } | null {
  if (storedKey === VERDICT_NONE || storedKey === "" || storedLabel === "") return null;
  return { key: storedKey, label: storedLabel };
}

// ── THRESHOLDS (reasoned first; see the CN-8 note in the header) ─────────────────────────────────────

/** A quarterly line moving less than 3% has not moved. Same floor the QoQ/YoY disagreement uses, and
 *  for the same reason: below it, rounding and ordinary lumpiness dominate. */
export const LINE_MATERIAL_PCT = 3;

/** A full point of margin is a real change in what the business keeps. Symmetric by design. */
export const MARGIN_MATERIAL_PP = 1.0;

/** Bad-loan ratios move slowly; a basis point is noise, ten is a move. Expressed in PERCENTAGE POINTS
 *  (gnpa_pct is stored as a fraction, so the caller converts before comparing). */
export const GNPA_MATERIAL_PP = 0.05;

export interface VerdictInputs {
  family: Family;
  /** Direction of the family's top line. null ⇒ not computable (no comparison period on file). */
  toplineDirection: LineDirection | null;
  /** Direction of net profit. The PRIMARY line — "the quarter" means profit to most readers. */
  profitDirection: LineDirection | null;
  /** Direction of the family's quality margin, or null when unavailable. REFINEMENT ONLY. */
  marginDirection: "rising" | "falling" | "little changed" | null;
  /** A B-1/B-4 guardrail event exists for this stock and period. REFINEMENT ONLY. */
  profitSourceFired: boolean;
  /** Banking only. true ⇒ GNPA rose materially. null ⇒ unknown, which must NOT read as "false". */
  gnpaRising: boolean | null;
  /** Loss in BOTH the current and the comparison period, so no percentage change is meaningful. */
  profitBothLoss: boolean;
}

export interface Verdict {
  key: VerdictKey;
  label: string;
  meaning: string;
  glyph: VerdictDef["glyph"];
  doesntMean: string;
  /** Which refinements were actually available. Carried so a reader of the stored row can tell a
   *  "grew" that survived every check from a "grew" that simply had nothing else to look at. */
  inputsUsed: string[];
}

/** THE RULESET. First match wins; order is the priority order.
 *  Returns null ONLY when profit direction is not computable at all — i.e. there is no comparison
 *  period on file. That is a genuine absence, not a degraded verdict, and Stage 3 renders nothing. */
export function computeVerdict(i: VerdictInputs): Verdict | null {
  // Checked BEFORE the null guard: two losses give no direction, but they are a fully known state.
  if (!i.profitBothLoss && i.profitDirection === null) return null;

  const used: string[] = ["growth direction"];
  if (i.marginDirection !== null) used.push("margin direction");
  if (i.gnpaRising !== null) used.push("bad-loan direction");
  if (i.profitSourceFired) used.push("profit source");

  const key = pick(i);
  const def = VERDICTS[key];
  return { key, label: def.label, meaning: def.meaning, glyph: def.glyph, doesntMean: VERDICT_DOESNT_MEAN, inputsUsed: used };
}

function pick(i: VerdictInputs): VerdictKey {
  // 0 · Two losses. Outranks everything: no growth reading applies, and "fell back" would imply the
  //     company had been profitable.
  if (i.profitBothLoss) return "loss_both_periods";

  // 1 · A profit rise that traces to something below the operating line outranks every other reading
  //     of that rise — it is the one case where the headline number is actively misleading, and the
  //     guardrail has already established it independently.
  if (i.profitSourceFired && i.profitDirection === "up") return "lifted_by_one_offs";

  // 2 · Opposition between the two lines. Checked BEFORE the growth cases so a company whose profit
  //     rose while sales fell is never filed under "grew".
  const opposed =
    (i.profitDirection === "up" && i.toplineDirection === "down") ||
    (i.profitDirection === "down" && i.toplineDirection === "up");
  if (opposed) return "pulled_both_ways";

  // 3 · Profit-led. Profit is the line a reader means by "how was the quarter"; the top line qualifies
  //     it but does not overrule it (a flat top line with rising profit is still a quarter that grew).
  if (i.profitDirection === "up") {
    // Bad loans outrank margins for a bank: the margin is this quarter's earnings, the loan book is
    // next year's. `=== true` on purpose — null (unknown) must not fall through as "not rising".
    if (i.family === "banking" && i.gnpaRising === true) return "grew_bad_loans_up";
    if (i.marginDirection === "falling") return "grew_margins_thinner";
    if (i.marginDirection === "rising") return "grew_margins_wider";
    return "grew"; // margin unavailable or flat — degrade to the plain reading, never withhold
  }

  if (i.profitDirection === "down") return "fell_back";

  return "held";
}

/** Direction of a line from a signed percentage change, or null when there is nothing to compare. */
export function directionOf(changePct: number | null | undefined): LineDirection | null {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) return null;
  if (changePct >= LINE_MATERIAL_PCT) return "up";
  if (changePct <= -LINE_MATERIAL_PCT) return "down";
  return "flat";
}

// ── 2e · BADGE TREATMENT ────────────────────────────────────────────────────────────────────────────
/** ⚠ THE VERDICT BADGE CARRIES NO COLOUR SEMANTICS. Every verdict here is DESCRIPTIVE — it says what
 *  a set of figures did over one quarter. None of them is a judgement, so none of them may be rendered
 *  in a colour that supplies one: "Fell back" in red would tell a reader the company is in trouble,
 *  which this feature does not know and does not claim, and "Grew" in green would read as a buy.
 *
 *  Direction is carried by the GLYPH, which is unambiguous and colour-blind-safe. Colour on this page
 *  stays reserved for the Health band beside it, which IS an evaluative scale and has earned its
 *  palette. Two coloured scales side by side, one evaluative and one not, would be read as one scale. */
export const BADGE_TREATMENT = Object.freeze({
  surface: "var(--surface-2)",
  border: "var(--line2)",
  ink: "var(--ink)",
  glyphInk: "var(--ink2)",
  colourEncodesMeaning: false,
});
