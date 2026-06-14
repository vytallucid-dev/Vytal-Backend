// File: src/scoring/pillars/types.ts
//
// PILLAR ASSEMBLY layer — the LAST piece of the three-lens core. Rolls the
// per-metric scored results from piece 2b (ScoredMetric, src/scoring/metric-
// scoring/) into a single Foundation pillar score and a single Momentum pillar
// score, per stock per snapshot. It does NOT touch Market or Ownership (separate
// pillars) and it does NOT compute the snapshot composite (the four-pillar blend,
// later). PILLAR-LEVEL ONLY: metric composites → pillar subtotal.
//
// This is the intra-pillar WEIGHTING + RENORMALIZATION step. It owns:
//   • the three metric DISPOSITIONS (scored / dropped / neutral-hold) and the
//     different way each is weighted,
//   • renormalization of the PRESENT set to 100% when metrics drop,
//   • the §7.2 F10 weight cap (≤10%) and how it interacts with renormalization,
//   • the §14.4 pillar-floor (≥50% present required to score, else exclude),
//   • the weight columns 2b deferred (nominalWeight / effectiveWeight /
//     contribution on score_metrics) + the score_pillars subtotal/state.
//
// CN-3 untouched: this weights metric COMPOSITES; it never re-weights the three
// lenses within a metric (locked equal in 2b). CN-8: weights are spec/structural,
// never fitted.

import type { Pillar, MetricScoreState, ScoredMetric } from "../metric-scoring/types.js";

/** Mirrors schema enum `PillarState`. A whole-pillar exclusion is a RECORDED
 *  state (never a silent zero / null pillar); unavailable_redistributed defers to
 *  the snapshot-level pillar-weight redistribution (the composite blend). */
export type PillarState = "scored" | "unavailable_redistributed";

/** The three weighting dispositions, derived from the 2b `scoreState`:
 *   scored        ← scoreState "scored"        : contributes at its weight.
 *   dropped       ← "missing_renorm" | "suppressed" : EXCLUDED; leaves the weight
 *                   pool; survivors RENORMALIZE to 100%. Never zero/neutral-filled.
 *   neutral_hold  ← "neutral_hold" (banking CASA/Tier-1) : score 60, KEPT in the
 *                   present set at full weight, NOT renormalized away. */
export type MetricDisposition = "scored" | "dropped" | "neutral_hold";

/** Banking neutral-hold metrics sit at exactly 60. */
export const NEUTRAL_HOLD_SCORE = 60;

/** §14.4 floor: fraction of a pillar's metrics that must be PRESENT (scored +
 *  neutral-hold) to score the pillar. ≥50% → score; <50% → exclude. At the
 *  boundary (exactly 50%, e.g. 5 of 10) the pillar IS scored. */
export const PILLAR_FLOOR_RATIO = 0.5;

/** Foundation §7.2: Revenue-3y-CAGR (F10) intra-pillar weight is capped at ≤10%. */
export const F10_KEY = "F10";
export const F10_MAX_WEIGHT = 10;

// ── Per-PG nominal-weight spec (overrides + caps), passed IN — never hardcoded ──
/** A metric's nominal intra-pillar weight + optional hard cap, in PERCENT (0–100).
 *  Default is equal (1/N) per pillar; a PG spec MAY override (rare). Caps are
 *  structural (§7.2), not fitted. */
export interface MetricWeightSpec {
  metricKey: string;
  nominalWeight: number; // PERCENT, 0–100
  maxWeight?: number; // PERCENT hard cap (§7.2 F10 → 10); undefined = uncapped
}

// ── One metric's line in the pillar result (the weight columns 2b deferred) ─────
export interface MetricContribution {
  metricKey: string;
  label: string;
  /** The exact 2b state — keeps the three dispositions DISTINGUISHABLE in output
   *  (a pillar with 2 renormalized-away vs one with a neutral-hold at 60 are
   *  different facts, recoverable from here). */
  scoreState: MetricScoreState;
  disposition: MetricDisposition;
  /** Score actually used: composite (scored) | 60 (neutral_hold) | null (dropped). */
  metricScore: number | null;
  nominalWeight: number; // PERCENT, pre-renorm spec/override
  effectiveWeight: number; // PERCENT, post-renorm + post-cap (0 for dropped)
  contribution: number; // SCORE-POINTS = effectiveWeight/100 × scoreUsed; Σ = subtotal
  capApplied: boolean; // §7.2 cap clamped this metric's effective weight
  includedInPeerStats: boolean; // carried through from 2b (decomposition aid)
}

// ── The PillarScore contract (per stock per snapshot per pillar) ────────────────
export interface PillarScoreResult {
  pillar: Pillar;
  stockId: string;
  symbol: string;
  snapshot: string;

  pillarState: PillarState;
  /** 0–100 weighted average over the present set, or null when the pillar is
   *  unavailable_redistributed (§14.4). Never a silent zero. */
  subtotal: number | null;
  unavailableReason: string | null;

  // Disposition counts — the three buckets, distinguishable
  totalMetrics: number;
  presentCount: number; // scored + neutral_hold
  scoredCount: number;
  neutralHeldCount: number;
  droppedCount: number;
  presentRatio: number; // presentCount / totalMetrics

  /** Per-metric: effective weight + contribution — enough to decompose
   *  "why is <pillar> = X" down to the metric contributions. */
  contributions: MetricContribution[];

  flags: string[];
}

// ── Assembler input ─────────────────────────────────────────────────────────────
export interface PillarAssemblyInput {
  pillar: Pillar;
  stockId: string;
  symbol: string;
  snapshot: string;
  /** Every 2b ScoredMetric for THIS pillar/stock/snapshot — one per metric, each
   *  carrying its composite (or not-scored state), in some disposition. */
  metrics: ScoredMetric[];
  /** Per-PG nominal weights + caps. Omit ⇒ EQUAL weighting (1/N each), with the
   *  §7.2 F10 cap auto-attached for Foundation. */
  weightSpecs?: MetricWeightSpec[];
  /** §14.4 floor override (default PILLAR_FLOOR_RATIO = 0.5). */
  floorRatio?: number;
}
