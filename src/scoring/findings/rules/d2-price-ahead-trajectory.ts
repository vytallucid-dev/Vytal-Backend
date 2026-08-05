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

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair, gapTier, severityForTier, TIER_WORD } from "../divergence/bands.js";
import { priceAheadShape, legAbove, legBelow } from "../divergence/pattern-state.js";
import { MARKET_ELEVATED_FLOOR } from "../../../catalogue/pattern-facts.js";
import { roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_D2_price_ahead_trajectory;
const FACTS = ENTRY.facts;

/** ★ THE **FORMED** THRESHOLD FOR THE MARKET LEG — 68. See D1's note; same configuration. */
export const D2_MARKET_FORMED_AT = FACTS.legs.find((l) => l.pillar === "market")!.value; // 68
/** Market's native strong mark — an intensity within Formed, carried by severity. Never a gate. */
export const D2_MARKET_NATIVE_STRONG = FACTS.evidencedTier; // 74
/** ★ Second leg, now homed in `FACTS.legs` — see the same note on D1. */
export const D2_MOMENTUM_MAX = FACTS.legs.find((l) => l.pillar === "momentum")!.value; // 58
/** The shared n=79 configuration. ★ Read from D2's OWN record, not imported from D1's rule.
 *  Duplication in DATA is correct — each record states its own value, so a future split of the two
 *  halves is an edit to one record rather than a silent change to both. Duplication in LOGIC is not. */
const D1_D2_SHARED_N = FACTS.evidenceStats.n; // 79

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD2: FireRule = (ctx) => {
  const m = ctx.current.pillars.momentum;
  const mkt = ctx.current.pillars.market;
  const p = scoredPair(mkt, m); // inert-0 guard
  if (!p) return null;
  const market = p.a, momentum = p.b;

  // ★ THE SHAPE TEST — see d1-price-ahead-quality.ts for the full note.
  const shape = priceAheadShape({
    high: market,
    low: momentum,
    gapFloor: FACTS.gapFloor,
    highElevatedAbove: MARKET_ELEVATED_FLOOR,
    highFormedAt: D2_MARKET_FORMED_AT,
    lowFormedBelow: D2_MOMENTUM_MAX,
  });
  if (shape.state === "absent") return null;

  const gap = shape.gap;
  const tier = gapTier(gap);
  if (!tier) return null; // §1.1 — unreachable by construction, asserted not assumed

  const marketLeg = legAbove("market", round(market), D2_MARKET_FORMED_AT);
  const momentumLeg = legBelow("momentum", round(momentum), D2_MOMENTUM_MAX);

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: severityForTier(tier),
    direction: "negative",
    polarity: "negative",
    temporalClass: "CONDITION",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D2",
      name: "Price Ahead of Trajectory",
      market: round(market),
      momentum: round(momentum),
      gapPp: round(gap),
      tier,
      tierWord: TIER_WORD[tier],
      // ★ THE STATE — formed | building. Absent never reaches here (the rule returned null).
      state: shape.state,
      // ★ EACH LEG’S DISTANCE FROM ITS OWN THRESHOLD. Stated, not tested — this is what Building
      //   copy names, and what makes the mixed case legible without a sentence characterising it.
      legs: [marketLeg, momentumLeg],
      marketFormedAt: D2_MARKET_FORMED_AT,
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
