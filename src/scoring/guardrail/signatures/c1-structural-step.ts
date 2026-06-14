// File: src/scoring/guardrail/signatures/c1-structural-step.ts
//
// SIGNATURE C-1 — REVENUE/ASSET STEP-CHANGE (merger/demerger signature) (Cat C, REVIEW).
// THE O4 CASE — the reason Part 1 extended the consumer.
//
// RULEBOOK §3 C-1 (exact):
//   Condition: revenue OR totalAssets changes > 30% YoY in a single period AND no
//     corresponding organic driver (discontinuous, not a growth ramp) AND ideally
//     corroborated by a CorporateEvent near the date.
//   Threshold: > 30% single-period step in revenue or assets (organic large-cap
//     growth rarely exceeds ~20%/yr; > 30% signals a structural change).
//   Metrics affected: all YoY growth metrics (Revenue YoY, NP YoY, 3y CAGR) — the
//     base changed, so growth comparisons are invalid for the transition period.
//   Solution: O4 Suppress peer comparison + O3 annotate; growth metrics held until
//     clean post-event periods accumulate. Operator decides PG membership.
//   Auto/Review: REVIEW (operator applies the merger/demerger rulebook).
//
// WHY O4 (not O2): a merger makes the growth metric jump (e.g. revenue +80%) — that
// is REAL for the stock (it IS bigger), so it stays in the stock's OWN score; but it
// grew by ABSORPTION, not organically, so its value must NOT inflate the peer mean
// others are compared against. Keep own, drop peer = O4 (own_score=false,
// peer_mean=true). This is exactly the consumer capability Part 1 proved.
//
// FIXED MAP (actual keys): M3 Revenue YoY (TTM), M4 NP YoY (TTM), F10 Revenue 3y CAGR.
// (The doc's "Revenue YoY / NP YoY / 3y CAGR" — see §4A 'use the actual pillar map'.)
// "O4 + O3 annotate" = O4 with its transparency note (the explanation IS the flag),
// consistent with B-1's "O2 + O3"; no separate O3 outcome emitted.
//
// MECHANICAL vs OPERATOR: the > 30% step is the mechanical trigger; "no organic
// driver / discontinuous" and the PG-membership question are OPERATOR judgments —
// which is why C-1 is REVIEW (routes through review.ts; nothing applies until ruled).

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";

export const C1_STEP_PCT = 30; // > 30% YoY step in revenue or assets

const GROWTH_MAP: AffectedMetric[] = [
  { metricKey: "M3", pillar: "momentum", reason: "Revenue YoY — base changed (structural step); peer comparison invalid this period" },
  { metricKey: "M4", pillar: "momentum", reason: "NP YoY — base changed; peer comparison invalid this period" },
  { metricKey: "F10", pillar: "foundation", reason: "Revenue 3y CAGR — base changed; peer comparison invalid this period" },
];

const stepPct = (curr: number | null, prior: number | null): number | null =>
  curr !== null && prior !== null && Math.abs(prior) > 1e-9 ? Math.abs((curr - prior) / prior) * 100 : null;

export const c1StructuralStep: Signature = {
  key: "C-1",
  category: "C",
  tier: "review",

  applies(input: GuardrailStockInput): boolean {
    return input.latestFundamental != null && input.priorFundamental != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior) return null;
    const revStep = stepPct(curr.revenue, prior.revenue);
    const assetStep = stepPct(curr.totalAssets, prior.totalAssets);
    if (revStep === null && assetStep === null) return null; // can't evaluate

    const base = { signatureKey: "C-1" as const, category: "C" as const, tier: "review" as const };
    const revFired = revStep !== null && revStep > C1_STEP_PCT;
    const assetFired = assetStep !== null && assetStep > C1_STEP_PCT;
    const fired = revFired || assetFired;
    const corroborated = !!input.corporateAction?.hasNearbyEvent;
    const triggeringValues = { revenueStepPct: revStep, totalAssetsStepPct: assetStep, threshold: C1_STEP_PCT, corroboratingEvent: corroborated, drivers: [revFired ? "revenue" : null, assetFired ? "totalAssets" : null].filter(Boolean) };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "No structural revenue/asset step-change detected; scored normally." };
    }
    // O4 proposed (peer-only) + transparency note; REVIEW (operator rules + PG-membership).
    return {
      ...base, fired: true, outcome: "O4", affectedMetrics: GROWTH_MAP, triggeringValues,
      explanation: `${input.symbol} underwent a structural change this period (${[revFired ? `revenue ${revStep!.toFixed(0)}%` : null, assetFired ? `assets ${assetStep!.toFixed(0)}%` : null].filter(Boolean).join(", ")} YoY step${corroborated ? ", corroborated by a corporate event" : ""}). Year-over-year growth comparisons are excluded from the PEER cross-section (the growth is real for the stock but inorganic — it grew by absorption); the stock keeps its own reading. Comparisons resume once post-event periods are comparable. Other metrics scored normally.`,
    };
  },
};
