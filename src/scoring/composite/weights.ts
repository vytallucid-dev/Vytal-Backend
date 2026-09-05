// File: src/scoring/composite/weights.ts
//
// PURE composite pillar weights + the §14.4 SNAPSHOT-LEVEL redistribution. No DB.
//
// The four pillar weights are UNIVERSALLY LOCKED (CN-1) — never per-PG, never
// fitted (CN-8). When a pillar comes back UNAVAILABLE (PillarState =
// unavailable_redistributed — Market with no price history, or Foundation/Momentum
// below the §14.4 metric floor), it is REMOVED from the blend and the surviving
// pillars' weights are RENORMALIZED to sum to 1.0, preserving their RELATIVE
// proportions (w_i / Σ surviving). The APPLIED set is stored per snapshot.

import type { Pillar, WeightRedistributionReason } from "./types.js";

/** §-locked composite weights. Foundation is the heaviest — the anchor. */
export const PILLAR_WEIGHTS: Record<Pillar, number> = {
  foundation: 0.35,
  momentum: 0.25,
  market: 0.2,
  ownership: 0.2,
};
export const ALL_PILLARS: Pillar[] = ["foundation", "momentum", "market", "ownership"];

// ── MINIMUM-PILLARS-TO-SCORE RULE (the edge guard) ──────────────────────────────
// A balanced Health Score needs (a) its ANCHOR and (b) breadth. Rule:
//   • FOUNDATION must be available — it is the fundamentals bedrock (heaviest
//     weight, .35); a "health score" with no fundamentals is not one. If Foundation
//     is unavailable the composite is UNAVAILABLE.
//   • At least MIN_SURVIVING_PILLARS (2) pillars must survive — with only one
//     pillar the "composite" is that pillar renormalized to 1.0 (i.e. relabelled),
//     which is misleading. ≥2 also matches the ≥50%-present boundary used at the
//     metric/sub-component floors (consistency across the stack).
// Below either condition → composite unavailable (a RECORDED state), never a
// fabricated number from scraps. (A stricter ≥3 is a one-line change — flagged.)
export const ANCHOR_PILLAR: Pillar = "foundation";
export const MIN_SURVIVING_PILLARS = 2;

export interface RedistributionResult {
  /** Applied weight per pillar — surviving sum to 1.0, unavailable = 0. */
  weights: Record<Pillar, number>;
  reason: WeightRedistributionReason;
  surviving: Pillar[];
  unavailable: Pillar[];
  /** false ⇒ minimum-pillars rule failed → composite must be marked unavailable. */
  canScore: boolean;
  canScoreReason: string;
}

/**
 * Redistribute the locked weights over the available pillars.
 * @param available which pillars are usable (state scored && subtotal present)
 */
export function redistributeWeights(available: Record<Pillar, boolean>): RedistributionResult {
  const surviving = ALL_PILLARS.filter((p) => available[p]);
  const unavailable = ALL_PILLARS.filter((p) => !available[p]);

  const sum = surviving.reduce((a, p) => a + PILLAR_WEIGHTS[p], 0);
  const weights = {} as Record<Pillar, number>;
  for (const p of ALL_PILLARS) weights[p] = available[p] && sum > 0 ? PILLAR_WEIGHTS[p] / sum : 0;

  // Reason: none (all present) | market_unavailable (ONLY Market dropped) |
  // missing_pillar (any non-Market pillar dropped). guardrail_suppression is
  // reserved for the (not-yet-wired) guardrail path.
  let reason: WeightRedistributionReason;
  if (unavailable.length === 0) reason = "none";
  else if (unavailable.length === 1 && unavailable[0] === "market") reason = "market_unavailable";
  else reason = "missing_pillar";

  // Minimum-pillars rule.
  const foundationOk = available[ANCHOR_PILLAR];
  const enoughBreadth = surviving.length >= MIN_SURVIVING_PILLARS;
  const canScore = foundationOk && enoughBreadth;
  const canScoreReason = canScore
    ? `Foundation present + ${surviving.length} pillars survive (≥${MIN_SURVIVING_PILLARS})`
    : !foundationOk
      ? "Foundation (anchor) unavailable → composite unavailable"
      : `only ${surviving.length} pillar(s) survive (<${MIN_SURVIVING_PILLARS}) → composite unavailable`;

  return { weights, reason, surviving, unavailable, canScore, canScoreReason };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CHANGE 2.4 — MARKET WEIGHT HALVED, 20% -> 10%.
//
// On an instrument whose stated purpose is to read health INDEPENDENTLY OF PRICE, Market
// carried a fifth of the weight and produced more movement than any other pillar: it travels
// 32.6 points for a typical company against Foundation's 12.0. Halving it drops the score's
// correlation with the Market pillar from 0.777 to 0.505.
//
// THE FREED WEIGHT GOES TO FOUNDATION AND MOMENTUM ONLY, PRO-RATA. Ownership does not gain.
// Two schemes were tested and BOTH resolve as helping — pro-rata across all three (+1.39pp
// [0.32, 2.27]) and Foundation-plus-Momentum only (+1.39pp [0.31, 2.25]) — and HEAD TO HEAD
// THEY MEASURE IDENTICALLY: +0.00pp, band [-0.19, 0.17]. Measurement cannot choose between
// them, so the choice is made on description: Ownership travels ~6 points for a typical
// company and should not gain weight on that basis. That is a DESCRIPTION DECISION and is
// recorded as one.
//
// ★ IT IS APPLIED AFTER 14.4 REDISTRIBUTION, NOT BY EDITING THE LOCKED CONSTANTS, AND THE
//   DIFFERENCE IS MEASURABLE. The spec: "the halving is applied to each snapshot's own
//   STORED weights and redistributed pro-rata, so 14.4 renormalisation for a missing pillar
//   is preserved." Halving the constants first and letting redistributeWeights renormalise
//   instead gives different answers on every row where a pillar is missing — 14 of the
//   reference panel's 1,139 (POLYCAB, NESTLEIND, LT, MANKIND, INDUSINDBK). Worked example,
//   Momentum absent: 14.4 gives F .4667 / K .2667 / O .2667; halving Market frees .1333 onto
//   Foundation alone, giving F .6000 / K .1333 / O .2667 — which is what the panel carries.
//   Renormalising the v2 constants would have given F .5763 / K .1412 / O .2825.

/** Halve Market and push the freed half onto Foundation and Momentum pro-rata. PURE.
 *  A snapshot with no Market weight (14.4 dropped it) frees nothing and is unchanged. */
export function halveMarketWeight(weights: Record<Pillar, number>): Record<Pillar, number> {
  const out = { ...weights };
  const freed = out.market / 2;
  if (freed <= 0) return out;
  out.market -= freed;
  const base = out.foundation + out.momentum;
  if (base <= 0) return out;   // neither survivor to receive it: Market simply keeps its half
  out.foundation += freed * (out.foundation / base);
  out.momentum += freed * (out.momentum / base);
  return out;
}
