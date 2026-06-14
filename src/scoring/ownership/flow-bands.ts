// File: src/scoring/ownership/flow-bands.ts
//
// UNIVERSAL Ownership-Flow band cuts. ONE set for every stock — explicitly NOT
// keyed per-PG (do NOT wire these to per-PG percentiles the way Market does).
// These mirror the schema's OwnershipFlowBandSet rows (bandType =
// c_net_insider | d_net_block | trend_bonus); the write path get-or-creates those
// rows from these constants and stamps the version each category used.
//
// Spec-final magnitudes (operator: NOT calibration knobs).

/** Engine version stamped onto get-or-created OwnershipFlowBandSet rows. */
export const FLOW_BAND_VERSION = 1;

export interface BandLanding {
  key: string; // stored in OwnershipFlowCategory.bandLanded
  points: number;
}

// ── Category C3 — net insider ₹-value bands (rolling 30 days), in ₹ crore ──────
//   net sell > ₹3cr → −4 ; net sell ₹1–3cr → −2 ; within ±₹1cr → 0 ;
//   net buy ₹1–3cr → +2 ; net buy > ₹3cr → +3
export function landInsiderNetBand(netInrCr: number): BandLanding {
  if (netInrCr > 3) return { key: "net_buy_gt_3cr", points: +3 };
  if (netInrCr > 1) return { key: "net_buy_1_3cr", points: +2 };
  if (netInrCr >= -1) return { key: "neutral_within_1cr", points: 0 };
  if (netInrCr >= -3) return { key: "net_sell_1_3cr", points: -2 };
  return { key: "net_sell_gt_3cr", points: -4 };
}

// ── Category D — net block flow as % of MARKET CAP (rolling 30 days) ───────────
//   net sell > 0.5% → −6 ; net sell 0.1–0.5% → −3 ; within ±0.1% → 0 ;
//   net buy 0.1–0.5% → +3 ; net buy > 0.5% → +6
export function landBlockNetBand(netPctOfMcap: number): BandLanding {
  if (netPctOfMcap > 0.5) return { key: "net_buy_gt_0p5pct", points: +6 };
  if (netPctOfMcap > 0.1) return { key: "net_buy_0p1_0p5pct", points: +3 };
  if (netPctOfMcap >= -0.1) return { key: "neutral_within_0p1pct", points: 0 };
  if (netPctOfMcap >= -0.5) return { key: "net_sell_0p1_0p5pct", points: -3 };
  return { key: "net_sell_gt_0p5pct", points: -6 };
}

// ── 90-day trend bonus (Categories C & D only) ────────────────────────────────
// Direction-persistence read (NOT the Foundation/Momentum Lens-3 Z-anchor). Take
// the signed net-flow band direction in each of the three consecutive trailing
// 30-day windows in the last 90 days. All three share the same non-zero sign →
// ±2; mixed or any neutral → 0. Applied BEFORE the category cap.
export type TrendState = "three_up" | "three_down" | "mixed" | "neutral";

export const TREND_BONUS_VALUE = 2;

/** Classify the trend from the three windows' band SIGNS (newest-first or oldest-
 * first both fine — only unanimity matters). */
export function classifyTrend(windowSigns: number[]): TrendState {
  if (windowSigns.length < 3) return "neutral"; // not enough windows → no persistence
  const signs = windowSigns.slice(0, 3).map((s) => Math.sign(s));
  if (signs.some((s) => s === 0)) return "mixed"; // any neutral window breaks persistence
  if (signs.every((s) => s > 0)) return "three_up";
  if (signs.every((s) => s < 0)) return "three_down";
  return "mixed";
}

export function trendBonus(state: TrendState): number {
  if (state === "three_up") return +TREND_BONUS_VALUE;
  if (state === "three_down") return -TREND_BONUS_VALUE;
  return 0; // mixed | neutral
}

