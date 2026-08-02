// File: src/scoring/findings/rules/d5-laggard-catching-up.ts
//
// D5 · LAGGARD CATCHING UP — Momentum converging toward a strong Foundation.
// Vytal_Divergence_Tool_Spec Part 2, D5. Display-only · magnitude null · nothing rescores.
//
//     (Foundation − Momentum) ≥ 8  AND  ΔMomentum ≥ +5          ← spec trigger
//     …but see the BAND CONFLICT below: the gap leg is enforced at ≥ 12.
//
// A fundamentally sound business whose trajectory had fallen behind is now turning up. The weak
// pillar is converging TOWARD the strong one — and the direction of convergence is the whole point.
//
// ── ★ SPEC-INTERNAL CONFLICT, RESOLVED PER THE OWNER'S RULING — REPORTED, NOT SILENT ──────────────
// D5's stated gap leg is (F − M) ≥ 8. §1.1's band table says 8–11 is MINOR — "a gap exists but
// carries no demonstrated meaning. Do not surface." Those two cannot both hold: a D5 firing on a
// 9-point gap surfaces a gap the same document says must never be surfaced.
// The owner's ruling is explicit — "Nothing in the 8–11 band may fire" — so the gap leg is enforced
// at GAP_MATERIAL (12), not 8. This NARROWS D5 relative to the literal trigger; it never widens it.
// ⚠ Consequence worth knowing: the n=5 population that produced D5's +17.7% was selected on ≥8, so
// the fired set here is a SUBSET of the measured one. Flagged in the build report.
//
// ── THE MIRROR IS THE PATTERN ─────────────────────────────────────────────────────────────────────
// "The identical Momentum rise against a WEAK Foundation (the pillars widening apart instead)
// performed markedly worse: −3.8%, 27% positive in normal phases (n=11). Same trigger, opposite
// outcome, decided by which pillar it is moving toward."
// The (F − M) ≥ 12 leg already selects the convergence case by construction — Foundation above
// Momentum means a Momentum rise CLOSES the gap. The mirror (Foundation below) cannot satisfy it. The
// contrast is carried in evidence so the copy can teach it rather than leaving it implicit.
//
// ── CAVEAT — DISPLAY PROMINENTLY (the spec's own instruction) ─────────────────────────────────────
// n=5–6 on the core cells. +17.7% mean, 80% positive same-window (n=5); a regime-split rerun returned
// +13.5% overall and +17.7% in NORMAL — one of very few patterns that works in calm markets rather
// than only in a rally. A disclosure-anchored check found +5.2% sector-excess, 100% positive (n=6).
// "This has now appeared in FOUR separate tests, which is why it survives scrutiny, but it remains a
// directional hypothesis rather than a proven edge."

import { scoredPair, GAP_MATERIAL, gapTier, TIER_WORD } from "../divergence/bands.js";
import type { FireRule } from "../types.js";

/** ⚠ The spec says 8; §1.1 forbids 8–11. Enforced at the material floor — see the header. */
export const D5_GAP_MIN = GAP_MATERIAL; // 12, NOT the spec's literal 8
/** §Part 2 D5 — the Momentum improvement leg, unchanged from the spec. */
export const D5_MOMENTUM_RISE_MIN = 5;

const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleD5: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p = scoredPair(f, m); // inert-0 guard
  if (!p) return null;
  const foundation = p.a, momentum = p.b;

  const gap = foundation - momentum;
  if (gap < D5_GAP_MIN) return null; // ★ 12, not 8 — the 8–11 minor band never surfaces
  const tier = gapTier(gap);
  if (!tier) return null;

  // ΔMomentum needs a prior reading. No prior ⇒ we cannot check, which is NOT the same as false.
  if (ctx.priorSnapshots.length === 0) return null;
  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.momentumScored || prior.momentum === null) return null;

  const dMomentum = momentum - prior.momentum;
  if (dMomentum < D5_MOMENTUM_RISE_MIN) return null;

  return {
    kind: "pattern",
    key: "divergence_D5_laggard_catching_up",
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
      foundation: r1(foundation),
      momentum: r1(momentum),
      momentumPrior: r1(prior.momentum),
      momentumRisePp: r1(dMomentum),
      gapPp: r1(gap),
      tier,
      tierWord: TIER_WORD[tier],
      gapMin: D5_GAP_MIN,
      gapMinSpecLiteral: 8,
      gapMinNarrowedByBandRule: true, // §1.1 8–11 suppression — see the header
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
