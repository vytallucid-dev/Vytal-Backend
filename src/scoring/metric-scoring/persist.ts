// File: src/scoring/metric-scoring/persist.ts
//
// DRY-RUN persistence mappers. These build the EXACT row shapes for
// score_peer_stats (PeerStatsSnapshot) and score_metrics (MetricScore) but DO NOT
// write — consistent with the standing dry-run gate (the first committed write
// waits for a complete 4-pillar snapshot). They exist so the wiring is
// "ready-to-persist": when the gate lifts, the caller passes these to
// prisma.create with no reshaping. The weight columns (nominalWeight/
// effectiveWeight/contribution) are filled by the NEXT piece (pillar assembly),
// not here — so the MetricScore mapper deliberately leaves them out.

import type { CrossSectionResult, ScoredMetric } from "./types.js";

/** score_peer_stats row (one per PG, metric, run). anchorLiftRule = rule_5_3_1. */
export function toPeerStatsRow(xs: CrossSectionResult, ctx: { peerGroupId: string; barPath: string; runId: string; asOfDate: Date }) {
  return {
    peerGroupId: ctx.peerGroupId,
    barPath: ctx.barPath,
    metricKey: xs.metricKey,
    runId: ctx.runId,
    asOfDate: ctx.asOfDate,
    mean: xs.peerStats.mean,
    stdDev: xs.peerStats.stdDev,
    sampleN: xs.peerStats.sampleN,
    anchorLiftFired: xs.lift531.fired, // §5.3.1
    anchorLiftRule: xs.lift531.fired ? ("rule_5_3_1" as const) : null,
  };
}

/** score_metrics row (one per pillar version, metric). Lens columns only — the
 *  weighting/contribution columns are the pillar-assembly step's job. */
export function toMetricScoreRow(s: ScoredMetric, ctx: { pillarScoreId: string; peerStatsSnapshotId: string | null; metricBarSetId: string | null }) {
  return {
    pillarScoreId: ctx.pillarScoreId,
    pillar: s.pillar,
    metricKey: s.metricKey,
    rawValue: s.rawValue,
    l1Score: s.l1Score,
    l2Score: s.l2Score,
    l3Score: s.l3Score,
    metricScore: s.metricScore,
    l1Band: s.l1Band,
    metricBarSetId: ctx.metricBarSetId,
    l2AnchorFired: s.l2AnchorFired,
    l2AnchorApplied: s.l2AnchorApplied,
    peerStatsSnapshotId: ctx.peerStatsSnapshotId,
    l3Mean: s.l3Mean,
    l3StdDev: s.l3StdDev,
    l3WindowN: s.l3WindowN,
    l3AnchorFired: s.l3AnchorFired,
    l3AnchorApplied: s.l3AnchorApplied,
    l1Available: s.l1Available,
    l2Available: s.l2Available,
    l3Available: s.l3Available,
    lensFallbackApplied: s.lensFallbackApplied,
    scoreState: s.scoreState,
    includedInPeerStats: s.includedInPeerStats,
    // nominalWeight / effectiveWeight / contribution → set by pillar assembly (next piece)
  };
}
