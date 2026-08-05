// File: src/scoring/findings/format.ts
//
// THE ONE ROUNDING AUTHORITY for the D/S/T pattern family. PURE.
//
// ── ★ THE DEFECT THIS CLOSES ──────────────────────────────────────────────────────────────────────
// A number used to get rounded TWICE, at TWO DIFFERENT precisions, by TWO DIFFERENT LAYERS: the rule
// rounded to 1dp when writing evidence (its own local `r1`, one copy per rule file), then
// verdicts.ts's `f(v, d)` rounded AGAIN to whatever `d` that call site happened to hardcode — mostly
// 0. SAIL's Momentum moved 36.4694 → 36.6592; evidence correctly recorded 36.5 → 36.7; the renderer
// flattened both to "37" and the card read "37 to 37" on a genuine move. Four authorities existed on
// one number: the rule's r1, the rule's (occasional) r2, verdicts.ts's per-call-site `d`, and the
// frontend's own decimals tables (evidence-shape.ts, the chart/readout components). This is now one.
//
// ── THE RULE ───────────────────────────────────────────────────────────────────────────────────────
// A number is formatted EXACTLY ONCE, at the pattern's own declared `displayPrecision`
// (catalogue/pattern-facts.ts), by this module. A rule rounds to it when WRITING evidence
// (`roundToPrecision`); a renderer reads the SAME value back and prints it at the SAME precision — it
// never re-rounds. Evidence and display carry the same number by construction, not by convention.
//
// ⚠ SCOPE — the PATTERN'S OWN reading only. This governs the live pillar/composite/gap/delta numbers a
// rule computes from the stock's own scored data — the ones with a genuine double-rounding risk,
// because they are written once by the rule and read again by the renderer. It does NOT govern:
//   · STUDY STATISTICS quoted verbatim from the spec (hit rates, sample sizes, effect percentages) —
//     these are literal constants in the rule/renderer, never passed through a rounding step at all,
//     so there is no "authority" to unify.
//   · CATALOG THRESHOLD CONSTANTS (a crossing's boundary, e.g. D6's `crossedBelow: 75`) — these are
//     the pattern's OWN fixed definition, not a live reading, and were never subject to r1()/r2() in
//     the first place.
//   · DRIVER-CLAUSE DETAIL (D3/D4's shareholding/flow breakdown in ownership-move.ts) — a single,
//     already-consistent authority (r2 → toFixed(2) at the same 2dp throughout); not part of this bug.
export function roundToPrecision(x: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(x * factor) / factor;
}

/**
 * ★ THE PRECISION FOR A DIFFERENCE IN PROSE — gaps and deltas, 0dp.
 *
 * ── WHY A SECOND DECLARED PRECISION IS NOT A SECOND AUTHORITY ─────────────────────────────────────
 * `displayPrecision` governs a pillar READING: Foundation 57.7 is a measurement, and the tenth is part
 * of it. A GAP or a DELTA is a DIFFERENCE of two such readings, and prose that says "a 21.0-point gap"
 * dresses a subtraction up as a measurement — it implies the tenth was measured when it is a residue
 * of two roundings. In prose the difference is a whole number.
 *
 * ⚠ AND THIS IS STILL ONE ROUNDING PER QUANTITY, WHICH IS THE RULE THAT MATTERS. A reading is
 * formatted once, at its pattern's `displayPrecision`. A difference is formatted once, here. What the
 * precision pass forbade was ONE quantity rounded twice at two precisions by two layers — not two
 * KINDS of quantity each having a declared precision of its own. The evidence blob keeps `gapPp` at
 * the pattern's own precision for chart/data consumers; only the SENTENCE rounds a difference.
 *
 * ⚠ THE ARITHMETIC CAVEAT, STATED: 78.7 − 57.7 is exactly 21.0, but 78.6 − 57.7 is 20.9 and prints as
 * "21". The prose figure is therefore the difference TO THE NEAREST POINT, not a restatement of the
 * two readings, and a reader who subtracts the printed pillars may land one off. That is the accepted
 * cost of not implying precision we did not measure; the exact figure remains in evidence.
 *
 * Module-level rather than per-record because it is a fact about what a difference IS, not about any
 * one pattern. If a pattern ever genuinely needs a decimal in a difference, it earns a record field —
 * it does not get a second literal at a call site.
 */
export const DIFFERENCE_DISPLAY_PRECISION = 0;

/**
 * ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — if the surfaced values are equal, the pattern has
 * not fired). A rule must not fire on a delta that is invisible at the precision its own card renders
 * — a card reading "36.5 to 36.5" on a "move" is worse than the double-rounding bug this module
 * exists to close: it is not merely inconsistent with the evidence, it is a visible non-move
 * presented as one.
 *
 * With evidence now stored at display precision, this is ALREADY GUARANTEED for every pattern whose
 * movement floor exceeds the rounding granularity (T1/T2 at ±6, D5 at +5, T7/T8/T9 at ±1.0 — see the
 * movement-floor ruling) — asserted here rather than assumed, because a future recalibration of a
 * floor must not silently reopen this. It has REAL, live effect for the patterns with no such floor:
 * D3/D4 (ownership movement, declared but unenforced) and every CROSSING pattern (D6/D7, T3/T4/T5/T6),
 * which enforce no minimum margin on the crossing itself.
 */
export function distinctAtPrecision(a: number, b: number, decimals: number): boolean {
  return roundToPrecision(a, decimals) !== roundToPrecision(b, decimals);
}
