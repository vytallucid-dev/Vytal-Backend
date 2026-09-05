// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DX · THE RESOLVED WINDOW, WHEN IT IS SHORTER THAN THE ONE ASKED FOR. Phase 3.
//
// ── ★ THE RULE, AND THE HALF THAT WAS MISSING ─────────────────────────────────────────────────────
// "The resolved window is stated, always. Answering a shorter period than asked without saying so is
// the quiet lie."
//
// The RESOLVED half was already right everywhere and had been since §3.3: every series section
// carries a `windowLabel`, the coverage header states the depth held, and T's opening says "across 14
// quarters" in its first sentence. Measured across F and T, nothing was invented and nothing was
// padded.
//
// ⚠ WHAT NOTHING SAID WAS THAT THE READER HAD ASKED FOR MORE. "Show me TCS's score over the last 20
//   quarters" returned 14 with a correct label and no acknowledgement; "the last 10 years" of a P&L
//   returned 8. Both answers are true and both leave the reader to notice the difference by counting
//   — and a reader who does not count carries away a wrong idea of what they were shown.
//
// ── ★ WHY THIS IS ONE HOME AND NOT A SENTENCE PER FAMILY ──────────────────────────────────────────
// Four families already resolve a window against an ask (F's `statementWindow`, T's epoch, OA's
// filing cliff, PG's frozen tier). Four sentences would drift; worse, the fourth would be forgotten,
// which is how this half went missing in the first place. `Window.periods` is already the RESOLVED
// count by contract — "a caller who asked for 20 quarters and got 8 must be able to see that it got
// 8" — so the data has always been there.
//
// ── ⚠ AND IT NEVER APOLOGISES ─────────────────────────────────────────────────────────────────────
// The sentence states a fact about the record, not a failure of ours. Where the shortfall has a
// REASON we hold — the scoring epoch, a filing cliff — the caller passes it and the sentence carries
// it, because "there are only 14" and "there are only 14 because we started in 2023" are different
// answers and the second is the one that stops the reader asking again.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export type WindowUnit = "quarter" | "year" | "filing" | "reading";

const PLURAL: Record<WindowUnit, string> = {
  quarter: "quarters", year: "years", filing: "filings", reading: "readings",
};

/**
 * The sentence for a window shorter than the one asked for.
 *
 * `null` when nothing was asked for, when the ask was met, or when MORE is held than was asked — a
 * reader who asked for 8 and could have had 30 got exactly what they asked for, and telling them
 * about the other 22 is noise rather than honesty.
 *
 * @param asked  what the reader asked for. `null` ⇒ they asked for no particular window.
 * @param got    what was actually drawn — the RESOLVED count, never the requested one.
 * @param reason why the record stops where it does, in the reader's words. Optional and worth having.
 */
export function windowShortfall(
  asked: number | null,
  got: number,
  unit: WindowUnit,
  reason?: string | null,
): string | null {
  if (asked === null || !Number.isFinite(asked) || asked <= 0) return null;
  if (got >= asked) return null;

  const p = PLURAL[unit];
  const head = got === 0
    ? `You asked for ${asked} ${p} and we hold none.`
    : `You asked for ${asked} ${p}; there ${got === 1 ? "is" : "are"} ${got}, and ${got === 1 ? "it is" : "they are"} what is below.`;
  return reason ? `${head} ${reason}` : head;
}

/**
 * ★ THE SAME FACT FOR THE MODEL, AS A DIGEST-SHAPED PAIR.
 *
 * ⚠ THE DIGEST IS THE HALF THE MODEL READS, AND A SHORTFALL IT CANNOT SEE IS ONE IT WILL WRITE OVER.
 *   Handed "14 readings" with no note, a model asked about twenty quarters will happily narrate
 *   twenty. Same rule as N-4: the absence is stated to BOTH audiences or it is stated to neither.
 */
export function windowShortfallLine(
  asked: number | null,
  got: number,
  unit: WindowUnit,
): { label: string; value: string } | null {
  if (asked === null || got >= asked) return null;
  return {
    label: "Window asked for",
    value: `${asked} ${PLURAL[unit]} — ${got} held, and ${got} is what is shown`,
  };
}
