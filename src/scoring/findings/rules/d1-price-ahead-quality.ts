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

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair, gapTier, severityForTier, TIER_WORD } from "../divergence/bands.js";
import { priceAheadShape, legAbove, legBelow } from "../divergence/pattern-state.js";
import { MARKET_ELEVATED_FLOOR } from "../../../catalogue/pattern-facts.js";
import { roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/**
 * ★ THE RECORD, NOT A RE-TYPED STRING. `ENTRY.key` carries the literal type
 * "divergence_D1_price_ahead_quality", so the key this rule emits and the key the catalogue carries
 * are the SAME expression — not two hand-written strings that a script diffs afterwards.
 */
const ENTRY = STOCK_FINDINGS.divergence_D1_price_ahead_quality;
const FACTS = ENTRY.facts;

/** ★ THE **FORMED** THRESHOLD FOR THE MARKET LEG — 68, the n=79 configuration, read off `legs`.
 *  ⚠ NOT A FIRING GATE ANY MORE. The rule fires on the SHAPE; this decides formed vs building. */
export const D1_MARKET_FORMED_AT = FACTS.legs.find((l) => l.pillar === "market")!.value; // 68
/** Market's NATIVE strong mark (74) — an INTENSITY WITHIN Formed, carried by severity. Never a gate:
 *  gating here is what reported GLENMARK as no-pattern inside the evidenced configuration. */
export const D1_MARKET_NATIVE_STRONG = FACTS.evidencedTier; // 74
/** ★ THE SECOND LEG NOW HAS A HOME — read from `FACTS.legs`, not a module literal. `legs` states the
 *  trigger's complete threshold set; this pulls the Foundation condition out of it by pillar rather
 *  than by array position, so a future reorder of the legs array cannot silently swap which value
 *  lands here. */
export const D1_FOUNDATION_MAX = FACTS.legs.find((l) => l.pillar === "foundation")!.value; // 58
/** The combined configuration both price-ahead halves inherit from — the record's own n. */
export const D1_D2_SHARED_N = FACTS.evidenceStats.n; // 79

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION. Evidence is written at `FACTS.displayPrecision` —
 *  the same value verdicts.ts's renderer reads back, so a number cannot be rounded twice, twice
 *  differently. See format.ts's header for the SAIL/BHEL/SUNPHARMA defect this closes. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD1: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const mkt = ctx.current.pillars.market;
  const p = scoredPair(mkt, f); // inert-0 guard
  if (!p) return null;
  const market = p.a, foundation = p.b;

  // ★ THE SHAPE TEST — fires on direction + material gap + a genuinely elevated high side. The two
  //   thresholds no longer decide WHETHER, only HOW FAR ALONG. See divergence/pattern-state.ts.
  const shape = priceAheadShape({
    high: market,
    low: foundation,
    gapFloor: FACTS.gapFloor,
    highElevatedAbove: MARKET_ELEVATED_FLOOR,
    highFormedAt: D1_MARKET_FORMED_AT,
    lowFormedBelow: D1_FOUNDATION_MAX,
  });
  if (shape.state === "absent") return null;

  const gap = shape.gap;
  // ⚠ THE TIER MAY NOW BE NULL AND THAT IS NOT A REJECTION. A Building instance can sit in the 8–11
  //   band the §1.2 scale has no word for... except it cannot: the shape test already enforced
  //   gap ≥ 12, so a tier always exists here. Asserted rather than assumed, exactly as before.
  const tier = gapTier(gap);
  if (!tier) return null; // §1.1 — unreachable by construction, asserted not assumed

  // Each leg's distance from its OWN threshold — a fact stated, never a boundary tested. This is what
  // Building copy names, and what makes the mixed case (one leg across, one not) legible.
  const marketLeg = legAbove("market", round(market), D1_MARKET_FORMED_AT);
  const foundationLeg = legBelow("foundation", round(foundation), D1_FOUNDATION_MAX);

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: severityForTier(tier),
    direction: "negative",
    polarity: "negative",
    temporalClass: "CONDITION",
    magnitude: null, // display-only — no §5E score impact
    displayState: "active",
    evidence: {
      card: "D1",
      name: "Price Ahead of Quality",
      market: round(market),
      foundation: round(foundation),
      gapPp: round(gap),
      tier,
      tierWord: TIER_WORD[tier],
      // ★ THE STATE — formed | building. Absent never reaches here (the rule returned null).
      state: shape.state,
      // ★ EACH LEG’S DISTANCE FROM ITS OWN THRESHOLD. Stated, not tested — this is what Building
      //   copy names, and what makes the mixed case legible without a sentence characterising it.
      legs: [marketLeg, foundationLeg],
      marketFormedAt: D1_MARKET_FORMED_AT,
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
  };
};
