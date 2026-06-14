// File: src/scoring/lenses/lens-bars.ts
//
// LENS 1 — ABSOLUTE BARS (§CN-2). A metric value → 0–100 against FIVE
// sector-derived absolute bars:
//   Excellent=90, Good=75, Acceptable=60, Concerning=40, Distress=20.
//
// MECHANICS
//  • Piecewise-linear interpolation between adjacent bars. A value exactly at a
//    bar → that bar's anchor score; halfway between two bars (in VALUE) → the
//    midpoint score.
//  • Direction (higher_better / lower_better) is handled by mapping every value
//    into a "goodness coordinate" g (higher g = better) so the rest of the math
//    is direction-agnostic:  g = +value (higher_better) | −value (lower_better).
//    In g-space a well-formed bar set is always  gE ≥ gG ≥ gA ≥ gC ≥ gD.
//  • Saturation beyond the ends: above Excellent, +L1_SAT_RATE (10) points per
//    BAND-WIDTH, capped at 100; below Distress, −10 per band-width, floored at 0.
//    "Band-width" = the value-distance of the ADJACENT band interval — Excellent→
//    Good for the top, Concerning→Distress for the bottom.
//  • Landing band = the highest bar the value cleared (the tier floor it met).
//
// NOTE (asymmetric saturation, by design): the Excellent anchor is 90 (10 below
// the 100 cap) while the Distress anchor is 20 (20 above the 0 floor). At the
// stated ±10/band-width rate the TOP saturates to 100 in ONE band-width but the
// BOTTOM only reaches 0 after TWO band-widths. See the FLAG in the test harness:
// the spec's verification line "below Distress by one band-width → 0" disagrees
// with the stated −10/band-width rule (that yields 10, not 0); we implement the
// stated rule.
//
// PURE. No DB, no I/O. CN-8: every constant is a fixed mechanic, not tuned.

import {
  BAR_SCORE,
  L1_SAT_RATE,
  SCORE_MAX,
  clampScore,
  type BarDirection,
  type MetricBand,
} from "./types.js";

/** The five absolute bar VALUES for one (metric, peer-group) at a snapshot. */
export interface AbsoluteBars {
  excellent: number;
  good: number;
  acceptable: number;
  concerning: number;
  distress: number;
}

export interface Lens1Result {
  available: true; // L1 is computable whenever bars + a value exist
  score: number; // [0,100]
  band: MetricBand; // the tier the value landed in (for MetricScore.l1Band)
  /** True only when a saturation region (above Excellent / below Distress) was
   *  entered — i.e. the score is outside [20,90]. */
  saturated: boolean;
  /** Set when the bar set was malformed (a strict inversion, not a mere collapsed
   *  interval) or a saturation scale had to fall back to a non-adjacent
   *  band-width. null on the clean path. */
  guard: L1Guard | null;
  reasonText: string;
}

export type L1Guard =
  | "non_monotonic_bars" // a strict inversion in the expected direction
  | "collapsed_saturation_scale" // adjacent band-width was 0; used a fallback scale
  | "degenerate_all_bars_equal"; // no resolvable scale at all → anchor returned

/** value → goodness coordinate (higher g = better), folding direction in. */
const toG = (value: number, dir: BarDirection): number =>
  dir === "higher_better" ? value : -value;

/**
 * LENS 1. PURE.
 *
 * @param value     the metric value being scored
 * @param bars      the 5 absolute bar VALUES (in the metric's own units)
 * @param direction higher_better | lower_better
 */
export function computeLens1(
  value: number,
  bars: AbsoluteBars,
  direction: BarDirection,
): Lens1Result {
  const g = toG(value, direction);
  const gE = toG(bars.excellent, direction);
  const gG = toG(bars.good, direction);
  const gA = toG(bars.acceptable, direction);
  const gC = toG(bars.concerning, direction);
  const gD = toG(bars.distress, direction);

  // Band-widths (in g-space) of the four interior intervals, all ≥0 when the bar
  // set is well-formed. Index 0 is the top (Excellent→Good) interval.
  const widths = [gE - gG, gG - gA, gA - gC, gC - gD];

  // A STRICT inversion (negative width) means the caller passed a malformed bar
  // set (e.g. Good better than Excellent). Equalities (collapsed intervals, e.g.
  // Acceptable=Good) are NOT inversions and are handled cleanly below.
  let guard: L1Guard | null = widths.some((w) => w < 0)
    ? "non_monotonic_bars"
    : null;

  // ── Saturation scales: the adjacent band-width, with a fallback if collapsed ──
  // Top scale = Excellent→Good width (widths[0]); if 0, the nearest non-zero
  // interior width scanning inward. Bottom scale = Concerning→Distress width
  // (widths[3]); if 0, the nearest non-zero scanning inward.
  const firstNonZero = (order: number[]): number | null => {
    for (const i of order) if (widths[i] > 0) return widths[i];
    return null;
  };
  const topScaleRaw = widths[0];
  const botScaleRaw = widths[3];
  const topScale = topScaleRaw > 0 ? topScaleRaw : firstNonZero([1, 2, 3]);
  const botScale = botScaleRaw > 0 ? botScaleRaw : firstNonZero([2, 1, 0]);

  let score: number;
  let band: MetricBand;
  let saturated = false;

  if (g >= gE) {
    // At or above Excellent → saturation upward.
    band = "excellent";
    if (g === gE) {
      score = BAR_SCORE.excellent; // exactly on the bar
    } else if (topScale !== null) {
      saturated = true;
      score = clampScore(BAR_SCORE.excellent + L1_SAT_RATE * ((g - gE) / topScale));
      if (topScaleRaw === 0 && guard === null) guard = "collapsed_saturation_scale";
    } else {
      // All intervals zero (every bar equal) → no scale → return the anchor.
      score = BAR_SCORE.excellent;
      if (guard === null) guard = "degenerate_all_bars_equal";
    }
  } else if (g >= gG) {
    // [Good, Excellent) — interpolate Good(75)→Excellent(90). gE−gG > 0 here
    // (g < gE and g ≥ gG ⇒ gG < gE), so no divide-by-zero.
    band = "good";
    score = BAR_SCORE.good + (BAR_SCORE.excellent - BAR_SCORE.good) * ((g - gG) / (gE - gG));
  } else if (g >= gA) {
    // [Acceptable, Good) — Acceptable(60)→Good(75). gG−gA > 0 here.
    band = "acceptable";
    score = BAR_SCORE.acceptable + (BAR_SCORE.good - BAR_SCORE.acceptable) * ((g - gA) / (gG - gA));
  } else if (g >= gC) {
    // [Concerning, Acceptable) — Concerning(40)→Acceptable(60). gA−gC > 0 here.
    band = "concerning";
    score = BAR_SCORE.concerning + (BAR_SCORE.acceptable - BAR_SCORE.concerning) * ((g - gC) / (gA - gC));
  } else if (g >= gD) {
    // [Distress, Concerning) — Distress(20)→Concerning(40). Still the DISTRESS
    // band (cleared neither Concerning nor better). gC−gD > 0 here.
    band = "distress";
    score = BAR_SCORE.distress + (BAR_SCORE.concerning - BAR_SCORE.distress) * ((g - gD) / (gC - gD));
  } else {
    // Below Distress → saturation downward.
    band = "distress";
    if (botScale !== null) {
      saturated = true;
      score = clampScore(BAR_SCORE.distress - L1_SAT_RATE * ((gD - g) / botScale));
      if (botScaleRaw === 0 && guard === null) guard = "collapsed_saturation_scale";
    } else {
      score = BAR_SCORE.distress;
      if (guard === null) guard = "degenerate_all_bars_equal";
    }
  }

  return {
    available: true,
    score,
    band,
    saturated,
    guard,
    reasonText: buildReason(score, band, saturated, guard, direction),
  };
}

function buildReason(
  score: number,
  band: MetricBand,
  saturated: boolean,
  guard: L1Guard | null,
  dir: BarDirection,
): string {
  const head = `L1=${score.toFixed(2)} band=${band} (${dir}${saturated ? ", saturated" : ""})`;
  if (guard === "non_monotonic_bars")
    return `${head} — FLAG: non-monotonic bars (strict inversion in the expected direction); result is best-effort`;
  if (guard === "collapsed_saturation_scale")
    return `${head} — note: adjacent band-width was 0 (collapsed bar); used the nearest non-zero band-width as the saturation scale`;
  if (guard === "degenerate_all_bars_equal")
    return `${head} — FLAG: all bars equal; no resolvable scale, returned the anchor score`;
  return head;
}
