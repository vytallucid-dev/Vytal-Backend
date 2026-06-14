// File: src/scoring/guardrail/signatures/b4-other-income.ts
//
// SIGNATURE B-4 — OTHER-INCOME INFLATION (Category B, AUTO).
//
// RULEBOOK §2 B-4 (exact):
//   Condition: otherIncome > 30% of profitBeforeTax in a period where it's normally
//     < 10%.
//   Threshold: otherIncome > 30% of PBT (vs normal < 10%) — catches gains parked in
//     other income (asset-sale, investment MTM, forex) inflating profit with no
//     operating cause.
//   Metrics affected: SUPPRESS — profit-based metrics where other-income inflates
//     the numerator. KEEP — Operating Margin (excludes other income by construction).
//   Solution: O3 Annotate (or O2 if large enough to flip a band). Auto.
//
// FIXED MAP (actual keys; the "profit-based metrics inflated by other income" set is
// MADE EXPLICIT here — flagged as an interpretation since the doc gives a description,
// not a list): SUPPRESS F1 ROCE (our EBIT = PBT + finance costs INCLUDES other income
// → inflated), F2 ROE, M2 TTM NPM (Net Margin), M4 NP-YoY. KEEP M1 TTM OPM (excludes
// other income by construction), revenue/balance-sheet. NOTE the principled contrast
// with B-3: tax sits BELOW EBIT (B-3 keeps ROCE); other income is WITHIN our EBIT
// (B-4 suppresses ROCE). Default O3 annotate; → O2 only if a band-flip is detected.

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";
import { analyzeBelowLine } from "./below-line-core.js";

export const B4_OTHER_INCOME_SHARE_MAX = 0.30; // > 30% of PBT
export const B4_NORMAL_OTHER_INCOME_MAX = 0.10; // "normally < 10%" baseline (prior as proxy)

const SUPPRESS_MAP: AffectedMetric[] = [
  { metricKey: "F1", pillar: "foundation", reason: "ROCE — EBIT (PBT + finance costs) includes other income → inflated" },
  { metricKey: "F2", pillar: "foundation", reason: "ROE — other income inflates net profit" },
  { metricKey: "M2", pillar: "momentum", reason: "TTM NPM (Net Margin) — inflated by other income" },
  { metricKey: "M4", pillar: "momentum", reason: "NP-YoY — driven by other income" },
];

export const b4OtherIncome: Signature = {
  key: "B-4",
  category: "B",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.industryPath === "non_financial" && input.latestFundamental != null && input.priorFundamental != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior) return null;
    const a = analyzeBelowLine(curr, prior);
    if (a.otherIncomeShareOfPbt === null) return null;

    // "normally < 10%" baseline — prior-year other-income share as proxy.
    const notes = [...a.notes];
    let priorShare: number | null = null;
    if (prior.otherIncome != null && prior.profitBeforeTax != null && Math.abs(prior.profitBeforeTax) > 1e-9) priorShare = prior.otherIncome / prior.profitBeforeTax;
    const normalBaselineOk = priorShare === null ? true : priorShare < B4_NORMAL_OTHER_INCOME_MAX;
    if (priorShare === null) notes.push("prior-year other-income share unavailable → 'normally < 10%' baseline unverified (proceeding on current condition)");

    const base = { signatureKey: "B-4" as const, category: "B" as const, tier: "auto" as const };
    const fired = a.otherIncomeShareOfPbt > B4_OTHER_INCOME_SHARE_MAX && normalBaselineOk;
    const triggeringValues = { otherIncomeShareOfPbt: a.otherIncomeShareOfPbt, priorShare, thresholds: { shareMax: B4_OTHER_INCOME_SHARE_MAX, normalMax: B4_NORMAL_OTHER_INCOME_MAX }, bandFlipDetected: !!input.bandFlipDetected, notes };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "Other income within normal range; scored normally." };
    }
    const outcome = input.bandFlipDetected ? "O2" : "O3";
    return {
      ...base, fired: true, outcome, affectedMetrics: SUPPRESS_MAP, triggeringValues,
      explanation: `A significant portion of profit this period came from non-operating other income (${(a.otherIncomeShareOfPbt * 100).toFixed(0)}% of pre-tax profit; e.g. investment/asset-sale gains). Operating metrics are unaffected; profit metrics (ROCE, ROE, net margin, NP-YoY) are ${outcome === "O2" ? "excluded" : "flagged"}. See breakdown.`,
    };
  },
};
