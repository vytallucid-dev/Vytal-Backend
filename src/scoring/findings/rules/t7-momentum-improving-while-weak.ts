// File: src/scoring/findings/rules/t7-momentum-improving-while-weak.ts
//
// T7 · MOMENTUM IMPROVING WHILE STILL WEAK. Vytal_Trajectory_Tool_Spec Part 3, T7.
// Display-only · magnitude null · nothing rescores.
//
//     Momentum_now < 54  AND  Momentum_now > Momentum_prev
//
// The turn is happening while the business still reads as weak — the earliest visible point of a
// trajectory recovery, before it has crossed back into normal territory.
//
// ── ★ THE RISE IS EPSILON-GATED ───────────────────────────────────────────────────────────────────
// `movedUp()` (trajectory/prev-now.ts), not a bare `m.delta <= 0`. 1 of 11 persisted T7 fires
// (BHEL) carried `risePp: 0` from the same live-vs-persisted rounding noise that hit T8/T9 harder —
// Momentum's quarterly TTM recompute churns more than annual Foundation, so exact ties are rarer here
// but not absent. See prev-now.ts's header for the full incident.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// +5.8%, 63% positive at 15 days (n=19); +3.0%, 68% positive at 7 days.
//
// ── ★ THE BEARISH MIRROR IS T6's TERRITORY — DO NOT FOLD IT IN ───────────────────────────────────
// "The bearish mirror — Momentum FALLING into weak — returned −0.3%, 39% positive (n=19)." That is a
// different pattern with a different sign, and it is T6's condition (Momentum crossing DOWN through
// 54). T7 is strictly `now < 54 AND now > prev` — rising while weak. A stock that fell into weak this
// quarter cannot satisfy `now > prev`, so the two are disjoint by construction, not by convention.
//
// ── ★ R3 — THIS IS THE MOST EXPOSED CARD IN THE FAMILY, AND ITS COPY IS CONSTRAINED ──────────────
// Part 4 · R3: before results producing a 15+ point Momentum gain (n=30), price had ALREADY run
// +3.0% sector-excess, 70% positive — and then did NOTHING afterwards (−0.1%, 48% positive).
// PNB (Momentum 26→60): +12% before, −11% after. Canara (30→68): +11% before, +7% after. Shree Cement
// (54→82): +8% before, −3% after.
// "For large positive Momentum moves, the copy must not imply the user is early. They are LATE BY
// CONSTRUCTION."
// T7 is the pattern a reader is most likely to read as "I've spotted the turn first", so:
//   · `readerIsEarly: false` and the front-running figures ride in evidence
//   · `largeMovePriceAlreadyRan` is set when the rise is ≥15pp, so the copy can say so explicitly
//   · the verdict is scanned by FORWARD_LANGUAGE_BANS (R2/R3) in scripts/verify-trajectory.ts
//
// ── ★ R2 — AND IT IS NOT AN EARLY WARNING EITHER ─────────────────────────────────────────────────
// Momentum does not lead the composite (median lead 0 days). No copy here may imply otherwise.
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────

import { pillarPrevNow, movedUp } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

/** Momentum's NATIVE weak mark — the ceiling this pattern sits beneath. */
export const T7_MOMENTUM_WEAK = NATIVE_ZONES.momentum.weak; // 54
/** The R3 threshold: at or above this rise, price has already run and the reader is late. */
export const T7_LARGE_MOVE_PP = 15;

const KEY = "trajectory_D_T7_momentum_improving_while_weak";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT7: FireRule = (ctx) => {
  const m = pillarPrevNow(ctx, "momentum");
  if (!m) return null;
  if (m.now >= T7_MOMENTUM_WEAK) return null; // no longer weak — this is the still-weak pattern
  if (!movedUp(m.delta)) return null;         // not improving (falling into weak is T6's condition) — epsilon-gated, see prev-now.ts

  const largeMove = m.delta >= T7_LARGE_MOVE_PP;

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY), // ★ R1 — cannot see m.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T7",
      name: "Momentum Improving While Still Weak",
      momentumPrior: r1(m.prev),
      momentumNow: r1(m.now),
      risePp: r1(m.delta),
      stillBelow: T7_MOMENTUM_WEAK,
      priorPeriod: m.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      evidencedPct: 5.8,
      evidencedPositivePct: 63,
      evidencedN: 19,
      sevenDayPct: 3.0,
      sevenDayPositivePct: 68,
      // the mirror, named so it cannot be folded in
      mirrorIsT6: true,
      mirrorPct: -0.3,
      mirrorPositivePct: 39,
      mirrorN: 19,
      // ★ R3 — the reader is late by construction
      readerIsEarly: false,
      largeMovePriceAlreadyRan: largeMove,
      largeMoveCutPp: T7_LARGE_MOVE_PP,
      frontRunSectorExcessPct: 3.0,
      frontRunPositivePct: 70,
      frontRunN: 30,
      afterTheMovePct: -0.1,
      afterTheMovePositivePct: 48,
      // ★ R2
      leadsComposite: false,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["momentum"],
  };
};
