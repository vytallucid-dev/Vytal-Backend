// File: src/scoring/findings/rules/t9-foundation-weak-declining.ts
//
// T9 · FOUNDATION WEAK AND STILL DECLINING. Vytal_Trajectory_Tool_Spec Part 3, T9.
// Display-only · magnitude null · nothing rescores.
//
//     Foundation_now < 60  AND  Foundation_now < Foundation_prev
//
// Entrenched, worsening weakness. Not a dramatic break — a business that was already weak continuing
// to erode.
//
// ── ★ THE DECLINE IS EPSILON-GATED — THIS IS THE PATTERN THAT SURFACED THE BUG ────────────────────
// `movedDown()` (trajectory/prev-now.ts), not a bare `f.delta >= 0`. A live rescore found 12 of 13 T9
// fires carrying `fallPp: 0` — Foundation hadn't moved; an unrounded live float compared against a
// rounded, reloaded prior produced noise below 0.0001pp that a tolerance-free `< 0` treated as a real
// decline. See prev-now.ts's header for the full incident and why the fix belongs there, once, for
// every T-pattern that asks "did this move at all."
//
// ── ★ THE DISPLAY NOTE IS BINDING: SHOW THE PERCENTAGE, NOT THE AVERAGE ──────────────────────────
// This is the one pattern in the family where the mean and the hit-rate DISAGREE, and the spec
// resolves it explicitly:
//
//     +0.6% mean at 15 days   but only 36% POSITIVE (n=22)
//     "the worst odds of any trajectory story tested"
//     "The mean is dragged up by a few outliers while roughly two-thirds of cases fell."
//     "This is the case where mean and hit-rate disagree, and the HIT-RATE IS THE HONEST NUMBER.
//      Show the percentage, not the average."
//
// A card leading with "+0.6%" would tell a reader this pattern is mildly positive. It is the worst
// pattern in the study. So:
//   · `headlineFigure: "hitRate"` — the field the copy must lead with, stamped as data
//   · `meanIsMisleading: true` with the reason, so no surface can pick the mean by accident
//   · the verdict quotes 36% positive and does NOT quote +0.6%
// Same-day reading: −0.7%, 50% positive.
//
// ── ★ NOT A CROSSING — AND THE CROSSING IS EXCLUDED ──────────────────────────────────────────────
// T9 is `now < 60 AND now < prev` — already weak, still falling. It does NOT require crossing DOWN
// through 60 this period. That crossing is on Part 5's excluded list: "Foundation crossing down
// through 60 — +8.2%; Foundation moves on annual data, the cross arrives late." Implementing T9 as a
// cross would build the excluded condition.
//
// ── NATIVE PILLAR ZONE ────────────────────────────────────────────────────────────────────────────
// 60 is Foundation's OWN weak mark, never a composite band.
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────

import { pillarPrevNow, movedDown } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

/** Foundation's NATIVE weak mark — never the composite's. */
export const T9_FOUNDATION_WEAK = NATIVE_ZONES.foundation.weak; // 60

const KEY = "trajectory_B_T9_foundation_weak_declining";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT9: FireRule = (ctx) => {
  const f = pillarPrevNow(ctx, "foundation");
  if (!f) return null;
  if (f.now >= T9_FOUNDATION_WEAK) return null; // not weak
  if (!movedDown(f.delta)) return null;         // not still declining — epsilon-gated, see prev-now.ts

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY), // ★ R1 — cannot see f.delta
    direction: "negative",
    polarity: "negative",
    temporalClass: "CONDITION", // a standing state (weak AND falling), not a dated crossing
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T9",
      name: "Foundation Weak and Still Declining",
      foundationPrior: r1(f.prev),
      foundationNow: r1(f.now),
      fallPp: r1(f.delta),
      weakMark: T9_FOUNDATION_WEAK,
      isCrossing: false,
      crossDownThrough60IsExcluded: true,
      priorPeriod: f.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      // ★ THE HIT-RATE IS THE HONEST NUMBER — stamped so the copy cannot pick the mean
      headlineFigure: "hitRate",
      evidencedPositivePct: 36,
      evidencedN: 22,
      worstOddsInStudy: true,
      meanIsMisleading: true,
      meanPct: 0.6,
      meanCaveat: "The +0.6% mean is dragged up by a few outliers while roughly two-thirds of cases fell. The hit-rate is the honest number.",
      sameDayPct: -0.7,
      sameDayPositivePct: 50,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["foundation"],
  };
};
