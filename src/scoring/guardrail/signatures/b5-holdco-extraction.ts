// File: src/scoring/guardrail/signatures/b5-holdco-extraction.ts
//
// SIGNATURE B-5 — HOLDCO EXTRACTION — VEDANTA / HZ CASE (Category B, REVIEW).
//
// RULEBOOK §2 B-5 (exact):
//   Condition: netWorth (or reserves) falls > 25% YoY AND netProfit is positive that
//     year (equity shrank from extraction — special dividend / capital return to the
//     controlling parent — not from losses) AND promoter holding > 50%.
//   Thresholds: reserves/net-worth drop > 25% YoY; net profit positive; promoter > 50%.
//   Metrics affected: ANNOTATE — ROE, ROCE (arithmetically INFLATED by the shrunk
//     equity denominator — the inflation IS the distortion; the tricky reverse case
//     where the metric looks BETTER for a bad reason).
//   Solution: O3 Annotate (do NOT suppress — the ROE is real arithmetic per CN-4;
//     flag that it's inflated by reserve depletion).
//   Auto/Review: REVIEW (genuinely subtle — keep a human in the loop).
//
// PROPOSED OUTCOME = O3 (annotate). Because tier = REVIEW, the gate does NOT apply
// this — it writes the audit event and HOLDS a PendingReview; the annotation applies
// only after an operator rules `upheld` (review.ts). B-5 NEVER produces a suppression
// directive (the doc is explicit: do NOT suppress, the ROE is real). ⚠ FLAG: this
// build's prompt asked to demo "upheld → suppression"; per the doc B-5 upheld →
// ANNOTATION, not suppression. The harness proves the upheld→suppression path with a
// separate synthetic O2 review case routed through the SAME machine.

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";

export const B5_NETWORTH_DROP_PCT = 25; // > 25% YoY reserves/net-worth drop
export const B5_PROMOTER_MIN_PCT = 50; // promoter > 50%

const ANNOTATE_MAP: AffectedMetric[] = [
  { metricKey: "F1", pillar: "foundation", reason: "ROCE — inflated by the shrunk equity/capital denominator (extraction)" },
  { metricKey: "F2", pillar: "foundation", reason: "ROE — inflated by the shrunk equity denominator (extraction)" },
];

export const b5HoldcoExtraction: Signature = {
  key: "B-5",
  category: "B",
  tier: "review",

  applies(input: GuardrailStockInput): boolean {
    return input.latestFundamental != null && input.priorFundamental != null && input.promoterPct != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior || input.promoterPct == null) return null;
    if (curr.netWorth === null || prior.netWorth === null || prior.netWorth <= 0 || curr.netProfit === null) return null;

    const netWorthDropPct = ((prior.netWorth - curr.netWorth) / prior.netWorth) * 100; // +ve = drop
    const base = { signatureKey: "B-5" as const, category: "B" as const, tier: "review" as const };
    const fired = netWorthDropPct > B5_NETWORTH_DROP_PCT && curr.netProfit > 0 && input.promoterPct > B5_PROMOTER_MIN_PCT;
    const triggeringValues = { netWorthDropPct, netWorthPrior: prior.netWorth, netWorthCurr: curr.netWorth, netProfit: curr.netProfit, promoterPct: input.promoterPct, thresholds: { netWorthDrop: B5_NETWORTH_DROP_PCT, promoterMin: B5_PROMOTER_MIN_PCT } };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "No HoldCo-extraction pattern detected; scored normally." };
    }
    // Proposed O3 annotate (do NOT suppress). Tier review → held for operator ruling.
    return {
      ...base, fired: true, outcome: "O3", affectedMetrics: ANNOTATE_MAP, triggeringValues,
      explanation: `Return ratios (ROE/ROCE) this period are elevated partly because shareholder equity was reduced by large special dividends/capital return to the controlling shareholder (net worth ${netWorthDropPct.toFixed(0)}% lower YoY while the company was profitable, promoter ${input.promoterPct.toFixed(0)}%). Strong return ratios here partly reflect a smaller equity base, not only operating strength. See breakdown.`,
    };
  },
};
