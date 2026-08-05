// File: src/scoring/findings/rules/t1-recovery-low-zone.ts
//
// T1 · RECOVERY FROM THE LOW ZONE. Vytal_Trajectory_Tool_Spec Part 2, T1.
// Display-only · magnitude null · nothing rescores.
//
//     Composite_prev ≤ 58  AND  (Composite_now − Composite_prev) ≥ +6
//
// A struggling business is genuinely turning. The single strongest trajectory reading in the study,
// and the low zone is exactly where the score carries most information (§1.5: composite movement
// matched price direction 79% of the time from a ≤58 start, 71% from the middle, 61% from the high).
//
// ── ★ A MOVE PATTERN, NOT A CROSSING ──────────────────────────────────────────────────────────────
// T1 gates on a prev LEVEL plus a Δ MAGNITUDE — the shape F2 / C-over-time / P13 / N5 already use.
// It is not a boundary cross: a stock can recover 52→60 without touching a band edge and T1 still
// fires, which is the point (§1.2: "Composite move of ≥ 6 points — a material trajectory event").
//
// ── ⚠ Δ IS THE TRIGGER, NEVER THE SEVERITY (Part 4 · R1) ──────────────────────────────────────────
// The +6 threshold decides WHETHER this fires. It must never decide how loud it is: a 20-point
// recovery is not a bigger signal than a 7-point one — measured, the reverse holds. Severity comes
// from trajectorySeverity(key), which cannot see the delta.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// +12.8% median, 81% of cases rose in the SAME window (n=26). Forward 60-day edge weak (~55%) — the
// price has already begun reacting. Verified as fundamentally driven, not a Market artifact: on moves
// of this size the non-price pillars contributed the majority of the points (§1.1: 5.7 of 10.6 on
// average, driving >half the move in 56% of cases).
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────
// Reads across phases; strongest in the study's low zone. In HOT, treat the magnitude as flattered.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { compositePrevNow } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_D_T1_recovery_low_zone;
const FACTS = ENTRY.facts;

export const T1_PREV_MAX = FACTS.evidencedTier;   // 58 — the low zone (§1.5)
export const T1_MIN_RISE = FACTS.movementFloor;  // 6  — §1.2 material trajectory event

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT1: FireRule = (ctx) => {
  const c = compositePrevNow(ctx);
  if (!c) return null;                       // no prior reading — cannot evaluate a move
  if (c.prev > T1_PREV_MAX) return null;      // not starting from the low zone
  if (c.delta < T1_MIN_RISE) return null;     // drift, not a trajectory event
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). Defensive here: the +6 move
  // threshold sits far above the rounding granularity, so this can't reject a real T1 fire today —
  // asserted rather than assumed, in case the floor is ever recalibrated.
  if (!distinctAtPrecision(c.prev, c.now, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key), // ★ R1 — cannot see c.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T1",
      name: "Recovery from the Low Zone",
      compositePrior: round(c.prev),
      compositeNow: round(c.now),
      movePp: round(c.delta),
      prevMax: T1_PREV_MAX,
      minRise: T1_MIN_RISE,
      isMovePattern: true,
      priorPeriod: c.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      evidencedMedianPct: 12.8,
      evidencedRosePct: 81,
      evidencedN: 26,
      forwardEdgeWeak: true, // ~55% at 60 days — the price has already begun reacting
      fundamentallyDriven: "On moves of this size the non-price pillars contributed 5.7 of 10.6 points on average, driving more than half the move in 56% of cases.",
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["composite"],
  };
};
