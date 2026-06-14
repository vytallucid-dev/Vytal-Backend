// File: src/scoring/lenses/types.ts
//
// THREE-LENS SCORING MACHINERY — shared types + fixed mechanics.
//
// This is the PURE mathematical core of the Foundation and Momentum pillars: a
// metric value + the bars/distribution it is scored against → a 0–100 lens score.
// NOTHING here touches the DB, Prisma, metric computation, or pillar assembly.
// The caller supplies values, bars, distributions, and the anchor-lift decisions;
// these functions just do the math and return enough to STORE (decomposability).
//
// The string-literal unions below MIRROR the Prisma schema enums exactly
// (MetricBand, BarDirection, LensFallback, AnchorLiftRule) so the write path can
// assign a lens result straight onto a `score_metrics` (MetricScore) row with no
// cast. They are redefined locally (not imported from generated/prisma) to keep
// this module DB-free — same discipline as ownership/flow-bands.ts's TrendState.
//
// CN-8: no value in this module is tuned to outcomes. The anchor scores, the
// saturation rates, and the equal-weight composite are FIXED mechanics.

/** Mirrors schema enum `BarDirection`. higher_better: a larger value is better
 *  (ROCE); lower_better: a smaller value is better (D/E, Receivables Days). */
export type BarDirection = "higher_better" | "lower_better";

/** Mirrors schema enum `MetricBand` — the L1 landing tier, stored on
 *  MetricScore.l1Band. The tier a value LANDED in = the highest bar it cleared. */
export type MetricBand =
  | "excellent"
  | "good"
  | "acceptable"
  | "concerning"
  | "distress";

/** Mirrors schema enum `LensFallback` — stored on MetricScore.lensFallbackApplied.
 *  none: full 3-lens mean. l3_insufficient_history: L3 dropped, (L1+L2)/2.
 *  l2_to_l1: L2 unavailable (composite is the faithful mean of whatever remains —
 *  the l1/l2/l3 Available booleans carry the precise truth; this label is the
 *  coarse summary). */
export type LensFallback = "none" | "l2_to_l1" | "l3_insufficient_history";

/** Mirrors schema enum `AnchorLiftRule` — which §-rule lifted the Z=0 anchor.
 *  rule_5_3_1: peer cross-section (L2). rule_5_4_1: own-history (L3). */
export type AnchorLiftRule = "rule_5_3_1" | "rule_5_4_1";

// ── Fixed anchor scores for the 5 absolute bars (Lens 1) — §CN-2 ───────────────
export const BAR_SCORE = {
  excellent: 90,
  good: 75,
  acceptable: 60,
  concerning: 40,
  distress: 20,
} as const;

// ── Fixed Z-anchor mapping (Lens 2 / Lens 3) ───────────────────────────────────
export const Z_ANCHOR_DEFAULT = 60; // Z=0 anchor, no lift
export const Z_ANCHOR_LIFTED = 75; // Z=0 anchor after §5.3.1 / §5.4.1 lift
export const Z_PLUS2_SCORE = 90; // Z=+2 endpoint (unchanged by lift)
export const Z_MINUS2_SCORE = 30; // Z=−2 endpoint (unchanged by lift)
export const Z_INNER_HALF = 2; // the ±2 inner band edge
export const Z_SAT_RATE = 5; // points per Z-unit BEYOND ±2 (saturation)

// ── Fixed Lens-1 saturation rate ───────────────────────────────────────────────
export const L1_SAT_RATE = 10; // points per band-width beyond Excellent / below Distress

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Clamp to the [0,100] score range. Local (this module is DB-free and must not
 *  couple to ownership/flow.ts's clamp). */
export const clampScore = (x: number): number =>
  Math.min(SCORE_MAX, Math.max(SCORE_MIN, x));
