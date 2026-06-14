// File: src/scoring/pillars/persist.ts
//
// DRY-RUN persistence mappers for the pillar layer. Build the EXACT row shapes for
// score_pillars (PillarScore) and supply the three weight columns 2b deliberately
// left off score_metrics (MetricScore.nominalWeight / effectiveWeight /
// contribution) — but DO NOT write, consistent with the standing dry-run gate (the
// first committed write waits for a complete 4-pillar snapshot). When the gate
// lifts, the caller passes these to prisma.create with no reshaping.

import { createHash } from "node:crypto";
import type { PillarScoreResult } from "./types.js";

/** Round to the score_metrics / score_pillars Decimal(8,4) storage scale. The
 *  in-memory result is full precision; this is applied only here, at the DB edge. */
const d4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * score_pillars row (PillarScore). STOCK-grain, append-only, event-driven
 * versioned by `inputsFingerprint` (ruling 2). NOTE on the non-nullable
 * `subtotal` column: an unavailable_redistributed pillar has no real subtotal —
 * we store 0 as an INERT placeholder, and `pillarState` carries the truth (the
 * snapshot-level reweight zeroes this pillar's weight, so the number is never read
 * into a composite). This is NOT a silent zero: the state column sits right beside
 * it and is what every reader keys on.
 */
export function toPillarScoreRow(
  r: PillarScoreResult,
  ctx: { runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string },
) {
  return {
    stockId: r.stockId,
    symbol: r.symbol,
    pillar: r.pillar,
    subtotal: r.subtotal === null ? 0 : d4(r.subtotal), // inert 0 when unavailable_redistributed; pillarState carries truth
    pillarState: r.pillarState,
    sourcePeriod: ctx.sourcePeriod,
    asOfDate: ctx.asOfDate,
    runId: ctx.runId,
    specVersionId: ctx.specVersionId,
    inputsFingerprint: pillarInputsFingerprint(r, ctx.sourcePeriod),
  };
}

/** The three weight columns 2b deferred, keyed by metricKey, ready to merge onto
 *  each score_metrics row built by metric-scoring/persist.ts:toMetricScoreRow. */
export function metricWeightColumnsByKey(
  r: PillarScoreResult,
): Map<string, { nominalWeight: number; effectiveWeight: number; contribution: number }> {
  return new Map(
    r.contributions.map((c) => [
      c.metricKey,
      { nominalWeight: d4(c.nominalWeight), effectiveWeight: d4(c.effectiveWeight), contribution: d4(c.contribution) },
    ]),
  );
}

/** Merge the pillar layer's weight columns onto a 2b base MetricScore row. */
export function completeMetricScoreRow<T extends { metricKey: string }>(
  baseRow: T,
  weights: Map<string, { nominalWeight: number; effectiveWeight: number; contribution: number }>,
) {
  const w = weights.get(baseRow.metricKey) ?? { nominalWeight: 0, effectiveWeight: 0, contribution: 0 };
  return { ...baseRow, ...w };
}

/**
 * Ruling-2 input identity: a stable fingerprint over the pillar's full scored
 * input set INCLUDING sourcePeriod, so identical inputs cannot insert a second
 * version while a genuine change yields a new one. Deterministic (sorted keys,
 * fixed precision) — no Date.now()/random.
 */
export function pillarInputsFingerprint(r: PillarScoreResult, sourcePeriod: string): string {
  const payload = {
    pillar: r.pillar,
    stockId: r.stockId,
    sourcePeriod,
    pillarState: r.pillarState,
    metrics: [...r.contributions]
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey))
      .map((c) => ({
        k: c.metricKey,
        s: c.scoreState,
        d: c.disposition,
        v: c.metricScore === null ? null : Number(c.metricScore.toFixed(4)),
        nw: Number(c.nominalWeight.toFixed(4)),
        ew: Number(c.effectiveWeight.toFixed(4)),
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
