// File: src/scoring/guardrail/signatures/c2-share-count.ts
//
// SIGNATURE C-2 — SHARE-COUNT DISCONTINUITY (bonus / split / rights) (Category C).
//
// RULEBOOK §3 C-2 (exact):
//   Condition: CorporateEvent.eventType in (bonus, split, rights) OR noOfShares /
//     adjustedSharesCr changes > 20% between periods.
//   Threshold: event flag (clean), or > 20% share-count change.
//   Metrics affected: per-share metrics (EPS, book value per share). Bonus/split are
//     cosmetic (price-adjusted); rights/issuance are real dilution.
//   Solution: O1 Score normally for bonus/split (already price-adjusted in
//     DailyPrice); O3 Annotate for rights/major issuance (real dilution, flag it).
//   Auto/Review: AUTO for bonus/split (clean event + price adjusted). REVIEW for
//     large issuance.
//
// ⚠ DATA-ADJUSTMENT, NOT A DISTORTION (flagged — the prompt asks to confirm this):
//   • bonus/split → O1: the price/per-share figures are ALREADY split-adjusted in
//     DailyPrice; nothing to suppress. We DO NOT suppress a value that should just
//     be split-rescaled. Logged for the audit trail; no directive.
//   • rights/major issuance → O3 annotate (REVIEW): real dilution, flagged.
//   C-2 NEVER writes a suppression directive. Its target "per-share metrics"
//   (EPS / book-value-per-share) are NOT in the current F/M metric set (Foundation
//   F1–F10 / Momentum M1–M5 contain no per-share metric), so there is no metric to
//   suppress even for the rights case — it is annotation-only. FLAGGED.
//
// DYNAMIC TIER: result.tier is auto for the O1 (bonus/split) firing and review for
// the O3 (rights/issuance) firing — the gate routes on result.tier (not the static
// descriptor tier). The descriptor lists C-2 as auto (its common bonus/split case).

import type { Signature, SignatureResult, GuardrailStockInput } from "../types.js";

export const C2_SHARE_CHANGE_PCT = 20; // > 20% share-count change

export const c2ShareCount: Signature = {
  key: "C-2",
  category: "C",
  tier: "auto", // bonus/split common case; rights firing sets result.tier="review"

  applies(input: GuardrailStockInput): boolean {
    const ca = input.corporateAction;
    return ca != null && ((ca.eventTypes != null && ca.eventTypes.length > 0) || ca.shareCountChangePct != null);
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const ca = input.corporateAction;
    if (!ca) return null;
    const types = ca.eventTypes ?? [];
    const hasBonusSplit = types.includes("bonus") || types.includes("split");
    const hasRights = types.includes("rights");
    const bigShareChange = ca.shareCountChangePct != null && Math.abs(ca.shareCountChangePct) > C2_SHARE_CHANGE_PCT;
    const fired = hasBonusSplit || hasRights || bigShareChange;

    const baseTrigger = { eventTypes: types, shareCountChangePct: ca.shareCountChangePct ?? null, threshold: C2_SHARE_CHANGE_PCT };
    if (!fired) {
      return { signatureKey: "C-2", category: "C", tier: "auto", fired: false, outcome: "O1", affectedMetrics: [], triggeringValues: baseTrigger, explanation: "No share-count discontinuity; scored normally." };
    }

    // Rights / major issuance (real dilution) → O3 annotate, REVIEW.
    const dilution = hasRights || (bigShareChange && !hasBonusSplit);
    if (dilution) {
      return {
        signatureKey: "C-2", category: "C", tier: "review", fired: true, outcome: "O3",
        affectedMetrics: [], // per-share metrics (EPS/BVPS) are not in the F/M set → no metric to suppress
        triggeringValues: { ...baseTrigger, kind: hasRights ? "rights_issue" : "major_issuance" },
        explanation: `${input.symbol} issued new shares this period (${hasRights ? "rights" : "major issuance"}${ca.shareCountChangePct != null ? `, share count ${ca.shareCountChangePct.toFixed(0)}%` : ""}). This is real dilution — per-share metrics reflect the larger share count. Flagged for review.`,
      };
    }

    // Bonus / split — cosmetic, ALREADY price/per-share adjusted → O1 (data-adjustment), AUTO.
    return {
      signatureKey: "C-2", category: "C", tier: "auto", fired: true, outcome: "O1",
      affectedMetrics: [],
      triggeringValues: { ...baseTrigger, kind: "bonus_split", note: "price already split-adjusted in DailyPrice" },
      explanation: `${input.symbol} had a bonus/split this period — a cosmetic share-count change already reflected in split-adjusted prices. Scored normally (no suppression; this is a data adjustment, not a distortion). Logged.`,
    };
  },
};
