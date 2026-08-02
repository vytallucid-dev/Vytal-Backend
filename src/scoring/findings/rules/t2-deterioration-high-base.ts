// File: src/scoring/findings/rules/t2-deterioration-high-base.ts
//
// T2 · DETERIORATION FROM A HIGH BASE. Vytal_Trajectory_Tool_Spec Part 2, T2.
// Display-only · magnitude null · nothing rescores.
//
//     Composite_prev ≥ 70  AND  (Composite_now − Composite_prev) ≤ −6
//
// A business that was sound is measurably weakening. The mirror of T1, and the more important one for
// risk — this is the score doing the job a health score exists to do.
//
// ── ★ REGIME · TIER 2 — THE PHASE MUST ALWAYS BE DISPLAYED ────────────────────────────────────────
// This is the only Tier-2 pattern, and the reason is specific and serious: in the 2021–26 bank bull
// T2 showed a FALSE +15%. It is masked in one-way rallies and reads true when risk is two-sided —
// the 2017–21 neutral two-sided window had composite-deterioration events coinciding with −35.9%
// mean price, EVERY case negative (min −69%).
// So T2 fires in every phase (regime never gates display) but the card must ALWAYS show which phase
// it fired in. A T2 shown without its phase is a number the reader cannot weigh: the same card means
// "−35.9%, every case negative" in a two-sided market and "+15%, masked" in a one-way rally.
// The spec also supplies a HOT-appended sentence — carried by the verdict layer.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// −6.1% median, 79% of cases FELL in the same window (n=28).
//
// ── ⚠ Δ IS THE TRIGGER, NEVER THE SEVERITY (Part 4 · R1) ─────────────────────────────────────────

import { compositePrevNow } from "../trajectory/prev-now.js";
import { TIER_ALWAYS_DISPLAY, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import type { FireRule } from "../types.js";

export const T2_PREV_MIN = 70;   // the high base
export const T2_MIN_FALL = -6;   // §1.2 material trajectory event

const KEY = "trajectory_B_T2_deterioration_high_base";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT2: FireRule = (ctx) => {
  const c = compositePrevNow(ctx);
  if (!c) return null;
  if (c.prev < T2_PREV_MIN) return null;    // not from a high base
  if (c.delta > T2_MIN_FALL) return null;   // drift, not a trajectory event

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY), // ★ R1 — cannot see c.delta
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T2",
      name: "Deterioration from a High Base",
      compositePrior: r1(c.prev),
      compositeNow: r1(c.now),
      movePp: r1(c.delta),
      prevMin: T2_PREV_MIN,
      minFall: T2_MIN_FALL,
      isMovePattern: true,
      priorPeriod: c.priorPeriodKey,
      // ★ Tier 2 — the phase is not optional decoration on this card
      ...TIER_ALWAYS_DISPLAY,
      mustDisplayPhase: true,
      evidencedMedianPct: -6.1,
      evidencedFellPct: 79,
      evidencedN: 28,
      twoSidedWindowMeanPct: -35.9, // 2017–21 neutral window: every case negative, min −69%
      twoSidedAllNegative: true,
      bullMaskedReading: 15.0,       // the FALSE +15% in the 2021–26 bank bull
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["composite"],
  };
};
