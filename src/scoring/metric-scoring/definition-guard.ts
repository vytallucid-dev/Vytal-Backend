// File: src/scoring/metric-scoring/definition-guard.ts
//
// THE DEFINITION-MATCH GUARD (companion to unit-guard.ts).
//
// unit-guard.ts catches a SCALE mismatch (ratio value vs percent bars). This module
// catches a DEFINITION mismatch: the live compute function must compute a metric on
// the SAME definition the bar-set was DERIVED on. A compute fn that uses EBIT while
// the bars were derived on EBITDA (the model-wide OPM bug), or full-ICF/direct-capex
// while the bars used the ΔNetBlock+Dep+ΔCWIP capex-proxy (the F8 bug), produces a
// plausible-but-wrong L1 with no error. This module pins each metric's CANONICAL
// definition as (a) a human-readable signature string and (b) an INDEPENDENT pure
// recompute. The verification harness (definition-guard-check.ts) feeds known inputs
// to the ENGINE function and to the canonical recompute here and asserts they agree
// (and that the WRONG definition does NOT) — so a regression to a non-canonical
// definition fails loudly. PURE: no DB, no I/O.
//
// CN-8: these recomputes ARE the spec definitions transcribed; they tune nothing.
// The asymmetry is DELIBERATE and load-bearing: OPM is PRE-depreciation (EBITDA);
// ROCE and Interest Coverage are POST-depreciation (EBIT). Do not "unify" them.

export interface MetricDefinition {
  key: string;
  pillar: "foundation" | "momentum";
  /** The canonical definition the bar-set was derived on (must match the compute fn). */
  signature: string;
  /** The WRONG definition this guard exists to reject (documentation of the failure mode). */
  rejects: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  M1: {
    key: "M1", pillar: "momentum",
    signature: "TTM OPM = Σ4Q(PBT + interest + depreciation) / Σ4Q(revenue) × 100  (EBITDA, PRE-depreciation, other income left in)",
    rejects: "EBIT operating profit = Σ(PBT + interest − otherIncome) (POST-depreciation, OI excluded) — the pre-fix definition that floored EBITDA-derived stocks",
  },
  M1_OPM_TTM: {
    key: "M1_OPM_TTM", pillar: "momentum",
    signature: "= M1 (the SHARED EBITDA m1TtmOpm, emit-renamed). Σ4Q(PBT+interest+depreciation)/Σ4Q(revenue)×100",
    rejects: "a separate PG8-only OPM definition (there is none — M1 and M1_OPM_TTM are identical)",
  },
  F1: {
    key: "F1", pillar: "foundation",
    signature: "ROCE = (PBT + interest) / (net worth + total debt) × 100  (EBIT, POST-depreciation; year-end, point-in-time, NOT averaged)",
    rejects: "depreciation added back (would be EBITDA — that is OPM's basis, NOT ROCE's); or an AVERAGED capital-employed denominator",
  },
  F5: {
    key: "F5", pillar: "foundation",
    signature: "Interest Coverage = (PBT + interest) / interest  (EBIT, POST-depreciation)",
    rejects: "EBITDA / interest (depreciation added back) — coverage is EBIT-based, not EBITDA-based",
  },
  M5: {
    key: "M5", pillar: "momentum",
    signature: "TTM Interest Coverage = Σ4Q(PBT + interest) / Σ4Q(interest)  (EBIT, POST-depreciation; matches annual F5)",
    rejects: "EBITDA-based coverage (depreciation added back)",
  },
  F7: {
    key: "F7", pillar: "foundation",
    signature: "Asset Turnover = revenue / total assets (year-end)",
    rejects: "revenue / (net block + CWIP) — fixed-asset turnover, NOT total-asset turnover",
  },
  F8: {
    key: "F8", pillar: "foundation",
    signature: "FCF/PAT = mean over ≤4 FY of (OCF − capexProxy)/PAT, capexProxy = ΔNetBlock + depreciation + ΔCWIP  (per-year ratios, then mean)",
    rejects: "capex = direct CF PP&E-purchase line OR full Investing Cash Flow; or a ratio-of-sums instead of a mean-of-ratios",
  },
  F3: {
    key: "F3", pillar: "foundation",
    signature: "Cash Conversion = (OCF + buyback) / PAT  (buyback = 0 in the normal/ESC-stable path)",
    rejects: "a definition that omits the buyback term or divides by revenue instead of PAT",
  },
  F10: {
    key: "F10", pillar: "foundation",
    signature: "Revenue 3y CAGR = (rev_t / rev_{t-3})^(1/3) − 1 × 100  (cube-root, 3-year)",
    rejects: "a simple 3y total-growth % (not annualized) or a square-root/other exponent",
  },
};

// ── INDEPENDENT canonical recomputes (the spec formulas, transcribed from scratch) ──
// These deliberately do NOT call the engine — they are the second, independent witness
// the harness compares the engine against.

/** OPM TTM (EBITDA): last-4 Σ(pbt+int+dep)/Σrev×100. null if any input null or <4Q. */
export function canonicalOpmTtmEbitda(qs: { pbt: number | null; interest: number | null; dep: number | null; rev: number | null }[]): number | null {
  if (qs.length < 4) return null;
  const last4 = qs.slice(-4);
  let op = 0, rev = 0;
  for (const q of last4) {
    if (q.pbt === null || q.interest === null || q.dep === null || q.rev === null) return null;
    op += q.pbt + q.interest + q.dep;
    rev += q.rev;
  }
  return rev === 0 ? null : (op / rev) * 100;
}

/** The WRONG (pre-fix) EBIT OPM, for the negative assertion. */
export function legacyOpmTtmEbit(qs: { pbt: number | null; interest: number | null; otherIncome: number | null; rev: number | null }[]): number | null {
  if (qs.length < 4) return null;
  const last4 = qs.slice(-4);
  let op = 0, rev = 0;
  for (const q of last4) {
    if (q.pbt === null || q.interest === null || q.rev === null) return null;
    op += q.pbt + q.interest - (q.otherIncome ?? 0);
    rev += q.rev;
  }
  return rev === 0 ? null : (op / rev) * 100;
}

export const canonicalRoce = (pbt: number, financeCosts: number, netWorth: number, totalDebt: number): number =>
  ((pbt + financeCosts) / (netWorth + totalDebt)) * 100;

export const canonicalInterestCoverage = (pbt: number, financeCosts: number): number =>
  (pbt + financeCosts) / financeCosts;

export const canonicalAssetTurnover = (revenue: number, totalAssets: number): number =>
  revenue / totalAssets;

/** FCF/PAT mean-of-ratios with the canonical capex-proxy ΔNetBlock+Dep+ΔCWIP. */
export function canonicalFcfPat(
  years: { ocf: number; ppe: number; ppePrior: number; dep: number; cwip: number; cwipPrior: number; np: number }[],
): number {
  const ratios = years.map((y) => {
    const capexProxy = (y.ppe - y.ppePrior) + y.dep + (y.cwip - y.cwipPrior);
    return (y.ocf - capexProxy) / y.np;
  });
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export const canonicalCashConversion = (ocf: number, buyback: number, pat: number): number =>
  (ocf + buyback) / pat;

export const canonicalRev3yCagr = (revEnd: number, revBegin: number): number =>
  (Math.pow(revEnd / revBegin, 1 / 3) - 1) * 100;
