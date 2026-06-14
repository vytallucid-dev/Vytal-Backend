// File: src/scoring/pillars/assemble.ts
//
// The pillar ASSEMBLER. For one stock, one snapshot, one pillar: take the 2b
// ScoredMetric for every metric, bucket each into its disposition, renormalize +
// cap the PRESENT set's weights, apply the §14.4 floor, and produce the
// PillarScoreResult (subtotal + per-metric contributions + state).
//
//   pillar subtotal = Σ over the PRESENT set ( effectiveWeight/100 × scoreUsed )
//     where scoreUsed = metric composite (scored) | 60 (neutral-hold),
//     and Σ effectiveWeight = 100 → subtotal is a proper weighted average in [0,100].
//
// DROPPED metrics contribute NOTHING (effectiveWeight 0, contribution 0) and are
// never zero/neutral-filled — they simply left the weight pool (renormalization).

import type { ScoredMetric, MetricScoreState } from "../metric-scoring/types.js";
import {
  type PillarAssemblyInput,
  type PillarScoreResult,
  type MetricContribution,
  type MetricDisposition,
  type MetricWeightSpec,
  NEUTRAL_HOLD_SCORE,
  PILLAR_FLOOR_RATIO,
  F10_KEY,
  F10_MAX_WEIGHT,
} from "./types.js";
import { resolveEffectiveWeights, type WeightInput } from "./weights.js";

/** 2b scoreState → pillar disposition. The two "no usable value" states collapse
 *  to `dropped`; neutral-hold and scored stay distinct. */
function dispositionOf(state: MetricScoreState): MetricDisposition {
  switch (state) {
    case "scored":
      return "scored";
    case "neutral_hold":
      return "neutral_hold";
    case "suppressed":
    case "missing_renorm":
      return "dropped";
  }
}

/** Default EQUAL intra-pillar weighting (1/N each), with the §7.2 F10 cap (≤10%)
 *  auto-attached for Foundation. A PG override replaces this wholesale. */
export function defaultWeightSpecs(pillar: string, metricKeys: string[]): MetricWeightSpec[] {
  const equal = metricKeys.length > 0 ? 100 / metricKeys.length : 0;
  return metricKeys.map((metricKey) => {
    const spec: MetricWeightSpec = { metricKey, nominalWeight: equal };
    if (pillar === "foundation" && metricKey === F10_KEY) spec.maxWeight = F10_MAX_WEIGHT;
    return spec;
  });
}

// In-memory weights/contributions are kept FULL PRECISION so the renormalization
// invariant (present-set effective weights sum to EXACTLY 100%) holds on the
// result object. Rounding to the score_metrics Decimal(8,4) scale happens only at
// the persistence boundary (persist.ts / Prisma) — at which point storing 1/9-type
// weights at 4dp can sum to 99.9999%, an inherent property of fixed-scale storage,
// not a renormalization error.
export function assemblePillar(input: PillarAssemblyInput): PillarScoreResult {
  const { pillar, stockId, symbol, snapshot, metrics } = input;
  const floorRatio = input.floorRatio ?? PILLAR_FLOOR_RATIO;
  const flags: string[] = [];

  // Nominal weight spec per metric (override or default equal + F10 cap).
  const specs = input.weightSpecs ?? defaultWeightSpecs(pillar, metrics.map((m) => m.metricKey));
  const specByKey = new Map(specs.map((s) => [s.metricKey, s]));

  // 1. Bucket each metric into its disposition + the score it would contribute.
  type Row = {
    metric: ScoredMetric;
    disposition: MetricDisposition;
    scoreUsed: number | null; // composite | 60 | null(dropped)
    nominalWeight: number;
    maxWeight?: number;
  };
  const rows: Row[] = metrics.map((m) => {
    let disposition = dispositionOf(m.scoreState);
    let scoreUsed: number | null = null;
    if (disposition === "scored") {
      // 2b guarantees a scored metric carries a composite; guard against a null
      // slipping through (would NaN the average) by demoting it to dropped + flag.
      if (m.metricScore === null) {
        flags.push(`${m.metricKey}: scoreState=scored but metricScore=null → treated as dropped (data error)`);
        disposition = "dropped";
      } else {
        scoreUsed = m.metricScore;
      }
    } else if (disposition === "neutral_hold") {
      scoreUsed = NEUTRAL_HOLD_SCORE; // banking CASA/Tier-1: held at 60, full weight
    }
    const spec = specByKey.get(m.metricKey);
    return {
      metric: m,
      disposition,
      scoreUsed,
      nominalWeight: spec?.nominalWeight ?? 0,
      maxWeight: spec?.maxWeight,
    };
  });

  // 2. Disposition counts. PRESENT = scored + neutral-hold (the set that carries
  //    the pillar and renormalizes to 100%). DROPPED leaves the pool entirely.
  const presentRows = rows.filter((r) => r.disposition === "scored" || r.disposition === "neutral_hold");
  const scoredCount = rows.filter((r) => r.disposition === "scored").length;
  const neutralHeldCount = rows.filter((r) => r.disposition === "neutral_hold").length;
  const droppedCount = rows.filter((r) => r.disposition === "dropped").length;
  const totalMetrics = rows.length;
  const presentCount = presentRows.length;
  const presentRatio = totalMetrics > 0 ? presentCount / totalMetrics : 0;

  // 3. §14.4 PILLAR FLOOR. ≥50% present required to score (boundary INCLUDED:
  //    exactly 50%, e.g. 5 of 10, scores). Below → exclude the WHOLE pillar as a
  //    RECORDED state; the snapshot composite reweights the other pillars later.
  //    Epsilon-guarded so the exact-boundary ratio is treated as ≥.
  const meetsFloor = totalMetrics > 0 && presentRatio + 1e-9 >= floorRatio;

  if (!meetsFloor) {
    const reason =
      totalMetrics === 0
        ? "no metrics supplied"
        : `§14.4 floor: only ${presentCount}/${totalMetrics} metrics present (${(presentRatio * 100).toFixed(0)}% < ${(floorRatio * 100).toFixed(0)}%) → whole pillar excluded`;
    // Record dispositions for transparency, but score nothing (effW/contribution 0).
    const contributions: MetricContribution[] = rows.map((r) => ({
      metricKey: r.metric.metricKey,
      label: r.metric.label,
      scoreState: r.metric.scoreState,
      disposition: r.disposition,
      metricScore: r.scoreUsed,
      nominalWeight: r.nominalWeight,
      effectiveWeight: 0,
      contribution: 0,
      capApplied: false,
      includedInPeerStats: r.metric.includedInPeerStats,
    }));
    return {
      pillar,
      stockId,
      symbol,
      snapshot,
      pillarState: "unavailable_redistributed",
      subtotal: null,
      unavailableReason: reason,
      totalMetrics,
      presentCount,
      scoredCount,
      neutralHeldCount,
      droppedCount,
      presentRatio,
      contributions,
      flags,
    };
  }

  // 4. RENORMALIZE + CAP the present set's weights to sum to 100%.
  const weightInputs: WeightInput[] = presentRows.map((r) => ({
    metricKey: r.metric.metricKey,
    nominalWeight: r.nominalWeight,
    maxWeight: r.maxWeight,
  }));
  const resolved = resolveEffectiveWeights(weightInputs);
  const effByKey = new Map(resolved.map((w) => [w.metricKey, w]));
  if (resolved.some((w) => w.capApplied)) {
    const capped = resolved.filter((w) => w.capApplied).map((w) => w.metricKey).join(", ");
    flags.push(`§7.2 cap fired on [${capped}]: effective weight clamped to its max; excess redistributed to other present metrics`);
  }

  // 5. Contributions + subtotal. Dropped metrics → effW 0, contribution 0.
  let subtotal = 0;
  const contributions: MetricContribution[] = rows.map((r) => {
    const isPresent = r.disposition !== "dropped";
    const w = isPresent ? effByKey.get(r.metric.metricKey)! : null;
    const effectiveWeight = w ? w.effectiveWeight : 0;
    const contribution = isPresent && r.scoreUsed !== null ? (effectiveWeight / 100) * r.scoreUsed : 0;
    subtotal += contribution;
    return {
      metricKey: r.metric.metricKey,
      label: r.metric.label,
      scoreState: r.metric.scoreState,
      disposition: r.disposition,
      metricScore: r.scoreUsed,
      nominalWeight: r.nominalWeight,
      effectiveWeight,
      contribution,
      capApplied: w?.capApplied ?? false,
      includedInPeerStats: r.metric.includedInPeerStats,
    };
  });

  return {
    pillar,
    stockId,
    symbol,
    snapshot,
    pillarState: "scored",
    subtotal,
    unavailableReason: null,
    totalMetrics,
    presentCount,
    scoredCount,
    neutralHeldCount,
    droppedCount,
    presentRatio,
    contributions,
    flags,
  };
}
