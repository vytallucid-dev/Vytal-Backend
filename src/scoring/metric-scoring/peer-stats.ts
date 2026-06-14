// File: src/scoring/metric-scoring/peer-stats.ts
//
// Peer cross-section μ/σ (the Lens-2 input) and the anchor-lift COUNT decisions
// (§5.3.1 peer, §5.4.1 own-history). PURE. These count over VALID values only —
// the cross-section composition is the caller's responsibility (UNAVAILABLE and
// suppressed values must already be excluded before they reach here).
//
// σ is POPULATION (÷N): the peer set is the complete population of valid peers at
// the snapshot, not a sample of a larger one. (Own-history uses the same estimator
// for consistency; with the tiny own-history N it is moot — L3 usually falls back.)

import { computeLens1, type AbsoluteBars } from "../lenses/lens-bars.js";
import { BAR_SCORE, type BarDirection } from "../lenses/types.js";
import type { PeerStats, AnchorLiftDecision } from "./types.js";

/** The L1 score that means "cleared the Good bar" — the anchor-lift threshold. */
export const GOOD_L1 = BAR_SCORE.good; // 75

/** §5.3.1 / §5.4.1 lift fraction: ≥75% cleared → lift (one-way). SPEC value. */
export const LIFT_FRACTION = 0.75;

/** Population μ/σ over the supplied VALID values. N=0 → zeros (caller gates on N). */
export function computePeerStats(values: number[]): PeerStats {
  const n = values.length;
  if (n === 0) return { mean: 0, stdDev: 0, sampleN: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n; // population
  return { mean, stdDev: Math.sqrt(variance), sampleN: n };
}

/** §5.3.1 (Lens 2): count peers whose L1 ≥ Good (75); fire if ≥75% of valid N. The
 *  caller passes the valid peers' L1 scores (already computed against the bars). */
export function decideLift531(validL1Scores: number[]): AnchorLiftDecision {
  return decide("rule_5_3_1", validL1Scores);
}

/** §5.4.1 (Lens 3): the longitudinal mirror — count a stock's OWN in-window
 *  observations whose L1 ≥ 75 against the LIVE bars; fire if ≥75% cleared. */
export function decideLift541(
  ownHistoryValues: number[],
  bars: AbsoluteBars,
  direction: BarDirection,
): AnchorLiftDecision {
  const l1s = ownHistoryValues.map((v) => computeLens1(v, bars, direction).score);
  return decide("rule_5_4_1", l1s);
}

function decide(rule: AnchorLiftDecision["rule"], l1Scores: number[]): AnchorLiftDecision {
  const n = l1Scores.length;
  const clearedCount = l1Scores.filter((s) => s >= GOOD_L1).length;
  const fraction = n > 0 ? clearedCount / n : 0;
  return { rule, clearedCount, n, fraction, fired: n > 0 && fraction >= LIFT_FRACTION };
}
