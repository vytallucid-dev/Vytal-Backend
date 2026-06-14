// File: src/scoring/lenses/lens-zscore.ts
//
// LENS 2 — PEER CROSS-SECTION Z  (§5.3, lift §5.3.1)
// LENS 3 — OWN-HISTORY Z          (§5.4, lift §5.4.1)
//
// Both lenses share ONE Z→score core. The only differences:
//   • L2 scores the value against the CURRENT peer-group distribution (μ,σ over
//     peers at this snapshot); its lift is the §5.3.1 collective ≥75%-cleared-Good
//     rule. Guard: peer σ = 0.
//   • L3 scores against the STOCK'S OWN trailing-window history (μ,σ,N over its own
//     in-window observations); its lift is the §5.4.1 longitudinal mirror. Guards:
//     own σ = 0 OR effective N below the caller's minimum.
//
// Z MECHANICS (identical for both)
//   Z = (value − μ) / σ.  Direction folds into a SCORE orientation: a FAVOURABLE
//   move maps to a HIGH score regardless of metric direction —
//     higher_better: zOriented = +Z   (above the mean is good)
//     lower_better:  zOriented = −Z   (below the mean is good)
//   Anchor mapping (default anchor 60):  Z=0→60, Z=+1→75, Z=+2→90, Z=−1→45,
//   Z=−2→30 — a single straight line of slope 15 across [−2,+2]. Beyond ±2 the
//   slope drops to Z_SAT_RATE (5) per Z-unit (Z=+3→95), clamped to [0,100].
//   §5.3.1 / §5.4.1 LIFT: when the caller says the collective ≥75% test fired, the
//   Z=0 anchor lifts 60→75 (one-way). The ±2 endpoints stay 90/30, so the line
//   becomes two slopes: +7.5/Z above 0 (Z=+1→82.5) and +22.5/Z below 0
//   (Z=−1→52.5). The caller owns the 75%-count evaluation; this function only
//   APPLIES the lifted anchor when told, and stores which anchor (60 or 75) it used.
//
// PURE. No DB, no I/O. CN-8: anchors and rates are fixed mechanics.

import {
  Z_ANCHOR_DEFAULT,
  Z_ANCHOR_LIFTED,
  Z_PLUS2_SCORE,
  Z_MINUS2_SCORE,
  Z_INNER_HALF,
  Z_SAT_RATE,
  clampScore,
  type BarDirection,
} from "./types.js";

// ── Shared Z→score core ────────────────────────────────────────────────────────
/**
 * Map an orientation-corrected Z (favourable = positive) to a 0–100 score against
 * an anchor at Z=0 (60 default, or 75 when lifted). PURE.
 *
 * The ±2 endpoints are fixed at 90 / 30 irrespective of the anchor, so:
 *   positive interior slope = (90 − anchor)/2 ,  negative interior slope =
 *   (anchor − 30)/2 ;  beyond ±2 the slope is Z_SAT_RATE per Z-unit; clamp [0,100].
 */
export function zToScore(zOriented: number, anchorAtZero: number): number {
  if (zOriented >= Z_INNER_HALF) {
    return clampScore(Z_PLUS2_SCORE + Z_SAT_RATE * (zOriented - Z_INNER_HALF));
  }
  if (zOriented <= -Z_INNER_HALF) {
    return clampScore(Z_MINUS2_SCORE + Z_SAT_RATE * (zOriented + Z_INNER_HALF));
  }
  if (zOriented >= 0) {
    const slope = (Z_PLUS2_SCORE - anchorAtZero) / Z_INNER_HALF;
    return anchorAtZero + slope * zOriented;
  }
  const slope = (anchorAtZero - Z_MINUS2_SCORE) / Z_INNER_HALF;
  return anchorAtZero + slope * zOriented;
}

const orient = (z: number, dir: BarDirection): number =>
  dir === "higher_better" ? z : -z;

// ── Result shape shared by L2 and L3 ───────────────────────────────────────────
export interface ZLensResult {
  available: boolean; // false → the composite must drop this lens
  score: number | null; // null only when unavailable
  /** The RAW statistical Z (value−μ)/σ, for decomposability. null when σ=0 or
   *  unavailable (Z could not be formed). Not stored on MetricScore directly —
   *  reconstructable from value/μ/σ — but returned for transparency/debug. */
  z: number | null;
  anchorApplied: number; // 60 or 75 — for MetricScore.l2/l3AnchorApplied
  anchorLiftFired: boolean; // for MetricScore.l2/l3AnchorFired
  /** Guard that fired, if any. */
  guard: ZGuard | null;
  reasonText: string;
}

export type ZGuard =
  | "std_dev_zero" // σ=0 → Z undefined; returned the anchor (still available)
  | "insufficient_n"; // L3 only: effective N below minimum → UNAVAILABLE

// ── LENS 2 — peer cross-section ────────────────────────────────────────────────
export interface Lens2Input {
  value: number;
  peerMean: number;
  peerStdDev: number;
  direction: BarDirection;
  /** The §5.3.1 decision (≥75% of peers cleared L1≥75 on this metric). The COUNT
   *  evaluation is the caller's job; pass the boolean result. */
  anchorLifted: boolean;
}

/**
 * LENS 2. PURE. σ=0 → returns the anchor score (60 or lifted 75) and flags it
 * (still available — a defined score). Insufficient peers is the CALLER's call
 * (it decides whether to even invoke L2 / mark it unavailable upstream).
 */
export function computeLens2(input: Lens2Input): ZLensResult {
  const { value, peerMean, peerStdDev, direction, anchorLifted } = input;
  const anchorApplied = anchorLifted ? Z_ANCHOR_LIFTED : Z_ANCHOR_DEFAULT;

  if (peerStdDev === 0) {
    // All peers identical → Z undefined. Return the anchor; do not divide.
    return {
      available: true,
      score: anchorApplied,
      z: null,
      anchorApplied,
      anchorLiftFired: anchorLifted,
      guard: "std_dev_zero",
      reasonText:
        `L2=${anchorApplied} (peer σ=0 → Z undefined, returned anchor` +
        `${anchorLifted ? " LIFTED 75 §5.3.1" : " 60"})`,
    };
  }

  const z = (value - peerMean) / peerStdDev;
  const zOriented = orient(z, direction);
  const score = zToScore(zOriented, anchorApplied);
  return {
    available: true,
    score,
    z,
    anchorApplied,
    anchorLiftFired: anchorLifted,
    guard: null,
    reasonText:
      `L2=${score.toFixed(2)} (Z=${z.toFixed(3)}${direction === "lower_better" ? " →oriented " + zOriented.toFixed(3) : ""}` +
      `, anchor=${anchorApplied}${anchorLifted ? " LIFTED §5.3.1" : ""})`,
  };
}

// ── LENS 3 — own-history ───────────────────────────────────────────────────────
export interface Lens3Input {
  value: number;
  ownHistMean: number;
  ownHistStdDev: number;
  /** EFFECTIVE in-window observation count (the caller computes it). */
  windowN: number;
  /** Minimum effective N required to form L3 (caller's §5.4/§5.8 policy). Below
   *  this, L3 is UNAVAILABLE → the composite falls back (l3_insufficient_history).
   *  Supplied by the caller so this function bakes in no guessed threshold. */
  minEffectiveN: number;
  direction: BarDirection;
  /** The §5.4.1 decision (≥75% of own in-window obs cleared L1≥75). */
  anchorLifted: boolean;
}

/**
 * LENS 3. PURE. Two guards:
 *   • windowN < minEffectiveN → UNAVAILABLE (composite drops L3). No score.
 *   • own σ=0 (but enough N) → returns the anchor and flags it (still available).
 */
export function computeLens3(input: Lens3Input): ZLensResult {
  const { value, ownHistMean, ownHistStdDev, windowN, minEffectiveN, direction, anchorLifted } =
    input;
  const anchorApplied = anchorLifted ? Z_ANCHOR_LIFTED : Z_ANCHOR_DEFAULT;

  if (windowN < minEffectiveN) {
    // Not enough trailing history to form an own-history Z → drop the lens.
    return {
      available: false,
      score: null,
      z: null,
      anchorApplied,
      anchorLiftFired: anchorLifted,
      guard: "insufficient_n",
      reasonText: `L3 unavailable — effective N=${windowN} < min ${minEffectiveN} (insufficient own history)`,
    };
  }

  if (ownHistStdDev === 0) {
    // Flat own history → Z undefined. Return the anchor; do not divide.
    return {
      available: true,
      score: anchorApplied,
      z: null,
      anchorApplied,
      anchorLiftFired: anchorLifted,
      guard: "std_dev_zero",
      reasonText:
        `L3=${anchorApplied} (own σ=0 → Z undefined, returned anchor` +
        `${anchorLifted ? " LIFTED 75 §5.4.1" : " 60"}, N=${windowN})`,
    };
  }

  const z = (value - ownHistMean) / ownHistStdDev;
  const zOriented = orient(z, direction);
  const score = zToScore(zOriented, anchorApplied);
  return {
    available: true,
    score,
    z,
    anchorApplied,
    anchorLiftFired: anchorLifted,
    guard: null,
    reasonText:
      `L3=${score.toFixed(2)} (Z=${z.toFixed(3)}${direction === "lower_better" ? " →oriented " + zOriented.toFixed(3) : ""}` +
      `, anchor=${anchorApplied}${anchorLifted ? " LIFTED §5.4.1" : ""}, N=${windowN})`,
  };
}
