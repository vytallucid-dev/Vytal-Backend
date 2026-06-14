// File: src/scoring/guardrail/signatures/a4-inactive.ts
//
// SIGNATURE A-4 — INACTIVE / SUSPENDED (Category A, data integrity).
//
// RULEBOOK §1 A-4 (exact):
//   Condition: Stock.isActive = false, OR no DailyPrice row for > 10 consecutive
//     trading days (suspension signature).
//   Threshold: isActive flag, or 10-trading-day price gap.
//   Metrics affected: All (Market pillar especially).
//   Solution: O6 Remove from active scoring AND the peer set. Recommended-action
//     flag to operator for confirmation (one-tap), since removal changes peer-set
//     scores for every other stock in the PG.
//   Auto/Review: Detection AUTO; removal flagged for operator one-tap confirm.
//
// OUTCOME MECHANICS: O6 is a WHOLE-STOCK action (affectedMetrics empty). It routes
// through resolveOutcome's O6 path, which produces a `remove` StockLevelAction with
// requiresOperatorConfirm = true — the §0.6 O6 peer-set-integrity one-tap confirm.
// This is OPERATOR-CONFIRM (a recommended, decided action), NOT review-tier
// (operator RULING on an undecided outcome) — so A-4 stays AUTO and does NOT use the
// score_guardrail_reviews path (that is B-5 only). The distinction: confirm a known
// remove vs. rule on an open question.

import type { Signature, SignatureResult, GuardrailStockInput } from "../types.js";

/** > 10 consecutive trading days with no DailyPrice row = suspension signature. */
export const PRICE_GAP_TRADING_DAYS = 10;

export const a4Inactive: Signature = {
  key: "A-4",
  category: "A",
  tier: "auto", // detection auto; removal flagged for operator confirm (on the O6 action)

  applies(input: GuardrailStockInput): boolean {
    return input.activity != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const a = input.activity;
    if (!a) return null;

    const inactive = a.isActive === false;
    const priceGap = a.consecutiveNoPriceDays > PRICE_GAP_TRADING_DAYS;
    const base = { signatureKey: "A-4" as const, category: "A" as const, tier: "auto" as const, affectedMetrics: [] };

    if (!inactive && !priceGap) {
      return { ...base, fired: false, outcome: "O1", triggeringValues: { isActive: a.isActive, consecutiveNoPriceDays: a.consecutiveNoPriceDays }, explanation: "Stock active and trading; scored normally." };
    }

    const cause = inactive ? "marked inactive (isActive=false)" : `no price for ${a.consecutiveNoPriceDays} consecutive trading days (> ${PRICE_GAP_TRADING_DAYS})`;
    return {
      ...base,
      fired: true,
      outcome: "O6", // remove (operator one-tap confirm via resolveOutcome O6)
      triggeringValues: { isActive: a.isActive, consecutiveNoPriceDays: a.consecutiveNoPriceDays, threshold: PRICE_GAP_TRADING_DAYS, cause },
      explanation: `Stock is currently suspended/inactive (${cause}). Health Score paused until trading resumes; recommended removal from active scoring and the peer set pending operator confirmation.`,
    };
  },
};
