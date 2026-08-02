// File: src/scoring/findings/trajectory/prev-now.ts
//
// ONE PILLAR (or the composite) ACROSS TWO ADJACENT READINGS. PURE.
// The shape every T-pattern needs: prev vs now, both genuinely scored.
//
// ── ★ ADJACENT PAIR, NOT A "RECENT SUSTAINED CROSS" ───────────────────────────────────────────────
// The retired B/D/I used trajectory/cross.ts's detectRecentSustainedCross — a run-length machine
// requiring the new zone to hold 2–4 snapshots. The Trajectory spec's T-triggers ask for no such
// thing. T3 is literally "Composite_prev ≥ 74 AND Composite_now < 74"; T8 is "Foundation_now ≥ 72
// AND Foundation_now > Foundation_prev". Adding a sustain the spec does not ask for would silently
// narrow every pattern and change what was measured — so these read the immediately-prior reading
// and nothing more.
//
// ── ★ THE INERT-0 GUARD ───────────────────────────────────────────────────────────────────────────
// An `unavailable_redistributed` pillar persists a subtotal of 0 that is NOT a real score. On a
// trajectory rule the damage is worse than on a gap rule: a pillar going unavailable would read as a
// catastrophic fall to 0 (firing T9), and coming back would read as a spectacular recovery (firing
// T5/T8). Both ends must be genuinely scored or the pair is refused.
//
// ⚠ The prior side uses TrajectoryPoint's per-pillar `*Scored` booleans, which are derived from the
// APPLIED WEIGHT on that snapshot (weight 0 ⇒ the pillar was unavailable then). That is the only
// honest availability signal for a historical row — the subtotal alone cannot distinguish "scored 0"
// from "inert 0".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE EPSILON DEFECT — read before touching a "did it move at all" gate ★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A live rescore proved a real bug: T5/T7/T8/T9's "improving"/"declining" gates (`f.delta > 0`,
// `f.delta < 0`, bare, no tolerance) fired on stocks whose Foundation had NOT moved.
//
// THE MECHANISM. At fire time, `now` is the freshly-computed, UNROUNDED in-memory float from this
// pass's own composite assembly. `prev` is a Decimal(8,4)-rounded value already persisted and
// reloaded from the prior period's row (loadTrajectorySeries reads it straight off ScoreSnapshot).
// Foundation is annual — many quarters share one filing, so the TRUE value is often unchanged between
// adjacent readings. But an unrounded live float and a rounded, round-tripped one are not bit-
// identical: a sub-0.0001 difference — pure floating-point noise, not a real move — satisfies a bare
// `< 0` / `> 0` with no tolerance. Evidence: 12 of 13 T9 fires on one production run carried
// `fallPp: 0` in their own persisted evidence (`-0` stringifies as `"0"`) — impossible under T9's own
// gate (`f.delta >= 0 → not_fired`) unless the raw delta was negative-but-immaterial. Re-running the
// SAME gate against ALREADY-PERSISTED data on both sides (both rounded, both round-tripped) made every
// one of those 12 evaluate to not_fired — proving the "move" was an artifact of the unrounded-vs-
// rounded asymmetry, not a resolution difference and not new data.
//
// THE FIX — TRAJECTORY_DELTA_EPSILON. One constant, applied via movedUp()/movedDown() below, wherever
// a rule asks "did this pillar move UP/DOWN AT ALL" (T5 asks no such question — see below). NEVER
// scatter a second literal for this; every delta-sign gate in the T-family must route through here.
//
// VALUE: floored at ScoreSnapshot's own Decimal(8,4) storage precision — 0.0001, one unit in the last
// stored place. A move smaller than what the column can even represent cannot be a real move: once
// `now` is itself persisted (which happens moments after the gate runs), it will round to the SAME
// stored value as `prev` for every one of the 17 fires this bug produced — the epsilon just applies
// that same rounding at decision time instead of one write later. It is chosen at the FLOOR, not
// padded upward: every genuine small move actually observed in this family (0.2pp on Momentum, 0.3pp
// on Foundation) sits three orders of magnitude above it, so R1's "small moves matter most" finding —
// the whole reason these gates exist — is untouched.
//
// SCOPE — NOT EVERY GATE. Crossings (T3/T4/T6, and the retired-shape D6/D7) compare against a FIXED
// boundary 10+ points from either operand; the noise floor here cannot manufacture a false crossing of
// a boundary that far away, and adding tolerance there would change genuinely correct behaviour for no
// reason. Moves (T1/T2) already gate on ±6pp — six orders of magnitude above this noise. Magnitude
// tests (S2, ≥12pp) are unaffected for the same reason. T5 has NO delta-sign gate at all — it is a
// pure crossing (`prev < 60 AND now >= 60`), so it was never exposed and needs no change (verified by
// reading its source, not assumed from its name).
//
// ★ THE DEEPER LESSON, FOR WHOEVER VERIFIES THE NEXT DELTA GATE: a harness that reads ONLY persisted
// data compares rounded-against-rounded on both sides and CANNOT reproduce this class of bug — it is
// structurally blind to it, the same way the harness that first shipped these T-patterns was. Any
// future verification of a delta-sign gate must exercise the LIVE, in-memory-vs-persisted path (a real
// or forced rescore), never a replay over rows already written to the database.

import type { FiringContext, TrajectoryPoint } from "../types.js";
import type { Pillar } from "../../composite/types.js";

/** One unit of ScoreSnapshot's Decimal(8,4) storage precision. The floor below which a delta cannot
 *  be distinguished from persistence round-trip noise. See the header above for the incident this
 *  closes and why this value (not a larger, padded one) is the honest choice. */
export const TRAJECTORY_DELTA_EPSILON = 0.0001;

/** True when `delta` represents a real upward move — not sub-storage-precision noise. Use for every
 *  "did this rise at all" gate (T7, T8). Do NOT use for a crossing (a fixed-boundary test) or a move
 *  threshold (T1/T2's ±6pp, already far above this floor). */
export const movedUp = (delta: number): boolean => delta > TRAJECTORY_DELTA_EPSILON;

/** True when `delta` represents a real downward move. Use for every "did this fall at all" gate (T9).
 *  Same scope note as movedUp. */
export const movedDown = (delta: number): boolean => delta < -TRAJECTORY_DELTA_EPSILON;

export interface PrevNow {
  prev: number;
  now: number;
  /** now − prev. Recorded for evidence; ⚠ NEVER used to derive severity (Part 4 · R1). */
  delta: number;
  priorPeriodKey: string;
}

const scoredOnPrior = (p: TrajectoryPoint, pillar: Pillar): number | null => {
  switch (pillar) {
    case "foundation": return p.foundationScored ? p.foundation : null;
    case "momentum": return p.momentumScored ? p.momentum : null;
    case "market": return p.marketScored ? p.market : null;
    case "ownership": return p.ownershipScored ? p.ownership : null;
  }
};

/** The immediately-prior reading, or null when there is none. */
export function priorReading(ctx: FiringContext): TrajectoryPoint | null {
  return ctx.priorSnapshots.length ? ctx.priorSnapshots[ctx.priorSnapshots.length - 1] : null;
}

/** One pillar across the two adjacent readings, both genuinely scored. Null ⇒ cannot evaluate. */
export function pillarPrevNow(ctx: FiringContext, pillar: Pillar): PrevNow | null {
  const prior = priorReading(ctx);
  if (!prior) return null;
  const cur = ctx.current.pillars[pillar];
  if (cur.state !== "scored" || cur.subtotal === null) return null;
  const prev = scoredOnPrior(prior, pillar);
  if (prev === null) return null;
  return { prev, now: cur.subtotal, delta: cur.subtotal - prev, priorPeriodKey: prior.periodKey };
}

/** The composite across the two adjacent readings. The composite is always a number when a snapshot
 *  exists, so only the prior's existence is gated. */
export function compositePrevNow(ctx: FiringContext): PrevNow | null {
  const prior = priorReading(ctx);
  if (!prior) return null;
  const now = ctx.current.composite;
  return { prev: prior.composite, now, delta: now - prior.composite, priorPeriodKey: prior.periodKey };
}
