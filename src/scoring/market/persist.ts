// File: src/scoring/market/persist.ts
//
// PERSISTENCE MAPPERS for the UNIVERSAL Market pillar — the row shapes for
// score_pillars (the Market PillarScore) and score_market_subs (the 7 universal
// sub-components). PURE: no DB/IO. The caller (composite/score-pass.ts) passes
// these to `db.create` with no reshaping, inside the one scoring-pass transaction.
//
// CN-6: every sub-component is mapped to a row — a scoreable one carries
// raw/score/band; an EXCLUDED one carries available=false + reason (null
// raw/score/band). A quarantined/excluded Market pillar (state
// unavailable_redistributed) still emits all 7 sub rows — the honest decomposition.

import { createHash } from "node:crypto";
import type { MarketUniversalResult, ScoredSub, SubKey, Category } from "./market-universal.js";

/** Round to the Decimal(8,4) storage scale (full precision in memory; rounded at the DB edge). */
const d4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Mirrors schema enum `MetricBand` — the universal Market lands on the Lens-1 band. */
const METRIC_BANDS = ["excellent", "good", "acceptable", "concerning", "distress"] as const;
type MetricBandT = (typeof METRIC_BANDS)[number];
function asMetricBand(b: string | null): MetricBandT | null {
  if (b === null) return null;
  if ((METRIC_BANDS as readonly string[]).includes(b)) return b as MetricBandT;
  throw new Error(`market/persist: '${b}' is not a MetricBand (expected one of ${METRIC_BANDS.join("/")})`);
}

/**
 * Ruling-2 identity for the Market pillar: a stable fingerprint over the full
 * decomposition (state + every sub's value/score/band/availability) INCLUDING
 * sourcePeriod, so identical price inputs cannot insert a second version while a
 * genuine change yields a new one. Deterministic (sorted keys) — no Date.now/random.
 */
export function marketInputsFingerprint(r: MarketUniversalResult, stockId: string, sourcePeriod: string): string {
  const payload = {
    pillar: "market",
    stockId,
    sourcePeriod,
    state: r.state,
    subtotal: r.subtotal === null ? null : Number(r.subtotal.toFixed(4)),
    subs: [...r.subs]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((s) => ({
        k: s.key,
        a: s.available,
        v: s.rawValue === null ? null : Number(s.rawValue.toFixed(4)),
        sc: s.score === null ? null : Number(s.score.toFixed(4)),
        b: s.band,
        sat: s.saturated,
        cap: s.capped,
        rsn: s.reason,
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * score_pillars (PillarScore) row for the Market pillar. An excluded/quarantined
 * Market is `unavailable_redistributed` with an INERT 0 subtotal — pillarState
 * carries the truth and the snapshot zeroes wMarket (§14.4c). Mirrors
 * pillars/persist.ts:toPillarScoreRow.
 */
export function toMarketPillarScoreRow(
  r: MarketUniversalResult,
  ctx: { stockId: string; symbol: string; runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string },
) {
  return {
    stockId: ctx.stockId,
    symbol: ctx.symbol,
    pillar: "market" as const,
    subtotal: r.subtotal === null ? 0 : d4(r.subtotal), // inert 0 when unavailable_redistributed
    pillarState: r.state, // "scored" | "unavailable_redistributed"
    sourcePeriod: ctx.sourcePeriod,
    asOfDate: ctx.asOfDate,
    runId: ctx.runId,
    specVersionId: ctx.specVersionId,
    inputsFingerprint: marketInputsFingerprint(r, ctx.stockId, ctx.sourcePeriod),
  };
}

/** One score_market_subs row from a scored/excluded sub-component (pillarScoreId merged by caller). */
export function toMarketSubScoreRow(s: ScoredSub) {
  return {
    subComponent: s.key as SubKey,
    category: s.category as Category,
    available: s.available,
    reason: s.available ? null : (s.reason ?? "unavailable"),
    rawValue: s.rawValue === null ? null : d4(s.rawValue),
    score: s.score === null ? null : d4(s.score),
    band: asMetricBand(s.band),
    saturated: s.saturated,
    capped: s.capped,
  };
}

/** All 7 score_market_subs rows (CN-6: every sub-component + exclusion), ready for nested create. */
export function marketSubScoreRows(r: MarketUniversalResult): ReturnType<typeof toMarketSubScoreRow>[] {
  return r.subs.map(toMarketSubScoreRow);
}
