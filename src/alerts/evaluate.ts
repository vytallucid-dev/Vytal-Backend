// ═══════════════════════════════════════════════════════════════════════
// ALERT EVALUATION — the PURE crossing/re-arm core (no DB, no I/O).
//
// Two responsibilities, both pure and unit-testable:
//   1. condition helpers  — given a current reading, is the alert's condition TRUE?
//   2. transition()       — the anti-spam state machine over (active, armed, cond).
//
// FIRING IS ON CROSSING, NOT STATE. A persistently-true condition must NOT fire every
// day. The `armed` flag is the mechanism: fire only when armed && condition-true, then
// DISARM; re-arm only when the condition goes FALSE again. one_shot additionally goes
// inactive on its single fire. This file owns that rule for ALL three alert types — once
// the DB layer reduces a reading to a boolean `conditionTrue`, the state machine is
// type-agnostic (which is exactly why price / band / finding share it).
// ═══════════════════════════════════════════════════════════════════════
import type { AlertOperator, AlertRepeatMode, LabelBand } from "../generated/prisma/client.js";

// ── band ordering (the LIVE LabelBand enum: fragile < below_par < steady < healthy <
//    pristine). "below steady" ⇒ current rank < rank(steady). Fixed by the enum itself. ──
export const BAND_RANK: Record<LabelBand, number> = {
  fragile: 0,
  below_par: 1,
  steady: 2,
  healthy: 3,
  pristine: 4,
};

/** price: latest EOD close vs the threshold. above ⇒ close > T; below ⇒ close < T. */
export function priceConditionTrue(
  operator: AlertOperator,
  close: number,
  threshold: number,
): boolean {
  return operator === "above" ? close > threshold : close < threshold;
}

/** health_band: current band RANK vs the threshold band's rank (strict — a band equal to
 *  the threshold does not fire; "below steady" excludes steady itself). */
export function bandConditionTrue(
  operator: AlertOperator,
  current: LabelBand,
  threshold: LabelBand,
): boolean {
  const c = BAND_RANK[current];
  const t = BAND_RANK[threshold];
  return operator === "above" ? c > t : c < t;
}

/** finding: did a matching finding NEWLY appear on the latest snapshot (∈ latest, ∉ prior)?
 *  findingKey null ⇒ ANY new finding; else that specific key must be among the new ones. */
export function findingConditionTrue(
  findingKey: string | null,
  newFindingKeys: ReadonlySet<string>,
): boolean {
  return findingKey == null ? newFindingKeys.size > 0 : newFindingKeys.has(findingKey);
}

// ── the crossing/re-arm state machine ────────────────────────────────────────────────
export interface AlertLifecycle {
  repeatMode: AlertRepeatMode;
  active: boolean;
  armed: boolean;
}

export interface Transition {
  /** true ⇒ write an alert_event this pass. */
  fire: boolean;
  nextActive: boolean;
  nextArmed: boolean;
  /** Whether (active, armed) changed — i.e. a DB write is needed even when !fire. */
  changed: boolean;
}

/**
 * Decide the alert's next state given whether its condition is TRUE this pass.
 * The four cases:
 *   armed && cond      → FIRE + disarm (one_shot also deactivates).
 *   !armed && !cond    → RE-ARM (the condition receded; ready to fire again).
 *   armed && !cond     → HOLD armed, waiting for the crossing.
 *   !armed && cond     → HOLD disarmed — the condition is still true, so stay quiet
 *                        (THIS is the anti-spam guarantee: no re-fire while it persists).
 * An inactive alert is inert (the caller only evaluates active alerts; kept total anyway).
 */
export function transition(state: AlertLifecycle, conditionTrue: boolean): Transition {
  if (!state.active) {
    return { fire: false, nextActive: false, nextArmed: state.armed, changed: false };
  }

  if (state.armed && conditionTrue) {
    const nextActive = state.repeatMode === "one_shot" ? false : true;
    return { fire: true, nextActive, nextArmed: false, changed: true };
  }

  if (!state.armed && !conditionTrue) {
    // Re-arm — the condition went false again; the next crossing may fire.
    return { fire: false, nextActive: true, nextArmed: true, changed: true };
  }

  // No transition: (armed && !cond) still waiting, or (!armed && cond) still-true-quiet.
  return { fire: false, nextActive: state.active, nextArmed: state.armed, changed: false };
}
