// File: src/scoring/guardrail/signatures/below-line-core.ts
//
// SHARED CATEGORY-B DETECTION CORE (§2). The whole B-family keys on ONE pattern:
// the distortion lives BELOW the operating line — the operating line stays honest,
// while the bottom line (net profit / return ratios) moves sharply. So every B
// signature is, at heart: "bottom-line metric moved sharply WHILE operating-line
// metric stayed flat." Pure arithmetic, CN-4 clean. This module computes that common
// arithmetic ONCE from current vs prior annual fundamentals; each B signature
// (b1…b4, b5) reads the fields it needs and applies its OWN thresholds + fixed
// metrics-affected map. Built once, specialized per signature.
//
// All monetary inputs are ₹ Crore; operatingMargin is the stored EBITDA-based %
// (metrics/types.ts) — see FLAG: the "operating line" the B-family tests is the
// stored EBITDA margin, not a separately-derived EBIT margin.

import type { LatestFundamentalInput } from "../types.js";

export interface BelowLineAnalysis {
  netProfitCurr: number | null;
  netProfitPrior: number | null;
  /** Signed net-profit YoY % (only when prior > 0; else null — a non-positive base
   *  makes the % undefined, surfaced via profitSignFlip / drop instead). */
  profitYoyPct: number | null;
  /** Positive = a DROP (prior − curr)/prior × 100, prior > 0 only. */
  profitDropPct: number | null;
  /** Profit went from positive to negative (the B-2 sign-flip case). */
  profitSignFlip: boolean;
  /** |curr − prior| net-profit swing (₹Cr) and its % of |prior|. */
  profitSwingAbs: number | null;
  npSwingPctAbs: number | null;

  /** Operating-margin change in percentage POINTS (curr − prior). */
  opmChangePp: number | null;
  opmCurrentPositive: boolean | null;
  /** |Δ OPM| ≤ 3pp — the "operating line stayed flat" test. */
  opmFlat3pp: boolean | null;

  /** |PBT swing| as % of |prior PBT| (the pre-tax line — B-3's < 25% gate). */
  pbtSwingPctAbs: number | null;
  /** Effective tax rate = tax / PBT (PBT > 0 only). */
  effTaxRateCurr: number | null;

  /** Other income as a share of PBT (B-4's > 30% gate). */
  otherIncomeShareOfPbt: number | null;

  /** Derived operating profit = revenue × operatingMargin — the "derived operating
   *  profit" the rulebook's below-line formula references. Computed FROM THE MARGIN
   *  (not PBT) ON PURPOSE: an exceptional gain/charge sits IN PBT, so a PBT-based
   *  operating proxy would absorb the very distortion we want to isolate. The margin
   *  is the honest operating line; deriving op-profit from it leaves the one-off in
   *  the gap to net profit. (operatingMargin is EBITDA-based — see FLAG.) */
  operatingProfitDerived: number | null;
  /** Implied below-operating-line amount = netProfit − derived-operating-profit-
   *  after-tax. Tax-adjusted by the PERIOD's actual effective rate (no invented
   *  "normal tax" constant — CN-8); pre-tax if PBT ≤ 0 (flagged in notes). */
  belowLineAmount: number | null;
  /** |belowLineAmount| / |netProfit| — B-1's "> 40% of net profit" gate. */
  belowLineShareOfProfit: number | null;
  /** |belowLineAmount| / profitSwingAbs — B-2's "> 40% of the swing" gate. */
  belowLineShareOfSwing: number | null;

  notes: string[];
}

const pct = (num: number, den: number) => (num / den) * 100;

/** Compute the shared below-the-line arithmetic. Returns null-filled fields wherever
 *  inputs are absent; signatures gate on the specific fields they need. */
export function analyzeBelowLine(curr: LatestFundamentalInput, prior: LatestFundamentalInput): BelowLineAnalysis {
  const notes: string[] = [];
  const a: BelowLineAnalysis = {
    netProfitCurr: curr.netProfit, netProfitPrior: prior.netProfit,
    profitYoyPct: null, profitDropPct: null, profitSignFlip: false, profitSwingAbs: null, npSwingPctAbs: null,
    opmChangePp: null, opmCurrentPositive: null, opmFlat3pp: null,
    pbtSwingPctAbs: null, effTaxRateCurr: null, otherIncomeShareOfPbt: null,
    operatingProfitDerived: null, belowLineAmount: null, belowLineShareOfProfit: null, belowLineShareOfSwing: null,
    notes,
  };

  // ── Net-profit movement ──
  if (curr.netProfit !== null && prior.netProfit !== null) {
    a.profitSwingAbs = Math.abs(curr.netProfit - prior.netProfit);
    a.profitSignFlip = prior.netProfit > 0 && curr.netProfit < 0;
    if (Math.abs(prior.netProfit) > 1e-9) a.npSwingPctAbs = Math.abs(pct(curr.netProfit - prior.netProfit, Math.abs(prior.netProfit)));
    if (prior.netProfit > 0) {
      a.profitYoyPct = pct(curr.netProfit - prior.netProfit, prior.netProfit);
      a.profitDropPct = pct(prior.netProfit - curr.netProfit, prior.netProfit); // +ve = drop
    } else {
      notes.push("prior net profit ≤ 0 → YoY % undefined (using sign-flip / swing instead)");
    }
  }

  // ── Operating line (stored EBITDA margin %) ──
  if (curr.operatingMargin != null && prior.operatingMargin != null) {
    a.opmChangePp = curr.operatingMargin - prior.operatingMargin;
    a.opmCurrentPositive = curr.operatingMargin > 0;
    a.opmFlat3pp = Math.abs(a.opmChangePp) <= 3;
  } else {
    notes.push("operatingMargin missing (curr or prior) → operating-line-flat test unavailable");
  }

  // ── Pre-tax / tax ──
  if (curr.profitBeforeTax != null && prior.profitBeforeTax != null && Math.abs(prior.profitBeforeTax) > 1e-9) {
    a.pbtSwingPctAbs = Math.abs(pct(curr.profitBeforeTax - prior.profitBeforeTax, Math.abs(prior.profitBeforeTax)));
  }
  if (curr.profitBeforeTax != null && curr.tax != null && curr.profitBeforeTax > 1e-9) {
    a.effTaxRateCurr = curr.tax / curr.profitBeforeTax;
  }

  // ── Other income share of PBT ──
  if (curr.otherIncome != null && curr.profitBeforeTax != null && Math.abs(curr.profitBeforeTax) > 1e-9) {
    a.otherIncomeShareOfPbt = curr.otherIncome / curr.profitBeforeTax;
  }

  // ── Below-the-line amount (derived operating profit FROM THE MARGIN) ──
  if (curr.operatingMargin != null && curr.revenue != null) {
    a.operatingProfitDerived = (curr.revenue * curr.operatingMargin) / 100;
    if (curr.netProfit !== null) {
      let opProfitAfterTax = a.operatingProfitDerived;
      if (a.effTaxRateCurr !== null) opProfitAfterTax = a.operatingProfitDerived * (1 - a.effTaxRateCurr);
      else notes.push("below-line: no usable effective tax rate (PBT ≤ 0) → derived operating profit taken pre-tax");
      a.belowLineAmount = curr.netProfit - opProfitAfterTax;
      if (Math.abs(curr.netProfit) > 1e-9) a.belowLineShareOfProfit = Math.abs(a.belowLineAmount) / Math.abs(curr.netProfit);
      if (a.profitSwingAbs !== null && a.profitSwingAbs > 1e-9) a.belowLineShareOfSwing = Math.abs(a.belowLineAmount) / a.profitSwingAbs;
    }
  } else {
    notes.push("below-line amount unavailable (need revenue & operatingMargin to derive operating profit)");
  }

  return a;
}
