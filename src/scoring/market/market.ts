// File: src/scoring/market/market.ts
//
// MARKET PILLAR assembler. For one stock at one snapshot (price date):
//   1. compute the 4 sub-component RAW values (subcomponents.ts + trend.ts),
//   2. band-score each (bands.ts) against the PER-PG cuts (§10.4) + v5.5.1
//      saturation,
//   3. equal-weight (25% each), renormalizing the PRESENT sub-components to 100%
//      when some are unavailable,
//   4. apply the whole-Market floor (≥2 of 4 present, i.e. ≥50%) — below it the
//      pillar is unavailable_redistributed (the FY21/FY22 no-price-history case),
//   5. → MarketPillarResult.
//
// Sub-component 3 (volatility) is a RATIO to the PG-median 90-day σ, so it needs
// every member's σ first — assembleMarketForPG runs the two-phase pass and injects
// the median.

import { type DailyClose } from "../price/range.js";
import { scoreBanded, scoreTrend, type SaturationKind } from "./bands.js";
import { computeRange52w, compute200dma, compute90dVolatility, median } from "./subcomponents.js";
import { computeTrendStructure } from "./trend.js";
import type {
  MarketBandSet,
  MarketPillarResult,
  MarketSubComponent,
  MarketSubScoreResult,
  Orientation,
} from "./types.js";

export interface MarketMemberInput {
  stockId: string;
  symbol: string;
  series: DailyClose[]; // full ascending daily-close series
}

export interface MarketConfig {
  /** Min present sub-components to score the pillar. Default 2 = ≥50% of 4. */
  floorPresent: number;
}
export const DEFAULT_MARKET_CONFIG: MarketConfig = { floorPresent: 2 };

const SUB_ORDER: MarketSubComponent[] = ["range_52w", "vs_200dma", "volatility_vs_sector", "trend_4q"];

/** Build one sub-component result (present or unavailable). */
function unavailableSub(sub: MarketSubComponent, orientation: Orientation, reason: string, rawValue: number | null = null): MarketSubScoreResult {
  return { subComponent: sub, available: false, rawValue, orientation, bandLanded: null, bandScore: null, saturated: false, trendState: null, bandSetVersion: null, unavailableReason: reason, notes: [] };
}

/** Compute all four sub-component scored results for one member. `pgMedianVol` is
 *  the PG-median 90d σ (null ⇒ volatility cannot be ratio-scored). */
export function computeMarketSubScores(
  member: MarketMemberInput,
  asOf: Date,
  bandSet: MarketBandSet,
  pgMedianVol: number | null,
): MarketSubScoreResult[] {
  const { series } = member;
  const out: MarketSubScoreResult[] = [];

  // ── S1: 52-week range position (higher_better; saturate p85 → 100% of range) ──
  {
    const sub: MarketSubComponent = "range_52w";
    const cuts = bandSet.cuts[sub];
    const raw = computeRange52w(series, asOf);
    if (!raw.available || raw.value === null) out.push(unavailableSub(sub, "higher_better", raw.reason ?? "unavailable"));
    else if (!cuts) out.push(unavailableSub(sub, "higher_better", "no band cuts for range_52w in band-set", raw.value));
    else {
      const sat: SaturationKind = { mode: "to_max", max: 100 };
      const sc = scoreBanded(raw.value, cuts, "higher_better", sat);
      out.push({ subComponent: sub, available: true, rawValue: raw.value, orientation: "higher_better", bandLanded: sc.bandLanded, bandScore: sc.bandScore, saturated: sc.saturated, trendState: null, bandSetVersion: bandSet.version, unavailableReason: null, notes: [...raw.notes, ...(sc.note ? [sc.note] : [])] });
    }
  }

  // ── S2: position vs 200-DMA (higher_better; saturate one band-width above p85) ──
  {
    const sub: MarketSubComponent = "vs_200dma";
    const cuts = bandSet.cuts[sub];
    const raw = compute200dma(series, asOf);
    if (!raw.available || raw.value === null) out.push(unavailableSub(sub, "higher_better", raw.reason ?? "unavailable"));
    else if (!cuts) out.push(unavailableSub(sub, "higher_better", "no band cuts for vs_200dma in band-set", raw.value));
    else {
      const sc = scoreBanded(raw.value, cuts, "higher_better", { mode: "band_width" });
      out.push({ subComponent: sub, available: true, rawValue: raw.value, orientation: "higher_better", bandLanded: sc.bandLanded, bandScore: sc.bandScore, saturated: sc.saturated, trendState: null, bandSetVersion: bandSet.version, unavailableReason: null, notes: [...raw.notes, ...(sc.note ? [sc.note] : [])] });
    }
  }

  // ── S3: 90-day volatility vs PG median (lower_better; saturate below p15) ──────
  {
    const sub: MarketSubComponent = "volatility_vs_sector";
    const cuts = bandSet.cuts[sub];
    const raw = compute90dVolatility(series, asOf);
    if (!raw.available || raw.value === null) out.push(unavailableSub(sub, "lower_better", raw.reason ?? "unavailable"));
    else if (pgMedianVol === null || pgMedianVol <= 0) out.push(unavailableSub(sub, "lower_better", "PG median 90d σ unavailable — cannot form sector ratio"));
    else if (!cuts) out.push(unavailableSub(sub, "lower_better", "no band cuts for volatility_vs_sector in band-set"));
    else {
      const ratio = raw.value / pgMedianVol;
      const sc = scoreBanded(ratio, cuts, "lower_better", { mode: "band_width_below" });
      out.push({ subComponent: sub, available: true, rawValue: ratio, orientation: "lower_better", bandLanded: sc.bandLanded, bandScore: sc.bandScore, saturated: sc.saturated, trendState: null, bandSetVersion: bandSet.version, unavailableReason: null, notes: [`σ=${(raw.value * 100).toFixed(3)}% ÷ PG-median ${(pgMedianVol * 100).toFixed(3)}% = ${ratio.toFixed(3)}×`, ...(sc.note ? [sc.note] : [])] });
    }
  }

  // ── S4: 4-quarter trend structure (categorical; capped at 90, NO saturation) ──
  {
    const sub: MarketSubComponent = "trend_4q";
    const tr = computeTrendStructure(series, asOf);
    if (!tr.available || tr.state === null) out.push(unavailableSub(sub, "higher_better", tr.reason ?? "unavailable"));
    else {
      const sc = scoreTrend(tr.state);
      out.push({ subComponent: sub, available: true, rawValue: tr.net, orientation: "higher_better", bandLanded: sc.bandLanded, bandScore: sc.bandScore, saturated: false, trendState: tr.state, bandSetVersion: bandSet.version, unavailableReason: null, notes: [`HH=${tr.upHighs} LH=${tr.downHighs} HL=${tr.upLows} LL=${tr.downLows} net=${tr.net} → ${tr.state} (capped 90, no saturation)`] });
    }
  }

  // keep canonical order
  return SUB_ORDER.map((s) => out.find((o) => o.subComponent === s)!);
}

/** Assemble the Market pillar for one member, given the PG-median σ. */
export function assembleMarketPillar(
  member: MarketMemberInput,
  asOf: Date,
  bandSet: MarketBandSet,
  pgMedianVol: number | null,
  snapshot: string,
  config: MarketConfig = DEFAULT_MARKET_CONFIG,
): MarketPillarResult {
  const subScores = computeMarketSubScores(member, asOf, bandSet, pgMedianVol);
  const flags: string[] = [];

  const present = subScores.filter((s) => s.available && s.bandScore !== null);
  const droppedCount = subScores.length - present.length;
  const presentRatio = subScores.length > 0 ? present.length / subScores.length : 0;

  // Whole-Market floor: ≥2 of 4 (≥50%) present required to score.
  if (present.length < config.floorPresent) {
    return {
      pillar: "market", stockId: member.stockId, symbol: member.symbol, snapshot,
      pillarState: "unavailable_redistributed", subtotal: null,
      unavailableReason: `Market floor: only ${present.length}/${subScores.length} sub-components present (<${config.floorPresent}) → pillar excluded; composite redistributes pillar weight`,
      totalSubs: subScores.length, presentCount: present.length, droppedCount, presentRatio,
      subScores, effectiveWeights: {}, contributions: {}, flags,
    };
  }

  // Equal-weight, renormalized over the present sub-components → sum to 100%.
  const effW = 100 / present.length;
  const effectiveWeights: Partial<Record<MarketSubComponent, number>> = {};
  const contributions: Partial<Record<MarketSubComponent, number>> = {};
  let subtotal = 0;
  for (const s of present) {
    effectiveWeights[s.subComponent] = effW;
    const contrib = (effW / 100) * (s.bandScore as number);
    contributions[s.subComponent] = contrib;
    subtotal += contrib;
  }

  if (droppedCount > 0) flags.push(`${droppedCount} sub-component(s) unavailable → present ${present.length} renormalized to ${effW.toFixed(2)}% each`);

  return {
    pillar: "market", stockId: member.stockId, symbol: member.symbol, snapshot,
    pillarState: "scored", subtotal, unavailableReason: null,
    totalSubs: subScores.length, presentCount: present.length, droppedCount, presentRatio,
    subScores, effectiveWeights, contributions, flags,
  };
}

/** Two-phase PG pass: compute every member's 90d σ → PG median → assemble each. */
export function assembleMarketForPG(
  members: MarketMemberInput[],
  asOf: Date,
  bandSet: MarketBandSet,
  snapshot: string,
  config: MarketConfig = DEFAULT_MARKET_CONFIG,
): { pgMedianVol: number | null; results: MarketPillarResult[] } {
  const vols: number[] = [];
  for (const m of members) {
    const v = compute90dVolatility(m.series, asOf);
    if (v.available && v.value !== null) vols.push(v.value);
  }
  const pgMedianVol = median(vols);
  const results = members.map((m) => assembleMarketPillar(m, asOf, bandSet, pgMedianVol, snapshot, config));
  return { pgMedianVol, results };
}
