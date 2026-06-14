// File: src/scoring/guardrail/signatures/b3-tax-distortion.ts
//
// SIGNATURE B-3 — TAX-DRIVEN DISTORTION (Category B, AUTO).
//
// RULEBOOK §2 B-3 (exact):
//   Condition: tax negative (tax credit) OR effective tax rate (tax/PBT) < 5% in a
//     period where it's normally > 20% AND the resulting netProfit swing > 50% YoY
//     while profitBeforeTax (pre-tax) swing is < 25%.
//   Thresholds: eff tax < 5% (or negative) vs normal > 20%; NP swing > 50% while
//     pre-tax swing < 25% (the swing comes from the tax line, not the business).
//   Metrics affected: SUPPRESS — Net Margin, ROE, NP-YoY (post-tax). KEEP —
//     everything pre-tax (Operating Margin, ROCE if computed on EBIT, Revenue growth).
//   Solution: O3 Annotate (often cleaner — tax effects usually smaller; suppress
//     only if the distortion is large enough to flip the metric's band).
//   Auto/Review: AUTO.
//
// FIXED MAP (actual keys): SUPPRESS F2 ROE, M2 TTM NPM (Net Margin), M4 NP-YoY (all
//   post-tax). KEEP F1 ROCE (our EBIT = PBT + finance costs is PRE-tax → unaffected),
//   M1 OPM, M3 Revenue YoY. Default O3 annotate; → O2 ONLY if a band-flip is detected
//   (input.bandFlipDetected — a forward-dependency, see FLAG).

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";
import { analyzeBelowLine } from "./below-line-core.js";

export const B3_EFF_TAX_MAX = 0.05; // < 5% (or negative)
export const B3_NORMAL_TAX_MIN = 0.20; // "normally > 20%" baseline (prior year as proxy)
export const B3_NP_SWING_MIN = 50; // net-profit swing > 50%
export const B3_PBT_SWING_MAX = 25; // pre-tax swing < 25%

const SUPPRESS_MAP: AffectedMetric[] = [
  { metricKey: "F2", pillar: "foundation", reason: "ROE — post-tax, distorted by the tax line" },
  { metricKey: "M2", pillar: "momentum", reason: "TTM NPM (Net Margin) — post-tax" },
  { metricKey: "M4", pillar: "momentum", reason: "NP-YoY — driven by the tax swing" },
];

export const b3TaxDistortion: Signature = {
  key: "B-3",
  category: "B",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.industryPath === "non_financial" && input.latestFundamental != null && input.priorFundamental != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior) return null;
    const a = analyzeBelowLine(curr, prior);
    if (a.effTaxRateCurr === null || a.npSwingPctAbs === null || a.pbtSwingPctAbs === null) return null;

    // "normally > 20%" baseline — prior-year eff tax as the proxy (flagged if absent).
    const notes = [...a.notes];
    let priorEffTax: number | null = null;
    if (prior.tax != null && prior.profitBeforeTax != null && prior.profitBeforeTax > 1e-9) priorEffTax = prior.tax / prior.profitBeforeTax;
    const normalBaselineOk = priorEffTax === null ? true : priorEffTax > B3_NORMAL_TAX_MIN;
    if (priorEffTax === null) notes.push("prior-year effective tax unavailable → 'normally > 20%' baseline unverified (proceeding on current-rate condition)");

    const base = { signatureKey: "B-3" as const, category: "B" as const, tier: "auto" as const };
    const lowOrNegTax = a.effTaxRateCurr < B3_EFF_TAX_MAX; // < 5% incl negative
    const divergence = a.npSwingPctAbs > B3_NP_SWING_MIN && a.pbtSwingPctAbs < B3_PBT_SWING_MAX;
    const fired = lowOrNegTax && normalBaselineOk && divergence;

    const triggeringValues = { effTaxRateCurr: a.effTaxRateCurr, priorEffTax, npSwingPctAbs: a.npSwingPctAbs, pbtSwingPctAbs: a.pbtSwingPctAbs, thresholds: { effTaxMax: B3_EFF_TAX_MAX, normalTaxMin: B3_NORMAL_TAX_MIN, npSwingMin: B3_NP_SWING_MIN, pbtSwingMax: B3_PBT_SWING_MAX }, bandFlipDetected: !!input.bandFlipDetected, notes };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "No tax-driven distortion detected; scored normally." };
    }
    // Default O3 annotate; escalate to O2 only if a band-flip is detected (§4 table).
    const outcome = input.bandFlipDetected ? "O2" : "O3";
    return {
      ...base, fired: true, outcome, affectedMetrics: SUPPRESS_MAP, triggeringValues,
      explanation: `Net profit this period was affected by a one-time tax adjustment (effective tax ${(a.effTaxRateCurr * 100).toFixed(1)}%; net-profit swing ${a.npSwingPctAbs.toFixed(0)}% vs pre-tax swing ${a.pbtSwingPctAbs.toFixed(0)}%). Post-tax metrics (ROE, net margin, NP-YoY) are ${outcome === "O2" ? "excluded" : "flagged"}; pre-tax operating metrics are unaffected. See breakdown.`,
    };
  },
};
