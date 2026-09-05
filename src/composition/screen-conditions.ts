// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SCREEN CONDITIONS — reading "return on equity above 20%" off a sentence, in code.
//
// ── ★ WHY THIS IS NOT THE MODEL'S JOB ─────────────────────────────────────────────────────────────
// The old `screenStocks` tool had the model emit the condition list, and that was reasonable when the
// model was the only thing that could read the sentence. It is now the wrong side of two lines:
//
//   1. §6.5 measured the router at 80–88% run-to-run reproducibility. A screen whose THRESHOLD moves
//      between two identical asks returns a different company list each time, and a reader comparing
//      two answers has no way to see that the question changed rather than the market.
//   2. N-1. A model-emitted `min: 20` is a number the model produced that goes on to select rows and
//      to be printed back as the condition. Code reading "20%" out of the reader's own sentence is a
//      number the READER produced, which is the only kind a screen may act on.
//
// ── ★ IT REFUSES RATHER THAN GUESSES ──────────────────────────────────────────────────────────────
// An unmatched sentence returns `[]`, and the caller composes the universe cross-section instead. A
// screen run on an empty condition list returns the whole universe and renders it as a match set — a
// filter that filtered nothing, presented as though it had. That is the failure this refusal avoids.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { ScreenCondition, ScreenFieldId } from "../scoring/read/screen.types.js";

/**
 * Reader phrasings → field ids. Longest-first at match time, so "return on capital" cannot be eaten
 * by "return on equity"'s prefix, and "operating margin" is not swallowed by "margin".
 */
const FIELD_PHRASES: readonly (readonly [ScreenFieldId, readonly string[]])[] = [
  ["returnOnCapital", ["return on capital employed", "return on capital", "roce"]],
  ["returnOnEquity", ["return on equity", "roe"]],
  ["debtToEquity", ["debt to equity", "debt/equity", "debt equity", "d/e"]],
  ["interestCoverage", ["interest coverage", "interest cover"]],
  ["cashConversion", ["cash conversion"]],
  ["receivableDays", ["receivable days", "receivables"]],
  ["assetTurnover", ["asset turnover"]],
  ["operatingMargin", ["operating margin", "opm"]],
  ["netMargin", ["net margin", "profit margin"]],
  ["health", ["health score", "health"]],
  ["foundation", ["foundation"]],
  ["momentum", ["momentum"]],
  ["market", ["market pillar"]],
  ["ownership", ["ownership score", "ownership pillar"]],
];

/** Comparators, and which bound each sets. `under`/`below` set a MAX; `above`/`over` set a MIN. */
const ABOVE = /\b(above|over|greater than|more than|at least|>=?|higher than)\b/i;
const BELOW = /\b(under|below|less than|lower than|at most|<=?|no more than)\b/i;

export function extractConditions(raw: string): ScreenCondition[] {
  const text = raw.toLowerCase();
  const out: ScreenCondition[] = [];
  const claimed: [number, number][] = [];

  const overlaps = (a: number, b: number) => claimed.some(([x, y]) => a < y && b > x);

  // Longest phrase first, so a shorter alias cannot claim a span a longer one owns.
  const pairs = FIELD_PHRASES.flatMap(([id, ps]) => ps.map((p) => [id, p] as const))
    .sort((a, b) => b[1].length - a[1].length);

  for (const [field, phrase] of pairs) {
    const at = text.indexOf(phrase);
    if (at < 0 || overlaps(at, at + phrase.length)) continue;

    // The comparator and number must follow the field within a short span — "roe above 20" is one
    // condition; "roe" in one clause and "above 20" in another about something else is not.
    const tail = text.slice(at + phrase.length, at + phrase.length + 40);
    const num = /(-?\d+(?:\.\d+)?)\s*%?/.exec(tail);
    if (!num) continue;
    const v = Number(num[1]);
    if (!Number.isFinite(v)) continue;

    const below = BELOW.test(tail);
    const above = ABOVE.test(tail);
    // ⚠ NEITHER COMPARATOR MEANS NO CONDITION. "companies with return on equity 20" states a value,
    //   not a bound, and choosing one for the reader would silently answer a different question.
    if (!below && !above) continue;

    claimed.push([at, at + phrase.length]);
    out.push(below ? { field, max: v } : { field, min: v });
  }
  return out;
}
