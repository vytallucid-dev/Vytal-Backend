// File: src/scoring/guardrail/signatures/b1-exceptional-gain.ts
//
// SIGNATURE B-1 — EXCEPTIONAL GAIN (PHANTOM PROFIT) — THE VI CASE (Category B, AUTO).
//
// RULEBOOK §2 B-1 (exact):
//   Condition: profitYoy > +100% in a period AND operatingMargin change within ±3pp
//     over the same period AND the implied below-operating-line amount (netProfit −
//     derived operating profit − normal tax) exceeds 40% of netProfit.
//   Thresholds: profit jump > +100% YoY; OPM flat within ±3pp; below-line > 40% of
//     net profit.
//   Metrics affected (FIXED map): SUPPRESS — ROE, ROCE, Net Margin (Foundation);
//     TTM NPM, NP-YoY (Momentum). KEEP — Operating Margin metrics, all balance-sheet
//     (D/E, Interest Coverage), Cash metrics.
//   Solution: O2 (full §0.8 dual-exclusion) + O3 annotate. Auto.
//
// FIXED METRICS-AFFECTED MAP (actual metric keys — the §4A worked example explicitly
// says "ROCE is Foundation, Net Margin is Momentum in standard mapping; use the
// actual pillar map at build"; so "Net Margin" == "TTM NPM" == M2, deduped):
//   SUPPRESS: F1 ROCE, F2 ROE, M2 TTM NPM (= Net Margin), M4 NP-YoY  → O2 dual-exclusion
//   KEEP:     M1 TTM OPM (operating), F4 D/E, F5 Interest Coverage, F3/F8/F9 cash
// Determinism of this map is what makes B-1 AUTO. "O2 + O3 annotate" = O2 WITH its
// mandatory §0.8c transparency (the raw value stays visible + the explanation is the
// flag); no separate O3 outcome is emitted (it would double-count).

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";
import { analyzeBelowLine } from "./below-line-core.js";

export const B1_PROFIT_JUMP_PCT = 100; // > +100% YoY
export const B1_OPM_FLAT_PP = 3; // ±3pp (applied via core.opmFlat3pp)
export const B1_BELOW_LINE_SHARE = 0.40; // > 40% of net profit

const SUPPRESS_MAP: AffectedMetric[] = [
  { metricKey: "F1", pillar: "foundation", reason: "ROCE — inflated by the below-line gain" },
  { metricKey: "F2", pillar: "foundation", reason: "ROE — inflated by the below-line gain" },
  { metricKey: "M2", pillar: "momentum", reason: "TTM NPM (Net Margin) — inflated by the below-line gain" },
  { metricKey: "M4", pillar: "momentum", reason: "NP-YoY — driven by the below-line gain" },
];

export const b1ExceptionalGain: Signature = {
  key: "B-1",
  category: "B",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.industryPath === "non_financial" && input.latestFundamental != null && input.priorFundamental != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior) return null;
    const a = analyzeBelowLine(curr, prior);
    // Need all three gates computable.
    if (a.profitYoyPct === null || a.opmFlat3pp === null || a.belowLineShareOfProfit === null) return null;

    const base = { signatureKey: "B-1" as const, category: "B" as const, tier: "auto" as const };
    const fired = a.profitYoyPct > B1_PROFIT_JUMP_PCT && a.opmFlat3pp && a.belowLineShareOfProfit > B1_BELOW_LINE_SHARE;
    const triggeringValues = { profitYoyPct: a.profitYoyPct, opmChangePp: a.opmChangePp, belowLineShareOfProfit: a.belowLineShareOfProfit, operatingProfitDerived: a.operatingProfitDerived, belowLineAmount: a.belowLineAmount, thresholds: { profitJump: B1_PROFIT_JUMP_PCT, opmFlatPp: B1_OPM_FLAT_PP, belowLineShare: B1_BELOW_LINE_SHARE }, notes: a.notes };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "No exceptional below-operating-line gain detected; scored normally." };
    }
    return {
      ...base, fired: true, outcome: "O2", affectedMetrics: SUPPRESS_MAP, triggeringValues,
      explanation: `Net profit this period includes a one-time gain below the operating line (~₹${a.belowLineAmount?.toFixed(0)} Cr): profit ${a.profitYoyPct.toFixed(0)}% YoY while operating margin moved ${a.opmChangePp?.toFixed(1)}pp. Profit-based metrics (ROE, ROCE, net margin, NP-YoY) are excluded from the Health Score as they don't reflect operating performance this period. Operating and balance-sheet metrics are scored normally. The raw figures remain visible, marked excluded.`,
    };
  },
};
