// File: src/scoring/market/subcomponents.ts
//
// Sub-component RAW VALUES from a daily CLOSE series (pure; no DB). Three of the
// four live here; the categorical 4-quarter trend is in trend.ts.
//   S1 range_52w   — SHARED kernel rangePositionAsOf (CN-1) → position % of range.
//   S2 vs_200dma   — (price − 200DMA)/200DMA × 100.
//   S3 volatility  — 90-day daily-return σ (the PG-median RATIO is formed later,
//                    in market.ts, once every member's σ is known).
// Availability mirrors the spec's history requirements; an unmet requirement is a
// RECORDED unavailable + reason, never a silent value.

import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../price/range.js";

export const MIN_200DMA_DAYS = 200; // ≥200 closes for a 200-day average
export const VOL_WINDOW = 90; // 90-day volatility window (90 returns ⇒ 91 closes)

export interface RawSub {
  available: boolean;
  value: number | null;
  reason: string | null;
  notes: string[];
}

/** All closes on or before asOf (series is ascending-date, one row per date). */
const closesAsOf = (series: DailyClose[], asOf: Date): DailyClose[] => series.filter((s) => s.date <= asOf);

// ── S1: 52-week range position (%) — the SHARED kernel, ≥180 trailing days ───────
export interface Range52wRaw extends RawSub {
  low: number | null;
  high: number | null;
  close: number | null;
  positionFraction: number | null; // 0..1 (the kernel's native unit; A1 uses this)
  evalDate: string | null;
}
export function computeRange52w(series: DailyClose[], asOf: Date): Range52wRaw {
  const rp = rangePositionAsOf(series, asOf); // CN-1 single source
  return {
    available: rp.available,
    value: rp.position === null ? null : rp.position * 100, // → percent of range
    positionFraction: rp.position,
    low: rp.low, high: rp.high, close: rp.close, evalDate: rp.evalDate,
    reason: rp.reason,
    notes: rp.available ? [`52w range [${rp.low?.toFixed(2)}, ${rp.high?.toFixed(2)}], ${rp.trailingDays}d (≥${MIN_TRAILING_DAYS})`] : [],
  };
}

// ── S2: position vs 200-day moving average (%) ───────────────────────────────────
export function compute200dma(series: DailyClose[], asOf: Date): RawSub & { dma: number | null; price: number | null } {
  const closes = closesAsOf(series, asOf);
  if (closes.length < MIN_200DMA_DAYS) {
    return { available: false, value: null, dma: null, price: null, reason: `only ${closes.length} closes (<${MIN_200DMA_DAYS}) for 200-DMA`, notes: [] };
  }
  const last200 = closes.slice(-MIN_200DMA_DAYS);
  const dma = last200.reduce((a, c) => a + c.close, 0) / last200.length;
  const price = closes[closes.length - 1].close;
  if (dma === 0) {
    return { available: false, value: null, dma: 0, price, reason: "200-DMA is zero", notes: [] };
  }
  return { available: true, value: ((price - dma) / dma) * 100, dma, price, reason: null, notes: [`200DMA=${dma.toFixed(2)}, price=${price.toFixed(2)}`] };
}

// ── S3: 90-day volatility (σ of daily simple returns). PG-median ratio later. ─────
export function compute90dVolatility(series: DailyClose[], asOf: Date): RawSub & { nReturns: number } {
  const closes = closesAsOf(series, asOf);
  if (closes.length < VOL_WINDOW + 1) {
    return { available: false, value: null, nReturns: Math.max(0, closes.length - 1), reason: `only ${closes.length} closes (<${VOL_WINDOW + 1}) for 90d volatility`, notes: [] };
  }
  const win = closes.slice(-(VOL_WINDOW + 1)); // VOL_WINDOW+1 closes → VOL_WINDOW returns
  const returns: number[] = [];
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1].close;
    if (prev === 0) continue;
    returns.push(win[i].close / prev - 1);
  }
  if (returns.length < VOL_WINDOW) {
    return { available: false, value: null, nReturns: returns.length, reason: `only ${returns.length} usable returns (<${VOL_WINDOW})`, notes: [] };
  }
  const mean = returns.reduce((a, r) => a + r, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length; // population σ
  const sigma = Math.sqrt(variance);
  return { available: true, value: sigma, nReturns: returns.length, reason: null, notes: [`σ(daily ret, ${returns.length}d)=${(sigma * 100).toFixed(3)}%`] };
}

/** Population median of a numeric array (sorted copy). */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
