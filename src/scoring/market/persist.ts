// File: src/scoring/market/persist.ts
//
// DRY-RUN persistence mappers for the Market pillar. Build the exact row shapes for
// score_market_subs (MarketSubScore) and score_pillars (PillarScore) but DO NOT
// write — the standing dry-run gate holds until a full 4-pillar snapshot exists.
//
// score_market_subs requires non-null rawValue / bandLanded / bandScore, so ONLY
// PRESENT sub-components get rows; an UNAVAILABLE sub-component is represented by
// row-ABSENCE (its reason lives on the in-memory MarketPillarResult — there is no
// schema column for it). The pillar's presentCount/droppedCount records the split.

import { createHash } from "node:crypto";
import type { MarketPillarResult, MarketSubComponent } from "./types.js";

const d4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** score_market_subs rows — PRESENT sub-components only. `bandSetIdFor` resolves
 *  the per-(PG, subComponent, version) MarketBandSet FK (each sub-component has its
 *  own band-set row; trend_4q references its version-marker row). */
export function toMarketSubScoreRows(
  r: MarketPillarResult,
  ctx: { pillarScoreId: string; bandSetIdFor: (sub: MarketSubComponent) => string },
) {
  return r.subScores
    .filter((s) => s.available && s.bandScore !== null && s.bandLanded !== null && s.rawValue !== null)
    .map((s) => ({
      pillarScoreId: ctx.pillarScoreId,
      subComponent: s.subComponent,
      rawValue: d4(s.rawValue as number),
      bandScore: d4(s.bandScore as number),
      bandLanded: s.bandLanded,
      marketBandSetId: ctx.bandSetIdFor(s.subComponent),
    }));
}

/** score_pillars row (PillarScore) for Market. Inert 0 subtotal when
 *  unavailable_redistributed; pillarState carries the truth (same convention as
 *  the Foundation/Momentum pillar-assembly mapper). */
export function toMarketPillarRow(
  r: MarketPillarResult,
  ctx: { runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string },
) {
  return {
    stockId: r.stockId,
    symbol: r.symbol,
    pillar: "market" as const,
    subtotal: r.subtotal === null ? 0 : d4(r.subtotal),
    pillarState: r.pillarState,
    sourcePeriod: ctx.sourcePeriod,
    asOfDate: ctx.asOfDate,
    runId: ctx.runId,
    specVersionId: ctx.specVersionId,
    inputsFingerprint: marketInputsFingerprint(r, ctx.sourcePeriod),
  };
}

/** Ruling-2 input identity: deterministic hash over the present sub-component raw
 *  values + bands + sourcePeriod (no Date.now()/random). */
export function marketInputsFingerprint(r: MarketPillarResult, sourcePeriod: string): string {
  const payload = {
    pillar: "market",
    stockId: r.stockId,
    sourcePeriod,
    pillarState: r.pillarState,
    subs: [...r.subScores]
      .sort((a, b) => a.subComponent.localeCompare(b.subComponent))
      .map((s) => ({
        k: s.subComponent,
        a: s.available,
        v: s.rawValue === null ? null : Number(s.rawValue.toFixed(4)),
        b: s.bandLanded,
        sc: s.bandScore === null ? null : Number(s.bandScore.toFixed(4)),
        bv: s.bandSetVersion,
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
