// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHAPE TEST, AND THE STATE IT RESOLVES TO. PURE. One home for the three-way decision.
//
// ── ★ THE CORRECTION: A THRESHOLD IS AN INTENSITY, NOT A GATE ─────────────────────────────────────
// D1–D4 gated on their thresholds — cross them and the pattern exists, miss them and it does not.
// That is backwards. The pattern IS THE SHAPE: Market elevated against a weak fundamental pillar.
// Where the pillars sit relative to their thresholds decides how loudly it speaks, not whether it
// speaks at all.
//
// So firing and grading are now two separate questions, asked in that order:
//
//   1. DOES THE SHAPE HOLD?   direction · gap ≥ 12 · the high side is genuinely high
//   2. HOW FAR ALONG IS IT?   formed (both legs past threshold) · building (at least one has not)
//
// A rule that conflated them could only answer "yes at full strength" or "no", and answered "no" for
// GLENMARK — 43 points apart on Market↔Momentum, sitting squarely in the evidenced configuration,
// reported as no pattern because the gate read 74 where the evidence reads 68.
//
// ── ★ WHY THREE CONDITIONS AND NOT TWO ────────────────────────────────────────────────────────────
// DIRECTION is what keeps the excluded configuration off the board. "Fundamentals ahead of price"
// (Divergence spec Part 4) has CONFLICTING evidence — one run −0.6%/47%, another +13.7%/80% but on
// absolute returns in a rising market — so the spec's own test applies: *if you cannot say which way
// the tension resolves and why, it does not belong in the tool.* It fires in NO state, not even
// Building, because Building is a statement that a KNOWN shape is incomplete, and this shape is not
// known. The subtraction enforces it structurally: `high − low` is negative in the inverse, so the
// gap floor can never be met and there is no branch to forget.
//
// THE HIGH SIDE MUST GENUINELY BE HIGH. Market 55 against Foundation 40 is twelve points apart in the
// right direction and nothing has run ahead — that is two weak pillars, one weaker. Without this the
// shape test would call a depressed pair "price ahead of quality".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PatternState } from "../../../catalogue/pattern-facts.js";

export type { PatternState };

/** Why the shape did not hold. Carried so a caller can report a decision rather than a silence. */
export type AbsentReason = "wrong_direction" | "gap_below_floor" | "high_side_not_elevated";

export interface ShapeResult {
  state: PatternState;
  /** Non-null exactly when `state` is "absent". */
  absentReason: AbsentReason | null;
  /** high − low. Negative in the inverse configuration; the caller never surfaces that case. */
  gap: number;
}

/**
 * ★ THE LEVEL-BASED SHAPE TEST — D1 and D2.
 *
 * @param high            the elevated pillar's reading (Market, for both patterns today)
 * @param low             the lagging pillar's reading (Foundation for D1, Momentum for D2)
 * @param gapFloor        §1.1's material floor (12). Unchanged by this ruling.
 * @param highElevatedAbove  the high pillar's own panel median — see MARKET_ELEVATED_FLOOR
 * @param highFormedAt    the high leg's evidenced threshold (68 — the n=79 configuration)
 * @param lowFormedBelow  the low leg's evidenced threshold (58)
 *
 * ⚠ THE ORDER OF THE THREE TESTS IS THE ORDER OF THEIR REASONS, and it is deliberate: direction is
 * asked first because the inverse must never reach a gap comparison at all, and the elevation test is
 * asked last because it is the only one that can reject a shape which is otherwise correct.
 */
export function priceAheadShape(opts: {
  high: number;
  low: number;
  gapFloor: number;
  highElevatedAbove: number;
  highFormedAt: number;
  lowFormedBelow: number;
}): ShapeResult {
  const gap = opts.high - opts.low;

  // 1 · DIRECTION. The excluded fundamentals-ahead-of-price configuration, in no state.
  if (gap <= 0) return { state: "absent", absentReason: "wrong_direction", gap };
  // 2 · THE MATERIAL FLOOR. §1.1's 8–11 minor band and everything under it stays off the board.
  if (gap < opts.gapFloor) return { state: "absent", absentReason: "gap_below_floor", gap };
  // 3 · THE HIGH SIDE IS GENUINELY HIGH.
  if (opts.high <= opts.highElevatedAbove) {
    return { state: "absent", absentReason: "high_side_not_elevated", gap };
  }

  // The shape holds. Now — and only now — how far along is it?
  const formed = opts.high >= opts.highFormedAt && opts.low < opts.lowFormedBelow;
  return { state: formed ? "formed" : "building", absentReason: null, gap };
}

/**
 * ★ THE MOVEMENT-BASED STATE — D3 and D4.
 *
 * For a movement pattern the mapping is by SIZE OF MOVE, not by level: the record's `evidencedTier`
 * (8) is the Building/Formed boundary and its `movementFloor` (2) is the Absent/Building one. Both
 * numbers were already declared; what changes is that they are read as a three-way state instead of
 * as an on/off gate.
 *
 * ⚠ TAKES |Δ|. Direction is the CALLER's question — D3 is the building side and D4 the exiting side,
 * and a rule that handed this a signed delta would be asking this function to decide which pattern it
 * is, which it cannot know.
 */
export function movementState(absDelta: number, formedAt: number, buildingFloor: number): PatternState {
  if (absDelta >= formedAt) return "formed";
  if (absDelta >= buildingFloor) return "building";
  return "absent";
}

/**
 * ★ HOW FAR A LEG IS FROM ITS OWN THRESHOLD — a fact stated, never a boundary tested.
 *
 * This is what lets Building copy say "Market 65, three points below 68" instead of asserting
 * anything. It is also the answer to the mixed case: when one leg has crossed and the other has not,
 * naming BOTH distances lets the asymmetry tell the story without a sentence having to characterise
 * it.
 *
 * Returns the signed shortfall in the direction the leg must travel — positive means "still this far
 * to go", zero or negative means the leg has crossed. `crossed` is carried separately so a caller
 * never has to re-derive it from the sign.
 */
export interface LegDistance {
  pillar: string;
  reading: number;
  threshold: number;
  /** Points still to travel. ≤ 0 once crossed. */
  shortfall: number;
  crossed: boolean;
}

/** A leg that must rise to or above `threshold` (Market ≥ 68). */
export function legAbove(pillar: string, reading: number, threshold: number): LegDistance {
  return { pillar, reading, threshold, shortfall: threshold - reading, crossed: reading >= threshold };
}

/** A leg that must fall below `threshold` (Foundation < 58, Momentum < 58). */
export function legBelow(pillar: string, reading: number, threshold: number): LegDistance {
  return { pillar, reading, threshold, shortfall: reading - threshold, crossed: reading < threshold };
}
