// File: src/scoring/findings/rules/d5-laggard-catching-up.ts
//
// D5 · LAGGARD CATCHING UP — Momentum converging toward a strong Foundation.
// Vytal_Divergence_Tool_Spec Part 2, D5. Display-only · magnitude null · nothing rescores.
//
//     (Foundation − Momentum) ≥ 8  AND  ΔMomentum ≥ +5          ← spec trigger, enforced AS STATED
//
// A fundamentally sound business whose trajectory had fallen behind is now turning up. The weak
// pillar is converging TOWARD the strong one — and the direction of convergence is the whole point.
//
// ── ★ RULING 1 — MEASURED BEATS TRANSFERRED ───────────────────────────────────────────────────────
// D5's gap leg is (F − M) ≥ 8, and the n=5 population that produced +17.7% was SELECTED at that floor
// — 8 is not a guess, it is where the evidence starts. §1.1's "8–11 is MINOR, do not surface" is the
// UNIVERSAL default for patterns with no measurement of their own at that distance; D5 has one, so the
// universal default does not apply to it. A previous build composed `Math.max(8, 12)` to "resolve" the
// apparent conflict — which silently let the TRANSFERRED number (12, inherited by every OTHER pattern
// from Foundation↔Momentum's stickiness test) override D5's own MEASURED number. That inverted the
// rule it was trying to honour. D5 fires at 8, enforced directly, no composition.
//
// ── ★ THE UNIVERSAL §1.2 TIER DOES NOT GATE D5 EITHER ─────────────────────────────────────────────
// `gapTier()` (divergence/bands.ts) labels 12+ as material/stretched/extreme and returns null below
// that — correct for every OTHER gap-basis pattern, and WRONG here if treated as a second, hidden
// floor: D5's own evidence starts at 8, inside the band the universal tier calls "minor". A null tier
// on a firing D5 (gap 8–11) is a real, honest outcome — the universal severity-gradient has no word
// for this gap — not a rejection. `tier`/`tierWord` are carried through as nullable; never gated on.
//
// ── THE MIRROR IS THE PATTERN ─────────────────────────────────────────────────────────────────────
// "The identical Momentum rise against a WEAK Foundation (the pillars widening apart instead)
// performed markedly worse: −3.8%, 27% positive in normal phases (n=11). Same trigger, opposite
// outcome, decided by which pillar it is moving toward."
// The (F − M) ≥ 8 leg already selects the convergence case by construction — Foundation above
// Momentum means a Momentum rise CLOSES the gap. The mirror (Foundation below) cannot satisfy it. The
// contrast is carried in evidence so the copy can teach it rather than leaving it implicit.
//
// ── CAVEAT — DISPLAY PROMINENTLY (the spec's own instruction) ─────────────────────────────────────
// n=5–6 on the core cells. +17.7% mean, 80% positive same-window (n=5); a regime-split rerun returned
// +13.5% overall and +17.7% in NORMAL — one of very few patterns that works in calm markets rather
// than only in a rally. A disclosure-anchored check found +5.2% sector-excess, 100% positive (n=6).
// "This has now appeared in FOUR separate tests, which is why it survives scrutiny, but it remains a
// directional hypothesis rather than a proven edge."

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair, gapTier, TIER_WORD } from "../divergence/bands.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_D5_laggard_catching_up;
const FACTS = ENTRY.facts;

/** §Part 2 D5 — D5's OWN enforced floor (Ruling 1). No composition against the universal
 *  MATERIAL_GAP_FLOOR: this pattern's own evidence is the authority on where it starts. */
export const D5_GAP_MIN = FACTS.gapFloor; // 8
/** §Part 2 D5 — the Momentum improvement leg, read from the record's movement floor. */
export const D5_MOMENTUM_RISE_MIN = FACTS.movementFloor; // 5

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD5: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p = scoredPair(f, m); // inert-0 guard
  if (!p) return null;
  const foundation = p.a, momentum = p.b;

  const gap = foundation - momentum;
  if (gap < D5_GAP_MIN) return null; // ★ 8 — D5's own evidenced floor (Ruling 1)
  // ★ NOT A GATE. The universal §1.2 tier has no word for gap ∈ [8, 12) — that is expected here, not
  // a rejection. See the header: this is the second place the old code silently re-imposed 12.
  const tier = gapTier(gap);

  // ΔMomentum needs a prior reading. No prior ⇒ we cannot check, which is NOT the same as false.
  if (ctx.priorSnapshots.length === 0) return null;
  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.momentumScored || prior.momentum === null) return null;

  const dMomentum = momentum - prior.momentum;
  if (dMomentum < D5_MOMENTUM_RISE_MIN) return null;
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). Already guaranteed here by the +5
  // movement floor, far above the rounding granularity — asserted rather than assumed, in case the
  // floor is ever recalibrated.
  if (!distinctAtPrecision(prior.momentum, momentum, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    // Constructive convergence → `recovery` maps to the rec accent.
    severity: "recovery",
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D5",
      name: "Laggard Catching Up",
      foundation: round(foundation),
      momentum: round(momentum),
      momentumPrior: round(prior.momentum),
      momentumRisePp: round(dMomentum),
      gapPp: round(gap),
      // GapTier | null — null when the gap sits in [8, 12), below the universal tier's floor but at
      // or above D5's own. The badge simply doesn't render for those, same as it already does for
      // D3/D4/D6/D7's movement/crossing patterns with no standing-gap tier to report.
      tier,
      tierWord: tier ? TIER_WORD[tier] : null,
      gapMin: D5_GAP_MIN,
      riseMin: D5_MOMENTUM_RISE_MIN,
      convergingToward: "foundation",
      // the mirror — same trigger, opposite outcome
      mirrorSectorExcessPct: -3.8,
      mirrorPositivePct: 27,
      mirrorN: 11,
      evidencedMeanPct: 17.7,
      evidencedPositivePct: 80,
      evidencedN: 5,
      normalPhasePct: 17.7,
      disclosureAnchoredPct: 5.2,
      disclosureAnchoredPositivePct: 100,
      disclosureAnchoredN: 6,
      caveat: "n=5–6 on the core cells. Seen in four separate tests, which is why it survives scrutiny — but a directional hypothesis, not a proven edge.",
    },
    metricRefs: ["foundation", "momentum"],
  };
};
