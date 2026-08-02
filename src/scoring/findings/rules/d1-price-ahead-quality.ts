// File: src/scoring/findings/rules/d1-price-ahead-quality.ts
//
// D1 · PRICE AHEAD OF QUALITY — Market vs Foundation, the RE-RATING story.
// Vytal_Divergence_Tool_Spec Part 2, D1. Display-only · magnitude null · nothing rescores.
//
//     Market ≥ 74  AND  Foundation < 58
//
// Foundation is a slow-moving read on how fundamentally sound a company is, so when price runs away
// from it the market is changing what it is WILLING TO PAY for a given level of quality. Structural,
// slower-moving, and the more durable of the two price-ahead patterns.
//
// ── ★ THE INHERITANCE NOTE IS NOT OPTIONAL, IT IS THE EVIDENCE ────────────────────────────────────
// The spec's own honest note: "the split into quality-versus-trajectory is not separately measured.
// Both halves inherit the direction from the combined test." D1 and D2 SHARE one n=79 configuration
// that measured Market against the COMBINED fundamental average — neither half has its own number.
// So `evidenceInherited: true` and the shared n travel in evidence, and the verdict says "inherited"
// out loud. Claiming an independently measured −2.9% for D1 alone would be inventing a measurement.
//
//   combined (n=79)   −2.9% sector-excess, 42% positive
//   by regime         HOT +9.6% (masked, still paying) · NORMAL +0.2%, 40% positive
//   caught at a turn  −10.3% over the following 180 days, 22% positive (June-2024 melt-up peak)
//
// ── REGIME CHANGES THE WORDING, NEVER THE DISPLAY (§1.3) ──────────────────────────────────────────
// "Regime never gates whether a pattern is shown. It changes the wording only. Same pattern, same
// severity, different sentence beneath it." D1 carries a HOT-regime APPENDED sentence; it fires
// identically in every phase. The regime is read from the fire-time stamp by the verdict layer — this
// rule stamps nothing about regime itself (the stamp is applied centrally under
// REGIME_EVIDENCE_KEY), it only marks that D1 HAS regime-conditional copy.
//
// ── THE GAP CANNOT LAND IN THE MINOR BAND ─────────────────────────────────────────────────────────
// Market ≥ 74 and Foundation < 58 forces a gap > 16 — already STRETCHED (§1.1). The band guard is
// asserted anyway rather than assumed, so a future threshold edit cannot silently open the 8–11 band.

import { scoredPair, gapTier, severityForTier, TIER_WORD } from "../divergence/bands.js";
import type { FireRule } from "../types.js";

/** §Part 2 D1 — the two absolute levels. Market at-or-above, Foundation strictly below. */
export const D1_MARKET_MIN = 74;
export const D1_FOUNDATION_MAX = 58;
/** The combined configuration both price-ahead halves inherit from. */
export const D1_D2_SHARED_N = 79;

const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleD1: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const mkt = ctx.current.pillars.market;
  const p = scoredPair(mkt, f); // inert-0 guard
  if (!p) return null;
  const market = p.a, foundation = p.b;

  if (market < D1_MARKET_MIN) return null;
  if (foundation >= D1_FOUNDATION_MAX) return null;

  const gap = market - foundation;
  const tier = gapTier(gap);
  if (!tier) return null; // §1.1 — unreachable by construction, asserted not assumed

  return {
    kind: "pattern",
    key: "divergence_D1_price_ahead_quality",
    severity: severityForTier(tier),
    direction: "negative",
    polarity: "negative",
    temporalClass: "CONDITION",
    magnitude: null, // display-only — no §5E score impact
    displayState: "active",
    evidence: {
      card: "D1",
      name: "Price Ahead of Quality",
      market: r1(market),
      foundation: r1(foundation),
      gapPp: r1(gap),
      tier,
      tierWord: TIER_WORD[tier],
      marketMin: D1_MARKET_MIN,
      foundationMax: D1_FOUNDATION_MAX,
      // ★ the honest note, carried as data so no surface can drop it
      evidenceInherited: true,
      inheritedFrom: "combined price-ahead-of-fundamentals configuration (Market vs the combined fundamental average)",
      sharedN: D1_D2_SHARED_N,
      combinedSectorExcessPct: -2.9,
      combinedPositivePct: 42,
      atTurnSectorExcessPct: -10.3,
      atTurnPositivePct: 22,
      regimeConditionalCopy: true, // §1.3 — HOT appends a sentence; display is never gated
    },
    metricRefs: ["market", "foundation"],
  };
};
