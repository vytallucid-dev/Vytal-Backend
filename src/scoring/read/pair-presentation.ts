// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PAIR PRESENTATION — which reading LEADS a pillar pair, and which drop to its context section.
//
// A TAB IS A PILLAR PAIR, NOT A READING. Everything about Foundation↔Momentum lives in one card, and
// that card has a lead and a context section. This module decides, per pair, which is which — the one
// question that cannot be answered by any finding on its own, because it depends on what ELSE is on
// the pair.
//
// It is a READ-LAYER concern and deliberately not a scoring one. Nothing here changes what fired, what
// was persisted, or what any rule measured: every finding that fired still travels on the wire. What
// is decided here is PRESENTATION — lead or context — which is why it runs at view assembly and why a
// demoted finding keeps its full payload rather than being trimmed.
//
// ── ★ THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
//
//   1. S2 DEMOTES WHENEVER ANYTHING ELSE OCCUPIES ITS PAIR. Sticky divergence is not an event; it is a
//      property of a gap observed over time. PERSISTENCE QUALIFIES A READING RATHER THAN BEING ONE. A
//      card stating that the pillars have diverged, beside another stating that they have been
//      diverged for a while, splits one fact across two entries. S2 stands as a full card ONLY when it
//      is alone on Foundation↔Momentum — that is its designed role: the reading that teaches the
//      model's honest limit, state is readable and timing is not.
//
//      ⚠ BROADER THAN COALESCING, AND THAT IS THE RULING. It applies beside D5 (which can co-occur —
//      D5's gap floor of 8 clears while the standing gap is ≥12), beside the coalesced D6+D7 entry,
//      and beside a not-covered note on the same pair. Any occupant demotes it.
//
//   2. A NOTE MUST NOT SIT BESIDE THE PATTERN THAT SUPERSEDES IT. Two not-covered records name the
//      pattern that replaced them in their `reason` (`superseded_by_D6`, `superseded_by_T7`) and
//      nothing has ever read it. Where that exact pattern is present on the same pair, the note is
//      REDUNDANCY, not contradiction — the same measurement, weaker — and is dropped entirely rather
//      than demoted. Zero live cases today; wired because the data is there and it costs one condition.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { NOT_COVERED, type NotCoveredId } from "../../catalogue/not-covered.js";
import type { PatternSubject } from "../../catalogue/pattern-facts.js";

/** The sticky-divergence key — the one pattern that demotes beside any other occupant of its pair. */
export const STICKY_KEY = "divergence_S2_sticky_divergence";

/**
 * ★ THE SUPERSESSION MAP — reason token → the pattern key that replaced the note.
 *
 * Read from the reason the registry already declares, rather than a second list to keep in step. A
 * reason with no entry here supersedes nothing, which is the correct default for the other five.
 */
const SUPERSEDED_BY: Readonly<Record<string, string>> = {
  superseded_by_D6: "divergence_D6_quality_rolling_over",
  superseded_by_T7: "trajectory_D_T7_momentum_improving_while_weak",
};

/** A stable key for "which pillar pair is this about", order-independent. */
export const pairKeyOf = (subjects: readonly PatternSubject[]): string => [...subjects].sort().join("+");

/**
 * Does a pattern that supersedes this note sit on the same pair?
 *
 * ⚠ THE SAME PAIR, NOT MERELY THE SAME STOCK. A note is redundant beside the pattern that replaced it
 * only where they describe the same two readings; the same key elsewhere on the page is a different
 * card about different pillars and suppresses nothing.
 */
export function isSupersededOnPair(
  noteId: NotCoveredId,
  patternKeysOnPair: readonly string[],
): boolean {
  const rec = NOT_COVERED[noteId];
  if (!rec) return false;
  const superseder = SUPERSEDED_BY[rec.reason];
  return superseder !== undefined && patternKeysOnPair.includes(superseder);
}

/**
 * ★ THE STICKY CONTEXT LINE — persistence stated as fact, carrying the direction of travel. (ruled)
 *
 * ⚠ S2'S CARD COPY IS NOT REUSED, AND A SINGLE FIXED LINE CANNOT SERVE EITHER. S2's card copy says the
 * pillars ARE NOT CONVERGING. Under D5 that is false: D5 fires when Momentum is rising toward a higher
 * Foundation, so the gap can have persisted across readings while NARROWING at this one. A context line
 * asserting non-convergence beneath a card about convergence would contradict the card it qualifies.
 *
 * So persistence is the constant and direction is selected per reading — the same discipline already
 * set for Building, where the sentence states what holds and withholds what does not.
 */
export type GapDirection = "narrowed" | "widened" | "unchanged";

const STICKY_CONTEXT_BASE = "These two readings have been apart for more than one period.";
const STICKY_CONTEXT_DIRECTION: Readonly<Record<GapDirection, string>> = {
  narrowed: "and the gap narrowed at this reading.",
  widened: "and the gap widened at this reading.",
  unchanged: "and the gap was unchanged at this reading.",
};

/**
 * The demoted S2 line for one reading.
 *
 * @param direction how the gap moved at THIS reading, or null when there is no prior to compare
 *                  against. With no prior we state persistence alone rather than guessing a direction —
 *                  the same refusal the crossing rules make when they have one reading.
 */
export function stickyContextLine(direction: GapDirection | null): string {
  return direction === null
    ? STICKY_CONTEXT_BASE
    : `${STICKY_CONTEXT_BASE} — ${STICKY_CONTEXT_DIRECTION[direction]}`;
}

/**
 * Which way did the gap move between two readings?
 *
 * The deadband is the display precision: a change that rounds to the same printed gap is not a change
 * the card may describe as one. Same rule format.ts's `distinctAtPrecision` enforces on the rules — a
 * move the reader cannot see stated as a move is a defect, not a rounding detail.
 */
export function gapDirectionOf(gapNow: number | null, gapPrior: number | null, precision = 1): GapDirection | null {
  if (gapNow === null || gapPrior === null) return null;
  const f = 10 ** precision;
  const now = Math.round(gapNow * f) / f;
  const prior = Math.round(gapPrior * f) / f;
  if (now === prior) return "unchanged";
  return now < prior ? "narrowed" : "widened";
}
