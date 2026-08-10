// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PERIOD-OVER-PERIOD MOVEMENT — the one implementation, for both the money lines and the ratios.
//
// ── ★ WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
// `changeFact` was a private function inside fact-block.ts. The manifest path needs exactly the same
// arithmetic for sixty-seven metrics instead of two, and a SECOND copy of "never compute a percentage
// off a zero or negative base" is precisely the rule that drifts — one copy gets a fix and the other
// keeps shipping "profit up 340%" from a prior-year loss. So it moved here unchanged and both callers
// import it. This is a MOVE, not a rewrite: the behaviour fact-block.ts had is the behaviour it has.
//
// ── RULE 3, RESTATED BECAUSE IT IS THE WHOLE POINT ───────────────────────────────────────────────
// A PERCENTAGE IS NEVER COMPUTED OFF A ZERO OR NEGATIVE BASE. `kind` switches on the sign of both
// sides and renders a turnaround in words. "Profit up 340%" against a prior-year loss is
// arithmetically defensible and completely meaningless to the reader this feature is for. It is
// structurally impossible here because the KIND decides the rendering, not the caller.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { money, moneyLoss } from "./format.js";
import type { ChangeFact } from "./types.js";

/** Movement below half a point is noise at whole-number precision; "up 0%" is worse than "barely moved". */
export const MOVEMENT_FLOOR_PCT = 0.5;

/** ★ ABOVE THIS, A PERCENTAGE STOPS CONVEYING AND THE TWO ABSOLUTES CONVEY BETTER.
 *
 *  ⚠ FOUND BY RENDERING, NOT BY LOOKING — the fifteenth degenerate case, and the one rule 3 does NOT
 *  cover. Rule 3 forbids a percentage off a ZERO OR NEGATIVE base. It says nothing about a base that is
 *  positive and tiny, and the first card built off the manifest opened with DIXON's other income
 *  "up 31346% against the same quarter last year" — ₹528 crore against ₹1.68 crore. Arithmetically
 *  perfect, and no more use to the reader than the ₹0-crore loss below.
 *
 *  MEASURED across 21,638 year-on-year money comparisons with both sides positive: p90 = 96%,
 *  p99 = 804%, p99.9 = 13,536%, maximum 101,075%. The cut sits at 1000% — eleven times over — which
 *  catches 178 comparisons (0.82%) and leaves every ordinary doubling and tripling as a percentage.
 *  Banking never reaches it (its worst other-income move is 368%); the offenders are other income,
 *  tax and one-off-heavy lines, which is exactly where a tiny base is common. */
export const LARGE_MOVE_PCT = 1000;

export const QOQ_REF = "against the previous quarter";
export const YOY_REF = "against the same quarter last year";

/** "against the previous quarter" → "the previous quarter".
 *
 *  ⚠ A SENTENCE NEEDS THE NOUN, NOT THE PHRASE. Three of the renderings below name both figures, and
 *  built from the phrase they read "a loss of ₹5 crore, against a loss of ₹3 crore against the same
 *  quarter last year" — a doubled preposition that was already shipping in the `both_loss` wording.
 *  Derived here rather than passed as a second argument so the two can never disagree. */
const periodNoun = (reference: string): string => reference.replace(/^against /, "");

/**
 * A money line's movement between two periods.
 *
 * `_noun` is the line's own name and is DELIBERATELY NOT interpolated into the turnaround phrasings:
 * the caller already prefixes them with the line, and including it again produced
 * "Net profit moved from a net profit loss of ₹5,286 crore" on IDEA.
 */
export function changeFact(
  key: string,
  current: number | null,
  prior: number | null,
  reference: string,
  _noun: string,
): ChangeFact | null {
  if (current === null || prior === null) return null;

  const was = periodNoun(reference);

  // ⚠ NIL IS NOT A LOSS, AND IT USED TO RENDER AS ONE. Zero fails `> 0`, so a line that was nil in both
  // quarters fell through every branch into `both_loss` and printed "a loss of ₹0 crore, against a loss
  // of ₹0 crore". Measured: 84 of 299 banking year-on-year pairs have exceptional items at exactly zero
  // on both sides, and 269 of 511 banking rows carry a zero there at all. A company that reported
  // nothing on a line reported NOTHING — it did not lose ₹0.
  if (current === 0 && prior === 0) {
    return { key, kind: "nil", value: null, reference, display: `nil, as in ${was}` };
  }

  // Both sides healthy — a percentage is meaningful, up to the point where it stops being.
  if (prior > 0 && current > 0) {
    const pct = ((current - prior) / prior) * 100;
    if (Math.abs(pct) < MOVEMENT_FLOOR_PCT) {
      return { key, kind: "percent", value: pct, reference, display: `little changed ${reference}` };
    }
    // ★ The two absolutes, not the percentage. `value` is still carried so the verdict's direction
    // reading is unchanged — this switches the RENDERING, never the arithmetic. See LARGE_MOVE_PCT.
    if (Math.abs(pct) >= LARGE_MOVE_PCT) {
      return { key, kind: "large_move", value: pct, reference, display: `${money(current)}, against ${money(prior)} in ${was}` };
    }
    const dir = pct > 0 ? "up" : "down";
    return { key, kind: "percent", value: pct, reference, display: `${dir} ${Math.round(Math.abs(pct))}% ${reference}` };
  }

  if (prior <= 0 && current > 0) {
    // From nil is not from a loss.
    const from = prior === 0 ? "nil" : moneyLoss(prior);
    return { key, kind: "turnaround", value: null, reference, display: `moved from ${from} to ${money(current)}, ${reference}` };
  }

  if (prior > 0 && current <= 0) {
    const to = current === 0 ? "nil" : moneyLoss(current);
    return { key, kind: "to_loss", value: null, reference, display: `moved from ${money(prior)} to ${to}, ${reference}` };
  }

  // Both sides at or below zero, and not both nil — at least one is a real loss.
  const cur = current === 0 ? "nil" : moneyLoss(current);
  const pri = prior === 0 ? "nil" : moneyLoss(prior);
  return { key, kind: "both_loss", value: null, reference, display: `${cur}, against ${pri} in ${was}` };
}
