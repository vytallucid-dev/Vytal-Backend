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
  /** Which bar-set produced this score (handoff §7 decomposability): the standard
   *  5-bar set, or a per-stock 3-anchor SSCU override. */
  barSetUsed: "standard" | "sscu";
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
    barSetUsed: "standard",
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

// ════════════════════════════════════════════════════════════════════════════
// HALF-2 ADDITION — SSCU CONDITIONAL (3-ANCHOR) BARS  (handoff §7)
//
// A metric may carry an optional per-stock OVERRIDE bar-set: only the distress,
// good and excellent anchors are populated (acceptable/concerning are null). The
// score path is the same universal anchor mapping (D=20, G=75, E=90), just
// piecewise-linear over THREE anchors instead of five, with the same saturation
// rule — the band-widths come from the 3 anchors: below-Distress uses
// (good−distress), above-Excellent uses (excellent−good).
//
// ADDITIVE: computeLens1 (the 5-bar path verified by the 105 assertions) is
// UNTOUCHED. This is a separate function reached only when an override fires.
// PURE. CN-8: anchors are fixed mechanics, not tuned.
// ════════════════════════════════════════════════════════════════════════════

/** A 3-anchor SSCU override bar-set (the populated anchors of sscuBars). */
export interface ThreeAnchorBars {
  distress: number;
  good: number;
  excellent: number;
}

/** Per-stock SSCU override: the 3-anchor bars + the stock scope they apply to. */
export interface StockOverride {
  bars: ThreeAnchorBars;
  scope: string[];
}

/** Case-insensitive scope membership (the source scope uses display names like
 *  "TataPower"; callers may pass NSE symbols like "TATAPOWER"). */
const inScope = (stock: string, scope: string[]): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = norm(stock);
  return scope.some((x) => norm(x) === s);
};

/** Derive the landing band from a final score via the fixed anchor thresholds.
 *  The 3-anchor set has no explicit Acceptable/Concerning bar, so the band is the
 *  highest anchor tier the SCORE cleared (excellent≥90, good≥75, acceptable≥60,
 *  concerning≥40, else distress). Documented choice — see the §7 FLAG. */
function bandFromScore(score: number): MetricBand {
  if (score >= BAR_SCORE.excellent) return "excellent";
  if (score >= BAR_SCORE.good) return "good";
  if (score >= BAR_SCORE.acceptable) return "acceptable";
  if (score >= BAR_SCORE.concerning) return "concerning";
  return "distress";
}

/**
 * LENS 1 — 3-ANCHOR (SSCU) path. PURE.
 *
 * @param value  the metric value being scored
 * @param bars   the 3 anchors (distress/good/excellent) in the metric's units
 * @param direction higher_better | lower_better
 */
export function computeLens1ThreeAnchor(
  value: number,
  bars: ThreeAnchorBars,
  direction: BarDirection,
): Lens1Result {
  const g = toG(value, direction);
  const gE = toG(bars.excellent, direction);
  const gG = toG(bars.good, direction);
  const gD = toG(bars.distress, direction);

  const wTop = gE - gG; // excellent − good (above-Excellent saturation scale)
  const wBot = gG - gD; // good − distress  (below-Distress saturation scale)

  // Strict inversion (negative width) ⇒ malformed override. Equalities (collapsed
  // anchors) are handled cleanly by the branch structure below.
  let guard: L1Guard | null = wTop < 0 || wBot < 0 ? "non_monotonic_bars" : null;

  let score: number;
  let saturated = false;

  if (g >= gE) {
    // At/above Excellent → saturate up.
    if (g === gE) {
      score = BAR_SCORE.excellent;
    } else if (wTop > 0) {
      saturated = true;
      score = clampScore(BAR_SCORE.excellent + L1_SAT_RATE * ((g - gE) / wTop));
    } else if (wBot > 0) {
      saturated = true;
      score = clampScore(BAR_SCORE.excellent + L1_SAT_RATE * ((g - gE) / wBot));
      if (guard === null) guard = "collapsed_saturation_scale";
    } else {
      score = BAR_SCORE.excellent;
      if (guard === null) guard = "degenerate_all_bars_equal";
    }
  } else if (g >= gG) {
    // [Good, Excellent) — interpolate Good(75)→Excellent(90). gE−gG>0 here.
    score = BAR_SCORE.good + (BAR_SCORE.excellent - BAR_SCORE.good) * ((g - gG) / (gE - gG));
  } else if (g >= gD) {
    // [Distress, Good) — interpolate Distress(20)→Good(75). gG−gD>0 here.
    score = BAR_SCORE.distress + (BAR_SCORE.good - BAR_SCORE.distress) * ((g - gD) / (gG - gD));
  } else {
    // Below Distress → saturate down.
    if (wBot > 0) {
      saturated = true;
      score = clampScore(BAR_SCORE.distress - L1_SAT_RATE * ((gD - g) / wBot));
    } else if (wTop > 0) {
      saturated = true;
      score = clampScore(BAR_SCORE.distress - L1_SAT_RATE * ((gD - g) / wTop));
      if (guard === null) guard = "collapsed_saturation_scale";
    } else {
      score = BAR_SCORE.distress;
      if (guard === null) guard = "degenerate_all_bars_equal";
    }
  }

  const band = bandFromScore(score);
  return {
    available: true, score, band, saturated, guard, barSetUsed: "sscu",
    reasonText: `L1(sscu 3-anchor)=${score.toFixed(2)} band=${band} (${direction}${saturated ? ", saturated" : ""})` +
      (guard ? ` — ${guard}` : ""),
  };
}

/**
 * SCORE L1 with optional per-stock SSCU override (handoff §7). General mechanism,
 * not PG8-hardcoded: if `opts.stock` is in `opts.override.scope`, the value is
 * scored against the 3-anchor override INSTEAD of the standard 5 bars; otherwise
 * the standard verified path runs. The returned `barSetUsed` records which set
 * was applied (decomposability). PURE.
 */
export function scoreL1(
  value: number,
  bars: AbsoluteBars,
  direction: BarDirection,
  opts?: { stock?: string; override?: StockOverride | null },
): Lens1Result {
  const ov = opts?.override ?? null;
  if (ov && opts?.stock && inScope(opts.stock, ov.scope)) {
    return computeLens1ThreeAnchor(value, ov.bars, direction);
  }
  return computeLens1(value, bars, direction);
}
