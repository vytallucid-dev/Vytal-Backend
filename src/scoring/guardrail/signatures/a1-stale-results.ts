// File: src/scoring/guardrail/signatures/a1-stale-results.ts
//
// SIGNATURE A-1 — STALE / NON-FILED RESULTS (Category A, data integrity, AUTO).
//
// RULEBOOK §1 A-1 (exact):
//   Condition: latest expected quarter's QuarterlyResult row absent > 45 days after
//     the expected report date (prior-year same-quarter reportDate + CorporateEvent
//     earnings date where available).
//   Threshold: 45 calendar days past expected filing (SEBI LODR 45-day rule).
//   Metrics affected: all Momentum (TTM-based) metrics that need the latest quarter.
//   Solution: O5 Hold — keep last clean composite. If non-filing persists > 2
//     consecutive quarters → escalate to O6 Remove (flag for operator).
//   Auto/Review: AUTO (hold); the 2-quarter → remove escalation flags the operator.
//
// OUTCOME MECHANICS: O5/O6 are WHOLE-STOCK actions (not per-metric suppression), so
// affectedMetrics is empty — a hold freezes the entire composite at the last clean
// value; a remove exits scoring + the peer set. The O6 escalation routes through
// resolveOutcome's O6 path, which sets requiresOperatorConfirm = true (the §0.6 O6
// peer-set-integrity confirm). The "metrics affected = Momentum TTM" fact is carried
// in triggeringValues for the audit, but no directive is written (the whole stock
// holds, so there is nothing to selectively suppress).

import type { Signature, SignatureResult, GuardrailStockInput } from "../types.js";

/** SEBI LODR: listed cos must file within 45 days of quarter-end. */
export const STALE_DAYS_THRESHOLD = 45;
/** > 2 consecutive missed quarters → escalate Hold → Remove. */
export const REMOVE_ESCALATION_QUARTERS = 2;

export const a1StaleResults: Signature = {
  key: "A-1",
  category: "A",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.quarterlyFiling != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const qf = input.quarterlyFiling;
    if (!qf) return null;

    const base = { signatureKey: "A-1" as const, category: "A" as const, tier: "auto" as const, affectedMetrics: [] };
    const late = qf.daysPastExpected !== null && qf.daysPastExpected > STALE_DAYS_THRESHOLD;

    if (!late) {
      return { ...base, fired: false, outcome: "O1", triggeringValues: { daysPastExpected: qf.daysPastExpected, threshold: STALE_DAYS_THRESHOLD }, explanation: "Latest quarterly results filed within the 45-day window; scored normally." };
    }

    const escalateRemove = qf.consecutiveMissedQuarters > REMOVE_ESCALATION_QUARTERS;
    const triggeringValues = { daysPastExpected: qf.daysPastExpected, threshold: STALE_DAYS_THRESHOLD, consecutiveMissedQuarters: qf.consecutiveMissedQuarters, metricsAffected: "all Momentum TTM metrics (need the latest quarter)" };

    if (escalateRemove) {
      // > 2 consecutive quarters non-filing → O6 Remove (operator-confirm via O6).
      return {
        ...base, fired: true, outcome: "O6", triggeringValues,
        explanation: `Quarterly results not filed for ${qf.consecutiveMissedQuarters} consecutive quarters (>${REMOVE_ESCALATION_QUARTERS}); recommended removal from active scoring and the peer set pending operator confirmation.`,
      };
    }
    // 1–2 quarters late → O5 Hold (auto).
    return {
      ...base, fired: true, outcome: "O5", triggeringValues,
      explanation: "Latest quarterly results not yet filed. Health Score reflects data through the last filed quarter; it will update when new results are published.",
    };
  },
};
