// File: src/scoring/findings/rules/d2-price-ahead-trajectory.ts
//
// D2 · PRICE AHEAD OF TRAJECTORY — Market vs Momentum, the EXPECTATIONS story.
// Vytal_Divergence_Tool_Spec Part 2, D2. Display-only · magnitude null · nothing rescores.
//
//     Market ≥ 74  AND  Momentum < 58
//
// Momentum reads how the business is trending RIGHT NOW, so a gap here is about earnings
// EXPECTATIONS rather than quality — the market expects an improvement the numbers have not shown
// yet. Faster-moving and noisier than D1, and more likely to resolve quickly in either direction,
// because a single set of results can close it.
//
// ── ★ SAME n=79, SAME INHERITANCE — SEE d1-price-ahead-quality.ts ─────────────────────────────────
// D1 and D2 are the two halves of ONE measured configuration. "Same source as D1 (n=79 combined
// configuration): −2.9% sector-excess, 42% positive; −10.3%, 22% positive when caught at a turn.
// Inherits direction; not separately measured." Neither half may claim its own number, so
// `evidenceInherited: true` is stamped here exactly as it is on D1.
//
// ── D1 AND D2 CO-FIRE, AND THAT IS THE CONSOLIDATION CASE ─────────────────────────────────────────
// A stock with Market ≥ 74, Foundation < 58 AND Momentum < 58 fires BOTH — BHEL is the spec's own
// example (Market 78, Foundation 53, Momentum 48). Two near-identical cards saying "price has run
// ahead" is the exact failure §5C's consolidation exists to prevent, which is why
// catalogue/divergence.ts's sub-type set is repointed at D1+D2.

import { scoredPair, gapTier, severityForTier, TIER_WORD } from "../divergence/bands.js";
import { D1_D2_SHARED_N } from "./d1-price-ahead-quality.js";
import type { FireRule } from "../types.js";

/** §Part 2 D2 — the two absolute levels. */
export const D2_MARKET_MIN = 74;
export const D2_MOMENTUM_MAX = 58;

const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleD2: FireRule = (ctx) => {
  const m = ctx.current.pillars.momentum;
  const mkt = ctx.current.pillars.market;
  const p = scoredPair(mkt, m); // inert-0 guard
  if (!p) return null;
  const market = p.a, momentum = p.b;

  if (market < D2_MARKET_MIN) return null;
  if (momentum >= D2_MOMENTUM_MAX) return null;

  const gap = market - momentum;
  const tier = gapTier(gap);
  if (!tier) return null; // §1.1 — unreachable by construction, asserted not assumed

  return {
    kind: "pattern",
    key: "divergence_D2_price_ahead_trajectory",
    severity: severityForTier(tier),
    direction: "negative",
    polarity: "negative",
    temporalClass: "CONDITION",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D2",
      name: "Price Ahead of Trajectory",
      market: r1(market),
      momentum: r1(momentum),
      gapPp: r1(gap),
      tier,
      tierWord: TIER_WORD[tier],
      marketMin: D2_MARKET_MIN,
      momentumMax: D2_MOMENTUM_MAX,
      evidenceInherited: true,
      inheritedFrom: "combined price-ahead-of-fundamentals configuration (Market vs the combined fundamental average)",
      sharedN: D1_D2_SHARED_N,
      combinedSectorExcessPct: -2.9,
      combinedPositivePct: 42,
      atTurnSectorExcessPct: -10.3,
      atTurnPositivePct: 22,
    },
    metricRefs: ["market", "momentum"],
  };
};
