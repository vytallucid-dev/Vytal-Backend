// File: src/scoring/market/trend.ts
//
// SUB-COMPONENT 4 — 4-QUARTER TREND STRUCTURE (pure). Derives a CATEGORICAL state
// (trending_up / consolidating_up / range / consolidating_down / trending_down)
// from the higher-highs/higher-lows price pattern across four trailing quarters.
//
// DERIVATION (deterministic, structural — CN-8, nothing fitted):
//   1. Bucket the trailing ~12 months of daily CLOSE into 4 calendar quarters by
//      3-month date offsets from the as-of day (Q1 oldest → Q4 newest). Each
//      quarter needs ≥ MIN_QUARTER_DAYS closes; all 4 required → else unavailable.
//   2. Per quarter take HIGH = max close, LOW = min close.
//   3. Over the 3 quarter-to-quarter transitions, count higher-highs / lower-highs
//      and higher-lows / lower-lows.
//   4. Classify on the classic HH/HL structure:
//        trending_up      : ≥2 higher-highs AND ≥2 higher-lows   (clean HH+HL)
//        trending_down    : ≥2 lower-highs  AND ≥2 lower-lows    (clean LH+LL)
//        consolidating_up : up-structure (HH+HL) outweighs down  (up bias, not clean)
//        consolidating_down: down-structure outweighs up         (down bias, not clean)
//        range            : up and down structure balanced       (no directional bias)
// trending_up & trending_down are mutually exclusive (≥2 of 3 up ⇒ ≤1 down).

import type { DailyClose } from "../price/range.js";
import type { TrendStructure } from "./types.js";

/** Min closes per quarter bucket for the quarter to count (≈ a month of trading). */
export const MIN_QUARTER_DAYS = 20;

export interface QuarterBlock {
  label: string; // "Q1".."Q4" (Q4 newest)
  high: number;
  low: number;
  n: number;
}

export interface TrendResult {
  available: boolean;
  state: TrendStructure | null;
  quarters: QuarterBlock[];
  upHighs: number;
  downHighs: number;
  upLows: number;
  downLows: number;
  /** (upHighs+upLows) − (downHighs+downLows), in [−6,+6]. Stored as the raw value. */
  net: number;
  reason: string | null;
}

/** asOf shifted back by `months` (UTC). */
function monthsBefore(asOf: Date, months: number): Date {
  const d = new Date(asOf);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function block(series: DailyClose[], startExcl: Date, endIncl: Date, label: string): QuarterBlock | null {
  const inWin = series.filter((s) => s.date > startExcl && s.date <= endIncl);
  if (inWin.length < MIN_QUARTER_DAYS) return null;
  let hi = -Infinity, lo = Infinity;
  for (const s of inWin) {
    if (s.close > hi) hi = s.close;
    if (s.close < lo) lo = s.close;
  }
  return { label, high: hi, low: lo, n: inWin.length };
}

export function computeTrendStructure(series: DailyClose[], asOf: Date): TrendResult {
  // Four 3-month buckets, oldest (Q1) → newest (Q4).
  const b = [
    monthsBefore(asOf, 12),
    monthsBefore(asOf, 9),
    monthsBefore(asOf, 6),
    monthsBefore(asOf, 3),
    asOf,
  ];
  const quarters = [
    block(series, b[0], b[1], "Q1"),
    block(series, b[1], b[2], "Q2"),
    block(series, b[2], b[3], "Q3"),
    block(series, b[3], b[4], "Q4"),
  ];

  if (quarters.some((q) => q === null)) {
    const have = quarters.filter((q) => q !== null).length;
    return {
      available: false, state: null, quarters: quarters.filter((q): q is QuarterBlock => q !== null),
      upHighs: 0, downHighs: 0, upLows: 0, downLows: 0, net: 0,
      reason: `only ${have}/4 quarters have ≥${MIN_QUARTER_DAYS} closes`,
    };
  }
  const qs = quarters as QuarterBlock[];

  let upHighs = 0, downHighs = 0, upLows = 0, downLows = 0;
  for (let i = 1; i < 4; i++) {
    if (qs[i].high > qs[i - 1].high) upHighs++;
    else if (qs[i].high < qs[i - 1].high) downHighs++;
    if (qs[i].low > qs[i - 1].low) upLows++;
    else if (qs[i].low < qs[i - 1].low) downLows++;
  }

  const up = upHighs + upLows;
  const down = downHighs + downLows;
  let state: TrendStructure;
  if (upHighs >= 2 && upLows >= 2) state = "trending_up";
  else if (downHighs >= 2 && downLows >= 2) state = "trending_down";
  else if (up > down) state = "consolidating_up";
  else if (down > up) state = "consolidating_down";
  else state = "range";

  return { available: true, state, quarters: qs, upHighs, downHighs, upLows, downLows, net: up - down, reason: null };
}
