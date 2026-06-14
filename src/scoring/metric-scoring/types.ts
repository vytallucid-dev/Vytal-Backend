// File: src/scoring/metric-scoring/types.ts
//
// PIECE 2b — lens-WIRING layer. Takes raw metric values (2a, src/scoring/metrics/)
// and runs them through the verified three-lens machinery (src/scoring/lenses/)
// against bars + peer-stats, producing per-metric scored results that match the
// `score_metrics` (MetricScore) storage contract. This layer does NOT do pillar
// assembly (intra-pillar weighting / renormalization) — that is the next piece.
// Metric-level scoring only.
//
// What 2b OWNS: peer μ/σ computation, the §5.3.1 (Lens-2) and §5.4.1 (Lens-3)
// anchor-lift COUNT decisions, the §5.4/§5.8 minimum-N gating that decides lens
// availability, the three not-scored modes, and assembling the MetricScore. It
// CALLS the lens math; it never reimplements it.

import type {
  BarDirection,
  MetricBand,
  LensFallback,
  AnchorLiftRule,
} from "../lenses/types.js";
import type { AbsoluteBars } from "../lenses/lens-bars.js";

/** Subset of the schema `Pillar` enum this layer produces. */
export type Pillar = "foundation" | "momentum" | "market" | "ownership";

/** Mirrors schema enum `MetricScoreState` (the three not-scored modes + scored).
 *  includedInPeerStats by mode: scored=true, suppressed=false, missing_renorm=
 *  false (excluded), neutral_hold=true. */
export type MetricScoreState = "scored" | "suppressed" | "missing_renorm" | "neutral_hold";

// ── Peer cross-section μ/σ (Lens-2 input; storable to score_peer_stats) ──────────
export interface PeerStats {
  mean: number;
  stdDev: number; // POPULATION σ (÷N) — the peer set is a complete population, not a sample
  sampleN: number; // N-of-K: count of VALID values in the cross-section
}

/** A §5.3.1 / §5.4.1 anchor-lift decision, fully recorded (count + N + fired). */
export interface AnchorLiftDecision {
  rule: AnchorLiftRule; // rule_5_3_1 (peer) | rule_5_4_1 (own-history)
  clearedCount: number; // members/obs with L1 ≥ Good bar (75)
  n: number; // valid N the fraction is taken over
  fraction: number; // clearedCount / n
  fired: boolean; // fraction ≥ 0.75 → lift the Z=0 anchor 60→75 (one-way)
}

// ── Bars input (production reads score_metric_bar_sets; here it is supplied) ─────
export interface MetricBarSetInput {
  metricKey: string;
  direction: BarDirection;
  bars: AbsoluteBars;
  /** Provenance note. For the verification fixture this LOUDLY says THROWAWAY. */
  note: string;
  /** Set when these are the illustrative test fixture, never real CN-4 bars. */
  illustrative: boolean;
  barPath?: string | null; // the peerGroupId / logical path the bars belong to
  metricBarSetId?: string | null; // FK to score_metric_bar_sets (production)
}

// ── Suppression hook (Phase-5 guardrail) ────────────────────────────────────────
/** Returns true if (stock, metric) is suppressed at this snapshot. */
export type SuppressionDirective = (stockId: string, metricKey: string) => boolean;
export const NO_SUPPRESSION: SuppressionDirective = () => false;

/** The TWO independent exclusions a score_suppressions row carries (the two
 *  booleans), consumed separately by the scorer (CN-1: ONE row, two effects):
 *   • excludeFromOwnScore → drop the metric from THIS stock's pillar (renormalize
 *     survivors) — the stock is not scored on it.
 *   • excludeFromPeerMean → drop the metric's value from the peer μ/σ that OTHER
 *     peers are scored against — the value leaves the cross-section.
 *  O2 = both true. O4 = peer-mean true, own-score FALSE (the metric stays in this
 *  stock's own pillar at full participation; only its value leaves OTHERS' Lens-2). */
export interface SuppressionPredicates {
  excludeFromOwnScore: SuppressionDirective;
  excludeFromPeerMean: SuppressionDirective;
}

/** wire accepts EITHER a single predicate (LEGACY: drives both effects together =
 *  O2-shaped, backward-compatible) OR the two-predicate form (O2/O4 independently).
 *  A bare function is normalized to {own: fn, peer: fn} so existing callers are
 *  unchanged. */
export type SuppressionInput = SuppressionDirective | SuppressionPredicates;

/** Normalize either form to the two-predicate shape. A function ⇒ both predicates
 *  are that function (legacy O2 behavior); an object passes through. */
export function normalizeSuppression(s: SuppressionInput): SuppressionPredicates {
  return typeof s === "function" ? { excludeFromOwnScore: s, excludeFromPeerMean: s } : s;
}

// ── Tunables — SPEC values / interpretations, NOT fitted (CN-8). All FLAGGED. ────
export interface WiringConfig {
  /** Min VALID peers to compute Lens 2 (else L2 unavailable → fallback). */
  peerMinN: number;
  /** Min effective in-window own-history obs to compute Lens 3 (else fallback). */
  l3MinN: number;
  /** Max trailing obs taken as the L3 own-history window. */
  l3Window: number;
}

// ── The per-(stock,metric,snapshot) scored result = score_metrics contract ──────
export interface ScoredMetric {
  // identity
  pillar: Pillar;
  metricKey: string;
  label: string;
  stockId: string;
  symbol: string;

  // raw value + not-scored state
  rawValue: number | null;
  scoreState: MetricScoreState;
  includedInPeerStats: boolean;
  unavailableReason: string | null; // when missing/suppressed

  // Lens 1 (absolute bars)
  l1Available: boolean;
  l1Score: number | null;
  l1Band: MetricBand | null;
  l1Saturated: boolean;
  barDirection: BarDirection | null;
  barNote: string; // carries the THROWAWAY label in verification

  // Lens 2 (peer cross-section)
  l2Available: boolean;
  l2Score: number | null;
  l2Z: number | null;
  l2AnchorApplied: number | null; // 60 | 75
  l2AnchorFired: boolean;
  peerStats: PeerStats | null; // → score_peer_stats

  // Lens 3 (own-history)
  l3Available: boolean;
  l3Score: number | null;
  l3Z: number | null;
  l3AnchorApplied: number | null;
  l3AnchorFired: boolean;
  l3Mean: number | null;
  l3StdDev: number | null;
  l3WindowN: number | null;

  // Composite
  metricScore: number | null;
  lensFallbackApplied: LensFallback;

  // Weight fields (nominalWeight/effectiveWeight/contribution) are DEFERRED to
  // pillar assembly — NOT set here. 2b owns everything above.

  notes: string[];
}

/** Result of scoring one metric across a peer group at a snapshot. */
export interface CrossSectionResult {
  pillar: Pillar;
  metricKey: string;
  label: string;
  snapshot: string;
  peerStats: PeerStats; // computed over valid values only
  l2Available: boolean; // peerStats.sampleN ≥ peerMinN
  lift531: AnchorLiftDecision; // the collective Lens-2 lift decision
  scored: ScoredMetric[]; // one per PG member
}
