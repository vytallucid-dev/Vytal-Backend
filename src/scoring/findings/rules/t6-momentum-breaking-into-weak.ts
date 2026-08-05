// File: src/scoring/findings/rules/t6-momentum-breaking-into-weak.ts
//
// T6 · MOMENTUM BREAKING INTO WEAK. Vytal_Trajectory_Tool_Spec Part 3, T6.
// Display-only · magnitude null · nothing rescores.
//
//     Momentum_prev ≥ 54  AND  Momentum_now < 54
//
// The operating trajectory has broken into weakness. The business may still be structurally sound,
// but the direction has turned.
//
// ── ★ REGIME · TIER 1 — AND IT POINTS THE OPPOSITE WAY TO T3 ─────────────────────────────────────
//     NORMAL  −1.9%, 40% positive (n=15)  ← reads true
//     HOT     +9.6% (n=3)                 ← MASKED
//
// T3 reads in HOT and is blank in NORMAL; T6 reads in NORMAL and is masked in HOT. Two Tier-1
// patterns, opposite phase tables — this pair is the whole reason §1.4 insists the regime mapping is
// a required field PER PATTERN rather than one global switch. Its table is { NORMAL }; HOT and
// STRESSED are absent, and in HOT the card shows the crossing and says plainly that the phase
// carries no directional read.
//
// ── ★ WHY THIS PATTERN MATTERS METHODOLOGICALLY — THE NATIVE-THRESHOLD PROOF ──────────────────────
// On the BORROWED composite threshold (60 instead of Momentum's native 54) this had shown a FALSE
// +3.2%. Correctly located at Momentum's own weak mark, it is NEGATIVE. §1.2: "The composite's bands
// must never be borrowed for a pillar; doing so mislabels the zone and has been shown to flip a
// signal's sign (see T6)."
// So the 54 here is declared on T6's own catalogue record rather than being written here as
// a literal — the one place in this family where using the wrong number is a documented sign-flip.
//
// ── ⚠ R2 — THIS IS NOT AN EARLY WARNING ──────────────────────────────────────────────────────────
// Across 39 matched pairs a Momentum down-cross preceded the composite down-cross with a MEDIAN LEAD
// OF 0 DAYS; Momentum crossed first only 31% of the time, and 49% were the same snapshot. No copy on
// this card may present it as leading the headline score. Enforced by the copy lint in
// trajectory/regime-tier.ts (FORWARD_LANGUAGE_BANS) and gated in scripts/verify-trajectory.ts.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { pillarPrevNow } from "../trajectory/prev-now.js";
import { TIER_DECIDES_READ, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_B_T6_momentum_breaking_into_weak;
const FACTS = ENTRY.facts;

/** ★ Momentum's NATIVE weak mark. On the borrowed composite 60 this pattern read a false +3.2%.
 *  Declared on T6's own record, which is the one place the correct number now lives. */
export const T6_MOMENTUM_WEAK = FACTS.evidencedTier; // 54

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT6: FireRule = (ctx) => {
  const m = pillarPrevNow(ctx, "momentum");
  if (!m) return null;                          // no prior reading, or either end not scored
  if (m.prev < T6_MOMENTUM_WEAK) return null;   // was already weak — not a break
  if (m.now >= T6_MOMENTUM_WEAK) return null;   // still at/above the mark
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). REAL effect — same shape as T3/T4/T5.
  if (!distinctAtPrecision(m.prev, m.now, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key),
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T6",
      name: "Momentum Breaking Into Weak",
      momentumPrior: round(m.prev),
      momentumNow: round(m.now),
      crossedBelow: T6_MOMENTUM_WEAK,
      isCrossing: true,
      priorPeriod: m.priorPeriodKey,
      // ★ Tier 1 — NORMAL only. HOT is masked; the opposite table to T3's.
      ...TIER_DECIDES_READ(["NORMAL"]),
      overallPct: -1.4,
      overallPositivePct: 41,
      overallN: 22,
      normalPct: -1.9,
      normalPositivePct: 40,
      normalN: 15,
      hotPct: 9.6,
      hotN: 3,
      hotIsMasked: true,
      // the native-threshold proof — kept on the card because it is the study's clearest
      // methodological result, not merely trivia
      borrowedThresholdFalseReading: 3.2,
      borrowedThreshold: 60,
      nativeThreshold: T6_MOMENTUM_WEAK,
      // R2 — recorded so no downstream surface re-invents an early-warning framing
      leadsComposite: false,
      medianLeadDays: 0,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["momentum"],
  };
};
