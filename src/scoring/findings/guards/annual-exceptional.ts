// File: src/scoring/findings/guards/annual-exceptional.ts
//
// ANNUAL exceptional-item guard — the GENUINE guardrail reuse. Unlike the quarterly OPM
// guard (exceptional-opm.ts, which had to approximate because P11 is quarterly and the
// engine's b2/b3 are annual), the NP-based annual rules (P7 accruals, P12 positive-side)
// read the SAME annual fundamentals the guardrail signatures evaluate — so we run the
// engine's ACTUAL b1/b2/b3 signatures (via runGuardrailGate) and read their verdict. This
// is the guard-reuse the principle intends, at a grain where it fits exactly.
//
// b1 (exceptional GAIN) inflates NP below the operating line → fakes an accruals divergence
//   (NP≫OCF) and a margin "recovery"; b2 (exceptional LOSS) deflates NP; b3 (tax distortion)
//   swings NP via the tax line. Any of these makes a single year's NP-vs-cash reading unsafe.

import { runGuardrailGate } from "../../guardrail/gate.js";
import type { GuardrailStockInput, LatestFundamentalInput } from "../../guardrail/types.js";
import { netWorthFrom, type FoundationAnnual } from "../../metrics/types.js";

function toFundInput(r: FoundationAnnual): LatestFundamentalInput {
  return {
    fiscalYear: r.fiscalYear,
    revenue: r.revenue,
    netProfit: r.netProfit,
    netWorth: netWorthFrom(r),
    totalAssets: r.totalAssets,
    profitBeforeTax: r.profitBeforeTax,
    // FoundationAnnual carries no `tax` column — derive it: tax = PBT − NP.
    tax: r.profitBeforeTax !== null && r.netProfit !== null ? r.profitBeforeTax - r.netProfit : null,
    otherIncome: r.otherIncome,
    financeCosts: r.financeCosts,
    operatingMargin: r.stored.operatingMargin, // stored EBITDA-based annual OPM (the clean operating line)
  };
}

export interface AnnualExceptionalVerdict {
  evaluated: boolean; // false ⇒ <2 annual rows, couldn't run the gate
  gain: boolean;      // B-1 exceptional gain (NP inflated)
  loss: boolean;      // B-2 exceptional loss (NP deflated)
  tax: boolean;       // B-3 tax-driven distortion
  /** Any NP-distorting exceptional in the latest annual period. */
  distorted: boolean;
  fired: string[];    // all guardrail signature keys that fired (audit)
}

/** Run the engine's b1/b2/b3 (+ the rest) on the LATEST annual period (curr vs prior). */
export function annualExceptionalLatest(annuals: FoundationAnnual[]): AnnualExceptionalVerdict {
  if (annuals.length < 2) return { evaluated: false, gain: false, loss: false, tax: false, distorted: false, fired: [] };
  const sorted = [...annuals].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const latest = sorted[sorted.length - 1], prior = sorted[sorted.length - 2];
  const input: GuardrailStockInput = {
    stockId: "", symbol: "", industryPath: "non_financial", snapshotKey: latest.fiscalYear,
    latestFundamental: toFundInput(latest), priorFundamental: toFundInput(prior),
  };
  const fired = runGuardrailGate(input).events.map((e) => e.signatureKey);
  const gain = fired.includes("B-1"), loss = fired.includes("B-2"), tax = fired.includes("B-3");
  return { evaluated: true, gain, loss, tax, distorted: gain || loss || tax, fired };
}
