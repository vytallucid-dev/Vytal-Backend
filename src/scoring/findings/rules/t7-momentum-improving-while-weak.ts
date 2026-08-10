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
// ── ★ THE RISE IS EPSILON-GATED, THEN MOVEMENT-FLOOR-GATED ───────────────────────────────────────
// TWO gates, in order, doing DIFFERENT jobs:
//   1. `movedUp()` (trajectory/prev-now.ts) — is this a real move AT ALL, and which way? Epsilon-
//      gated against TRAJECTORY_DELTA_EPSILON (0.0001), which exists to reject persistence
//      round-trip noise. 1 of 11 persisted T7 fires (BHEL) carried `risePp: 0` from exactly that
//      noise before this gate existed. Epsilon keeps this role — it still decides direction.
//   2. `m.delta < T7_MOVEMENT_FLOOR` — is the real move BIG ENOUGH to be the pattern the study
//      measured? ★ THE MOVEMENT-FLOOR RULING: this is now a FIRING gate (FACTS.gateType ===
//      "firing"), not merely declared. Epsilon no longer decides whether T7 fires — it only
//      protects step 1's direction call. See prev-now.ts's header for the epsilon incident.
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

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { pillarPrevNow, movedUp } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_D_T7_momentum_improving_while_weak;
const FACTS = ENTRY.facts;

/** Momentum's NATIVE weak mark — the ceiling this pattern sits beneath. From T7's own record. */
export const T7_MOMENTUM_WEAK = FACTS.evidencedTier; // 54
/** ★ THE MOVEMENT FLOOR — NOW A FIRING GATE (the movement-floor ruling). Below 1.0pp the move is real
 *  (it already cleared the epsilon noise floor) but too small to be the pattern the study measured;
 *  T7 requires an actual rise of at least 1.0pp. See the header for how this composes with epsilon. */
export const T7_MOVEMENT_FLOOR = FACTS.movementFloor; // 1.0 — enforced
/** The R3 threshold: at or above this rise, price has already run and the reader is late. A COPY
 *  constraint (Part 4 · R3), not a firing threshold — see PatternFacts.largeMoveCutPp's note for why
 *  it is a field of its own rather than a second use of `evidencedTier`. Relocation only: the value
 *  (15) is unchanged from when this was a bare local literal. */
export const T7_LARGE_MOVE_PP = FACTS.largeMoveCutPp;

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT7: FireRule = (ctx) => {
  const m = pillarPrevNow(ctx, "momentum");
  if (!m) return null;
  if (m.now >= T7_MOMENTUM_WEAK) return null; // no longer weak — this is the still-weak pattern
  if (!movedUp(m.delta)) return null;         // not improving (falling into weak is T6's condition) — epsilon-gated, see prev-now.ts
  if (m.delta < T7_MOVEMENT_FLOOR) return null; // ★ real but too small — the movement-floor ruling
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). Defensive here: the enforced 1.0pp
  // movement floor already sits above the rounding granularity — asserted, not assumed. This is the
  // named incident (BHEL) the whole precision pass exists to close: the OLD code rounded prior/now to
  // 1dp only when writing evidence, so a real rise this small could render "37 to 37"; the epsilon and
  // movement-floor gates above decide whether the raw move is real and big enough, this decides
  // whether the RENDERED numbers can tell the two readings apart.
  if (!distinctAtPrecision(m.prev, m.now, FACTS.displayPrecision)) return null;

  const largeMove = m.delta >= T7_LARGE_MOVE_PP;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key), // ★ R1 — cannot see m.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T7",
      name: "Momentum Improving While Still Weak",
      momentumPrior: round(m.prev),
      momentumNow: round(m.now),
      risePp: round(m.delta),
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
  };
};
