// File: src/scoring/lens-patterns/types.ts
//
// THREE-LENS PATTERN LIBRARY — shared types + derivation constants.
//
// This is the engine layer for the Vytal Three-Lens Pattern Library (databank
// Vytal_Three_Lens_Pattern_Library_v1.md). It sits with the METRIC/LENS ATOM
// (alongside src/scoring/lenses/), NOT with any surface — Stock Health, PG-
// Fundamentals, Comparison and the Hub all read the SAME function (briefing §6,
// §5.1 compute-once/display-everywhere).
//
// The patterns are a PURE FUNCTION of the three lens values already persisted on
// score_metrics (MetricScore). This module stores nothing, recomputes no lens, and
// touches no DB — exactly like lenses/types.ts. It only NAMES the relationship the
// composite collapsed (§0.2 — "disagreement is the information").
//
// CN-8 / §0.3: nothing here is tuned to outcomes. The two display thresholds below
// (the L2 near-band and the L3 trend cut) are PROVISIONAL DISPLAY thresholds that
// change NO score and are tunable post-build; both are DERIVED from the verified
// lens mechanics, not hardcoded magic numbers.

import { Z_INNER_HALF, BAR_SCORE, Z_ANCHOR_DEFAULT } from "../lenses/types.js";
import { LABEL_BAND_MAP } from "../composite/label.js";

// ── The three discrete lens states (derived at read-time from the atom) ──────────
//
// Direction is ALREADY folded into the persisted atom: l1Band is assigned in a
// goodness coordinate (computeLens1) so "excellent" is always healthiest, and the
// l2/l3 SCORES are orientation-corrected (zToScore via `orient`) so "above the
// anchor" is always healthier. So every state below means HEALTHIER, with the fold
// read FROM the atom rather than re-applied here (single source of truth — no
// separate direction lookup, no chance of a second, drifting fold).

/** L1 — absolute bar. above_bar/below_bar always mean healthier/worse than the bar. */
export type L1State = "above_bar" | "below_bar" | "not_evaluable";

/** L2 — peer cross-section. above_peer = healthier than the field; near_peer =
 *  essentially at the field average (±0.5σ); below_peer = worse than the field. */
export type L2State = "above_peer" | "near_peer" | "below_peer" | "not_evaluable";

/** L3 — own-history trend. improving/declining = healthier/worse vs the stock's own
 *  history; flat = inside the noise band. */
export type L3State = "improving" | "flat" | "declining" | "not_evaluable";

/** Field-verdict a pattern carries about the PEER GROUP (§1.2, §4). null = the
 *  pattern makes no claim about the field (no L1/L2 tension). */
export type FieldVerdict = "PG_WEAK" | "PG_STRONG" | null;

/** Anti-double-count role (§5.3): a top-level finding, or supporting detail beneath
 *  an existing headline R/P finding (Family-D recovery / Family-B deterioration). */
export type PatternRole = "top_level" | "supporting_detail";

// ── DERIVED DISPLAY THRESHOLDS (provisional, tunable, change no score) ────────────

/**
 * L2 NEAR-BAND half-width, in peer σ. §1.1: a metric within ±0.5σ of the PG mean is
 * "essentially at the field average" — its own state (near_peer) — so we don't fire
 * a disagreement on noise. PROVISIONAL DISPLAY threshold; tunable post-build.
 */
export const L2_NEAR_BAND_SIGMA = 0.5;

/**
 * L3 TREND cut, in own-history σ. improving ⇔ zOriented ≥ +L3_TREND_Z;
 * declining ⇔ zOriented ≤ −L3_TREND_Z; flat ⇔ |zOriented| < L3_TREND_Z.
 *
 * DERIVED, not hardcoded: it is Z_INNER_HALF/2 (= 1.0). At the DEFAULT (unlifted)
 * Z=0 anchor, zToScore maps zOriented=+1 onto exactly Z_ANCHOR..→ BAR_SCORE.good
 * (75) — the natural "has meaningfully moved against itself" line, landing on the
 * Good bar. PROVISIONAL DISPLAY threshold; changes no score; tunable post-build.
 */
export const L3_TREND_Z = Z_INNER_HALF / 2; // = 1.0  (NOT a bare 1.0 — see above)

// Sanity anchors (documentation-as-assertion): at the default anchor, z=+L3_TREND_Z
// lands on the Good bar. These are compile-time-checked truths, not tunables.
export const L3_TREND_Z_LANDS_ON: number = BAR_SCORE.good; // 75
export const L3_TREND_Z_DEFAULT_ANCHOR: number = Z_ANCHOR_DEFAULT; // 60 (anchor it lifts from)

/**
 * "Steady-equivalent" floor for the LM8 anti-mask gate (§2 LM8 / catalog §4): LM8
 * only fires when the metric is weak-on-all-three BUT its pillar still reads
 * acceptable (≥ Steady), i.e. the pillar is masking the laggard. We take the
 * LabelBand "steady" lower bound (the single source, composite/label.ts) as the
 * "Steady-equivalent" cut applied to the pillar subtotal. PROVISIONAL/tunable.
 */
export const STEADY_EQUIVALENT_MIN: number =
  LABEL_BAND_MAP.find((b) => b.band === "steady")!.min; // 62

// ── Pillar roll-up share cuts (§3.1) ─────────────────────────────────────────────
/** A lens is "strong" for a pillar at ≥0.70 share, "weak" at <0.40, else "mixed".
 *  0.70 is the default "dominant majority" display cut (tunable; changes no score). */
export const PILLAR_STRONG_SHARE = 0.7;
export const PILLAR_WEAK_SHARE = 0.4;
export type PillarLensClass = "strong" | "mixed" | "weak";

/** Min valid peers to treat L2 as evaluable for pattern purposes (mirrors the
 *  scorer's WiringConfig.peerMinN; the stored l2Available already encodes this, but
 *  we re-assert it so a field-verdict on too-few peers can never slip through). */
export const DEFAULT_PEER_MIN_N = 5;

// ── The metric atom this layer reads (a faithful subset of score_metrics columns) ─
/** Exactly the persisted lens fields the derivations consume. No new fields, no
 *  recompute — every value here is already a column on MetricScore. */
export interface MetricLensAtom {
  metricKey: string;
  pillar: "foundation" | "momentum" | "market" | "ownership";
  scored: boolean; // scoreState === "scored"
  rawValue: number;

  // Lens 1
  l1Available: boolean;
  l1Band: "excellent" | "good" | "acceptable" | "concerning" | "distress" | null;

  // Lens 2
  l2Available: boolean;
  l2Score: number | null;
  l2AnchorApplied: number | null;
  peerMean: number | null;
  peerStdDev: number | null;
  peerSampleN: number | null;

  // Lens 3
  l3Available: boolean;
  l3Score: number | null;
  l3AnchorApplied: number | null;
  l3Mean: number | null;
  l3StdDev: number | null;
  l3WindowN: number | null;
}

/** The derived triplet for one metric. */
export interface LensTriplet {
  l1: L1State;
  l2: L2State;
  l3: L3State;
}

/** A fired metric-level pattern (the §5.1 return shape). */
export interface LensPattern {
  id: string; // "LM1".."LM8"
  label: string; // VERBATIM from the databank §4 faces table
  tone: string; // VERBATIM from the databank §4 faces table
  fieldVerdict: FieldVerdict;
}

/** A fired pillar-level pattern. */
export interface LensPillarPattern {
  id: string; // "LP1".."LP6"
  label: string;
  tone: string;
  fieldVerdict: FieldVerdict;
}

export interface PillarShares {
  l1Pass: number | null; // above_bar share over L1-evaluable scored metrics (null if N=0)
  l2Pass: number | null; // above_peer share over L2-evaluable scored metrics
  l3Improving: number | null; // improving share over L3-evaluable scored metrics
  /** Extra (documented): declining share — needed for LP5/LP6; the §4 shares object
   *  names only the three above, this is surfaced for transparency. */
  l3Declining: number | null;
  // Per-lens denominators (for the honest-empty census).
  nL1: number;
  nL2: number;
  nL3: number;
}
