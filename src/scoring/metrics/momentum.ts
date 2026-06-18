// File: src/scoring/metrics/momentum.ts
//
// MOMENTUM raw-value metrics (M1–M5), quarterly TTM, from STANDALONE
// `quarterly_results`. PURE. No scoring. No DB. Monetary inputs ₹ Crore.
//
// TTM = trailing twelve months = the last 4 CONSECUTIVE quarters. M1/M2/M5 need 4
// consecutive; M3/M4 (YoY on a TTM basis, §8.6.1 TTM-vs-TTM) need 8 consecutive
// (two back-to-back TTM windows). "Consecutive" = chronological quarter ordinals
// with step 1, no gap. Insufficient consecutive quarters ⇒ UNAVAILABLE + reason
// (this feeds the L3-insufficient / missing-data handling later).
//
// DEFINITIONS (stated):
//   Operating profit (M1) = EBITDA, PRE-depreciation     = PBT + interest + depreciation
//                           (depreciation ADDED BACK; interest added back; OTHER INCOME
//                           left IN — PBT already includes it and it is NOT subtracted).
//                           This MIRRORS the annual EBITDA operating-margin derivation
//                           term-for-term (ingest-indas-annual.ts: ebitda = PBT +
//                           financeCosts + depreciation) so the TTM live value matches
//                           the bar's derivation basis. SHARED across ALL 11 non-financial
//                           PGs (PG8's M1_OPM_TTM emit-renames this same fn — there is NO
//                           separate PG8 OPM function). Quarterly `interest` IS the
//                           finance-costs line (see types.ts MomentumQuarter.interest).
//   EBIT (M5)             = PBT + interest                 (INCLUDES other income;
//                           the coverage convention, matches annual F5). NOTE the
//                           DELIBERATE asymmetry: OPM is PRE-depreciation (EBITDA);
//                           coverage (M5/F5) and ROCE (F1) are POST-depreciation (EBIT).

import {
  quarterOrdinal,
  type MomentumQuarter,
  type MetricValue,
} from "./types.js";

const r2 = (x: number) => Math.round(x * 10000) / 10000;

const unavailable = (
  key: string, label: string, unit: MetricValue["unit"],
  reason: MetricValue["reason"], detail: string, inputs: MetricValue["inputs"] = {},
): MetricValue => ({
  key, label, available: false, value: null, unit, source: "none", formula: detail, inputs, reason, flags: [],
});

/** The maximal run of consecutive quarters ENDING at the latest quarter. Returns
 *  them oldest→newest. e.g. [.., FY25Q4, FY26Q1, FY26Q2, FY26Q3, FY26Q4]. */
export function consecutiveTail(quarters: MomentumQuarter[]): MomentumQuarter[] {
  if (quarters.length === 0) return [];
  const sorted = [...quarters].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const run: MomentumQuarter[] = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].qOrdinal === run[0].qOrdinal - 1) run.unshift(sorted[i]);
    else break;
  }
  return run;
}

/** Sum a field over a set of quarters; null if ANY quarter is missing the field
 *  (a TTM with a hole is not a valid TTM). */
function ttmSum(qs: MomentumQuarter[], pick: (q: MomentumQuarter) => number | null): number | null {
  let sum = 0;
  for (const q of qs) {
    const v = pick(q);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

// EBITDA operating profit (the SHARED OPM basis): PBT + interest + depreciation.
// Depreciation is ADDED BACK (pre-depreciation), interest added back, OTHER INCOME
// left IN (PBT includes it; NOT subtracted) — mirrors the annual EBITDA derivation
// term-for-term. Does NOT use operatingProfitStored (that column is EBIT, excl OI).
const opEbitda = (q: MomentumQuarter): number | null =>
  q.profitBeforeTax !== null && q.interest !== null && q.depreciation !== null
    ? q.profitBeforeTax + q.interest + q.depreciation
    : null;

const ebit = (q: MomentumQuarter): number | null =>
  q.profitBeforeTax !== null && q.interest !== null ? q.profitBeforeTax + q.interest : null;

const span = (qs: MomentumQuarter[]) => `${qs[0].fiscalYear}${qs[0].quarter}…${qs[qs.length - 1].fiscalYear}${qs[qs.length - 1].quarter}`;

// ── M1 TTM OPM % = TTM EBITDA operating profit / TTM revenue × 100 ───────────────
// EBITDA basis (PRE-depreciation): Σ4Q(PBT+interest+depreciation) / Σ4Q(revenue) × 100.
// This is the SHARED OPM function for ALL 11 non-financial PGs. PG8's M1_OPM_TTM key
// emit-renames THIS SAME function (see live-dispatch.ts emitAs) — there is no separate
// PG8 OPM fn. It mirrors the annual EBITDA operating-margin derivation (F1_OPM) so the
// live TTM value scores against bars derived on the same basis (was EBIT before — a
// model-wide definitional mismatch that floored EBITDA-derived stocks like NTPC).
export function m1TtmOpm(run: MomentumQuarter[]): MetricValue {
  if (run.length < 4) return unavailable("M1", "TTM OPM %", "%", "insufficient_history", `need 4 consecutive quarters, have ${run.length}`, { consecutive: run.length });
  const ttm = run.slice(-4);
  const op = ttmSum(ttm, opEbitda);
  const rev = ttmSum(ttm, (q) => q.revenue);
  if (op === null || rev === null) return unavailable("M1", "TTM OPM %", "%", "missing_line_item", "PBT, interest, depreciation, or revenue null in a TTM quarter");
  if (rev === 0) return unavailable("M1", "TTM OPM %", "%", "divide_by_zero", "TTM revenue = 0");
  const value = (op / rev) * 100;
  return {
    key: "M1", label: "TTM OPM %", available: true, value, unit: "%", source: "derived",
    formula: `TTM OPM (EBITDA) = Σ(PBT+interest+depr) ${r2(op)} / Σrev ${r2(rev)} × 100 = ${r2(value)}%  (${span(ttm)})`,
    inputs: { ttmEbitda: r2(op), ttmRevenue: r2(rev), window: span(ttm) },
    reason: null,
    flags: ["TTM OPM = EBITDA-based (PBT+interest+depreciation)/revenue — PRE-depreciation, other income left in; mirrors the annual EBITDA OPM (F1_OPM) derivation. SHARED across all 11 non-financial PGs; PG8 M1_OPM_TTM emit-renames this same fn"],
  };
}

// ── M2 TTM NPM % = TTM net profit / TTM revenue × 100 ──────────────────────────
export function m2TtmNpm(run: MomentumQuarter[]): MetricValue {
  if (run.length < 4) return unavailable("M2", "TTM NPM %", "%", "insufficient_history", `need 4 consecutive quarters, have ${run.length}`, { consecutive: run.length });
  const ttm = run.slice(-4);
  const np = ttmSum(ttm, (q) => q.netProfit);
  const rev = ttmSum(ttm, (q) => q.revenue);
  if (np === null || rev === null) return unavailable("M2", "TTM NPM %", "%", "missing_line_item", "net profit or revenue null in a TTM quarter");
  if (rev === 0) return unavailable("M2", "TTM NPM %", "%", "divide_by_zero", "TTM revenue = 0");
  const value = (np / rev) * 100;
  return {
    key: "M2", label: "TTM NPM %", available: true, value, unit: "%", source: "derived",
    formula: `TTM NPM = Σnp ${r2(np)} / Σrev ${r2(rev)} × 100 = ${r2(value)}%  (${span(ttm)})`,
    inputs: { ttmNetProfit: r2(np), ttmRevenue: r2(rev), window: span(ttm) },
    reason: null, flags: [],
  };
}

// ── M3 Revenue YoY (TTM basis) % = (TTM_now − TTM_prior)/TTM_prior × 100 ────────
export function m3RevenueYoyTtm(run: MomentumQuarter[]): MetricValue {
  if (run.length < 8) return unavailable("M3", "Revenue YoY (TTM) %", "%", "insufficient_history", `need 8 consecutive quarters (two TTM windows), have ${run.length}`, { consecutive: run.length });
  const last8 = run.slice(-8);
  const now = last8.slice(4); // most recent 4
  const prior = last8.slice(0, 4); // the 4 before that
  const revNow = ttmSum(now, (q) => q.revenue);
  const revPrior = ttmSum(prior, (q) => q.revenue);
  if (revNow === null || revPrior === null) return unavailable("M3", "Revenue YoY (TTM) %", "%", "missing_line_item", "revenue null in a TTM window");
  if (revPrior <= 0) return unavailable("M3", "Revenue YoY (TTM) %", "%", "non_positive_base", `prior TTM revenue ${r2(revPrior)} ≤ 0`);
  const value = ((revNow - revPrior) / revPrior) * 100;
  return {
    key: "M3", label: "Revenue YoY (TTM) %", available: true, value, unit: "%", source: "derived",
    formula: `RevYoY = (TTMnow ${r2(revNow)} [${span(now)}] − TTMprior ${r2(revPrior)} [${span(prior)}]) / ${r2(revPrior)} × 100 = ${r2(value)}%`,
    inputs: { ttmRevNow: r2(revNow), ttmRevPrior: r2(revPrior) },
    reason: null, flags: ["§8.6.1 TTM-vs-TTM (NOT single-quarter YoY)"],
  };
}

// ── M4 Net Profit YoY (TTM basis) % ─────────────────────────────────────────────
export function m4NetProfitYoyTtm(run: MomentumQuarter[]): MetricValue {
  if (run.length < 8) return unavailable("M4", "Net Profit YoY (TTM) %", "%", "insufficient_history", `need 8 consecutive quarters, have ${run.length}`, { consecutive: run.length });
  const last8 = run.slice(-8);
  const now = last8.slice(4);
  const prior = last8.slice(0, 4);
  const npNow = ttmSum(now, (q) => q.netProfit);
  const npPrior = ttmSum(prior, (q) => q.netProfit);
  if (npNow === null || npPrior === null) return unavailable("M4", "Net Profit YoY (TTM) %", "%", "missing_line_item", "net profit null in a TTM window");
  if (npPrior <= 0) return unavailable("M4", "Net Profit YoY (TTM) %", "%", "non_positive_base", `prior TTM PAT ${r2(npPrior)} ≤ 0 — YoY % undefined`);
  const value = ((npNow - npPrior) / npPrior) * 100;
  return {
    key: "M4", label: "Net Profit YoY (TTM) %", available: true, value, unit: "%", source: "derived",
    formula: `NPYoY = (TTMnow ${r2(npNow)} [${span(now)}] − TTMprior ${r2(npPrior)} [${span(prior)}]) / ${r2(npPrior)} × 100 = ${r2(value)}%`,
    inputs: { ttmNpNow: r2(npNow), ttmNpPrior: r2(npPrior) },
    reason: null, flags: ["§8.6.1 TTM-vs-TTM; prior-TTM PAT≤0 → undefined (marked unavailable)"],
  };
}

// ── M5 TTM Interest Coverage = TTM EBIT / TTM finance costs ─────────────────────
export function m5TtmInterestCoverage(run: MomentumQuarter[]): MetricValue {
  if (run.length < 4) return unavailable("M5", "TTM Interest Coverage", "x", "insufficient_history", `need 4 consecutive quarters, have ${run.length}`, { consecutive: run.length });
  const ttm = run.slice(-4);
  const ttmEbit = ttmSum(ttm, ebit);
  const ttmInt = ttmSum(ttm, (q) => q.interest);
  if (ttmEbit === null || ttmInt === null) return unavailable("M5", "TTM Interest Coverage", "x", "missing_line_item", "PBT or interest null in a TTM quarter");
  if (ttmInt <= 0) return unavailable("M5", "TTM Interest Coverage", "x", "divide_by_zero", `TTM finance costs ${r2(ttmInt)} ≤ 0 → coverage undefined`);
  const value = ttmEbit / ttmInt;
  return {
    key: "M5", label: "TTM Interest Coverage", available: true, value, unit: "x", source: "derived",
    formula: `TTM IC = ΣEBIT ${r2(ttmEbit)} / Σinterest ${r2(ttmInt)} = ${r2(value)}x  (${span(ttm)})`,
    inputs: { ttmEbit: r2(ttmEbit), ttmInterest: r2(ttmInt), window: span(ttm) },
    reason: null, flags: ["EBIT = PBT + interest (includes other income), matches annual F5"],
  };
}

// ── Aggregate: all 5 Momentum metrics at the latest standalone quarter ──────────
export interface MomentumResult {
  snapshotQuarter: string; // e.g. "FY26Q4"
  consecutiveQuarters: number;
  metrics: MetricValue[];
}
export function computeMomentum(quarters: MomentumQuarter[]): MomentumResult | null {
  if (quarters.length === 0) return null;
  const run = consecutiveTail(quarters);
  const snap = run[run.length - 1];
  return {
    snapshotQuarter: `${snap.fiscalYear}${snap.quarter}`,
    consecutiveQuarters: run.length,
    metrics: [
      m1TtmOpm(run),
      m2TtmNpm(run),
      m3RevenueYoyTtm(run),
      m4NetProfitYoyTtm(run),
      m5TtmInterestCoverage(run),
    ],
  };
}

export { quarterOrdinal };
