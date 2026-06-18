// File: src/scoring/market/universal-subcomponents.ts
//
// THE 7 UNIVERSAL MARKET SUB-COMPONENTS (spec §2), RAW-VALUE layer. PURE: no DB/IO.
// Operates on a CLEANED ascending daily-CLOSE series (from price/load.getCleanedCloses
// → price/clean — the §7.2 gating guard). Scoring (cuts/saturation/assembly) is the
// Stage-3 layer; this layer computes the raw metric + availability only.
//
// Reconciliation with Phase-4 (src/scoring/market/subcomponents.ts, trend.ts):
//   A1  REBUILT  — Phase-4 used a calendar-year window (≥180d) via rangePositionAsOf;
//                  spec wants 252 TRADING days (≥252). Close-based math reused.
//   A2  NEW      — 756 trading days; no Phase-4 equivalent.
//   B1  REUSED   — (price−200DMA)/200DMA×100; identical to Phase-4 vs_200dma.
//   B2  REBUILT  — Phase-4 counted HH/HL over 3 transitions of 4 quarters' RAW
//                  high/low → net∈[−6,+6]→5 states. New spec: same 3-transition HH/HL
//                  COUNT (max 6) but high/low derived from CLEANED CLOSES, mapped per
//                  §3 (Stage 3). Gate ≥7 quarter-end closes (§7.3).
//   B3  NEW      — volatility-normalized 21d move; Phase-4 had no equivalent.
//   C1  NEW      — 1yr RS vs peer-median (peer-pool).
//   D1  REBUILT  — Phase-4 had 90d vol + PG-median ratio; new spec's baseline is the
//                  MEDIAN 90d vol over a 3-YEAR window across peers (regime), lower-better.
//
// All windows are universal constants (252/756/200/90/21) — identical for every stock (CN-1).

import type { DailyClose } from "../price/range.js";

export const WIN = { A1: 252, A2: 756, DMA: 200, VOL: 90, MOVE: 21, YEAR: 252 } as const;
export const B2_QUARTERS_USED = 4;        // 4 quarters → 3 transitions → HH/HL count max 6
export const B2_MIN_QUARTER_CLOSES = 7;   // §7.3 exclusion gate
export const ANNUALIZE = Math.sqrt(252);

export interface SubValue {
  available: boolean;
  value: number | null;   // A1/A2 ∈[0,1]; B1 %; B2 count[0..6]; B3 std-move; C1 pp; D1 ratio
  reason: string | null;  // exclusion reason when unavailable (CN-6 labeled)
  detail: string | null;  // decomposition note
}
const ok = (value: number, detail: string): SubValue => ({ available: true, value, reason: null, detail });
const no = (reason: string): SubValue => ({ available: false, value: null, reason, detail: null });

/** Closes on or before asOf, ascending (series is assumed ascending + one row/date). */
function upTo(series: DailyClose[], asOf: Date): DailyClose[] {
  return series.filter((s) => s.date <= asOf);
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1); // sample stdev
  return Math.sqrt(v);
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}

// ── A1 / A2 — range position over a TRADING-DAY window (close-based) ──────────────
function rangePosition(series: DailyClose[], asOf: Date, win: number, label: string): SubValue {
  const s = upTo(series, asOf);
  if (s.length < win) return no(`${label}: need ${win} trading days, have ${s.length}`);
  const w = s.slice(-win).map((d) => d.close);
  const cur = w[w.length - 1];
  const lo = Math.min(...w), hi = Math.max(...w);
  if (hi === lo) return no(`${label}: degenerate range (high == low)`);
  return ok((cur - lo) / (hi - lo), `cur=${cur.toFixed(2)} lo=${lo.toFixed(2)} hi=${hi.toFixed(2)} over ${win}d`);
}
export const a1RangePosition52w = (series: DailyClose[], asOf: Date) => rangePosition(series, asOf, WIN.A1, "A1");
export const a2RangePosition3y = (series: DailyClose[], asOf: Date) => rangePosition(series, asOf, WIN.A2, "A2");

// ── B1 — position vs 200-day moving average (%) ───────────────────────────────────
export function b1Vs200Dma(series: DailyClose[], asOf: Date): SubValue {
  const s = upTo(series, asOf);
  if (s.length < WIN.DMA) return no(`B1: need ${WIN.DMA} trading days, have ${s.length}`);
  const w = s.slice(-WIN.DMA).map((d) => d.close);
  const dma = w.reduce((a, b) => a + b, 0) / w.length;
  const cur = w[w.length - 1];
  if (dma <= 0) return no("B1: non-positive 200DMA");
  return ok((cur - dma) / dma * 100, `cur=${cur.toFixed(2)} 200DMA=${dma.toFixed(2)}`);
}

// ── B2 — 4-quarter trend: count of higher-highs + higher-lows (max 6) ─────────────
// Quarter high/low derived from CLEANED CLOSES (max/min close in the quarter). 4 most
// recent COMPLETE quarters → 3 transitions → count(qHigh>prevHigh)+count(qLow>prevLow).
export function b2QuarterTrend(series: DailyClose[], asOf: Date): SubValue {
  const s = upTo(series, asOf);
  // group by calendar quarter
  const byQ = new Map<string, { hi: number; lo: number; lastDate: number }>();
  for (const d of s) {
    const y = d.date.getUTCFullYear();
    const q = Math.floor(d.date.getUTCMonth() / 3) + 1;
    const key = `${y}Q${q}`;
    const cur = byQ.get(key);
    if (!cur) byQ.set(key, { hi: d.close, lo: d.close, lastDate: d.date.getTime() });
    else { cur.hi = Math.max(cur.hi, d.close); cur.lo = Math.min(cur.lo, d.close); cur.lastDate = Math.max(cur.lastDate, d.date.getTime()); }
  }
  const quarters = [...byQ.entries()].sort((a, b) => a[1].lastDate - b[1].lastDate);
  if (quarters.length < B2_MIN_QUARTER_CLOSES) return no(`B2: need ≥${B2_MIN_QUARTER_CLOSES} quarter-end closes, have ${quarters.length}`);
  const last4 = quarters.slice(-B2_QUARTERS_USED).map((q) => q[1]);
  let count = 0;
  for (let i = 1; i < last4.length; i++) {
    if (last4[i].hi > last4[i - 1].hi) count++; // higher-high
    if (last4[i].lo > last4[i - 1].lo) count++; // higher-low
  }
  const labels = quarters.slice(-B2_QUARTERS_USED).map((q) => q[0]).join(",");
  return ok(count, `HH+HL count=${count}/6 over [${labels}]`);
}

// ── B3 — recent movement, volatility-normalized ───────────────────────────────────
export function b3RecentMove(series: DailyClose[], asOf: Date): SubValue {
  const s = upTo(series, asOf);
  if (s.length < WIN.VOL + 1) return no(`B3: need ${WIN.VOL + 1} trading days, have ${s.length}`);
  const closes = s.map((d) => d.close);
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 1 - WIN.MOVE];
  if (past === undefined || past <= 0) return no(`B3: no close ${WIN.MOVE}d back`);
  const ret21 = (cur - past) / past;
  const dailyVol = stdev(logReturns(closes.slice(-(WIN.VOL + 1)))); // 90 daily log-returns
  if (dailyVol <= 0) return no("B3: zero daily vol");
  return ok(ret21 / (dailyVol * Math.sqrt(WIN.MOVE)), `ret21=${(ret21 * 100).toFixed(2)}% dailyVol=${(dailyVol * 100).toFixed(2)}%`);
}

// ── Stock-level inputs for C1 / D1 ────────────────────────────────────────────────
export function stockOneYearReturnPct(series: DailyClose[], asOf: Date): number | null {
  const s = upTo(series, asOf);
  if (s.length < WIN.YEAR + 1) return null;
  const closes = s.map((d) => d.close);
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 1 - WIN.YEAR];
  if (past === undefined || past <= 0) return null;
  return (cur - past) / past * 100;
}
export function stockAnnualizedVol90(series: DailyClose[], asOf: Date): number | null {
  const s = upTo(series, asOf);
  if (s.length < WIN.VOL + 1) return null;
  const dailyVol = stdev(logReturns(s.slice(-(WIN.VOL + 1)).map((d) => d.close)));
  return dailyVol > 0 ? dailyVol * ANNUALIZE : null;
}

// ── C1 — 1yr relative strength vs sector (peer-median) ────────────────────────────
export function c1RelativeStrength(stockSeries: DailyClose[], asOf: Date, sectorMedian1yrPct: number | null): SubValue {
  const stk = stockOneYearReturnPct(stockSeries, asOf);
  if (stk === null) return no(`C1: need ${WIN.YEAR} trading days for 1yr return`);
  if (sectorMedian1yrPct === null) return no("C1: sector 1yr return unavailable (thin peer pool)");
  return ok(stk - sectorMedian1yrPct, `stock1yr=${stk.toFixed(2)}% − sector1yr=${sectorMedian1yrPct.toFixed(2)}%`);
}

// ── D1 — volatility vs sector baseline (lower better) ─────────────────────────────
export function d1VolRatio(stockSeries: DailyClose[], asOf: Date, sectorBaselineVol: number | null): SubValue {
  const v = stockAnnualizedVol90(stockSeries, asOf);
  if (v === null) return no(`D1: need ${WIN.VOL} trading days for 90d vol`);
  if (sectorBaselineVol === null || sectorBaselineVol <= 0) return no("D1: sector baseline vol unavailable (thin peer pool)");
  return ok(v / sectorBaselineVol, `stockVol=${(v * 100).toFixed(1)}% / baseline=${(sectorBaselineVol * 100).toFixed(1)}%`);
}

// ── PEER-POOL computations (spec §2 C1/D1; computed live from the reconciled roster) ─
export interface PeerSeries { symbol: string; series: DailyClose[] }

/** sector_1yr_return = MEDIAN of the 1yr returns of every peer (≥252d). */
export function sectorOneYearReturnMedian(peers: PeerSeries[], asOf: Date): { median: number | null; n: number; contributors: { symbol: string; ret: number }[] } {
  const contributors: { symbol: string; ret: number }[] = [];
  for (const p of peers) { const r = stockOneYearReturnPct(p.series, asOf); if (r !== null) contributors.push({ symbol: p.symbol, ret: r }); }
  return { median: median(contributors.map((c) => c.ret)), n: contributors.length, contributors };
}

/** sector_baseline_vol = MEDIAN of the 90d-annualized vols of every peer, sampled over
 *  a trailing 3-YEAR window (the sector's normal vol regime). Sampled every ~21 trading
 *  days; needs ≥4 peers each ≥90d (else D1 excluded PG-wide, §7.3). */
export function sectorBaselineVol(peers: PeerSeries[], asOf: Date): { baseline: number | null; nPeers: number; nObs: number; reason: string | null } {
  const obs: number[] = [];
  let qualifyingPeers = 0;
  const windowStart = new Date(asOf); windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 3);
  for (const p of peers) {
    const s = upTo(p.series, asOf);
    if (s.length < WIN.VOL + 1) continue;
    qualifyingPeers++;
    // sample rolling 90d annualized vol every 21 trading days across the trailing 3yr
    const inWindow = s.filter((d) => d.date >= windowStart);
    const startIdx = s.length - inWindow.length;
    for (let t = Math.max(WIN.VOL, startIdx); t < s.length; t += WIN.MOVE) {
      const v = stdev(logReturns(s.slice(t - WIN.VOL, t + 1).map((d) => d.close)));
      if (v > 0) obs.push(v * ANNUALIZE);
    }
  }
  if (qualifyingPeers < 4) return { baseline: null, nPeers: qualifyingPeers, nObs: obs.length, reason: `only ${qualifyingPeers} peers ≥90d (<4) → D1 excluded PG-wide` };
  return { baseline: median(obs), nPeers: qualifyingPeers, nObs: obs.length, reason: null };
}
