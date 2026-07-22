// ═══════════════════════════════════════════════════════════════
// "DID A SCORE INPUT ACTUALLY CHANGE?" — the one question the rescore trigger should ask.
//
// The ingest blind-overwrites (`create: data, update: data`) and decides to rewrite on filingDate
// alone. So "we wrote a row" says nothing about whether any number moved. This module answers the
// real question by comparing the row's SCORE-RELEVANT columns before and after the write.
//
// ══ WHY BEFORE-vs-AFTER AND NOT NEW-VALUE-vs-STORED-VALUE ══
// The obvious implementation — compare the JS `data` object against the stored row — is subtly
// WRONG, and wrong in the direction that would quietly neuter this whole fix.
//
// Derived ratios are computed as raw JS floats and stored in fixed-scale numeric columns:
// `operatingMargin` is Decimal(8,4), and deriveIndAsAnnual computes `(ebitda / revenue) * 100`
// with no rounding. So the engine produces 12.345678901234567, Postgres stores 12.3457, and the
// NEXT run recomputes 12.345678901234567 and compares it against 12.3457 — never equal. Every
// fundamentals row would report "changed" on every pass, and the trigger would fire exactly as
// often as it does today, while LOOKING like it had been narrowed. That is the worst kind of fix.
//
// Comparing BEFORE against AFTER sidesteps it completely: both values have been through Postgres,
// so both carry the column's real scale. 19.50 and 19.5 are the same stored number and compare
// equal without any quantization, and no scale lookup or rounding-mode assumption is needed
// anywhere. It is also the more honest question — "did the PERSISTED input move?" is precisely
// what determines whether the scorer will read something different.
//
// The `after` row costs nothing: prisma.upsert() already returns it.
//
// ══ NULL IS NOT ZERO ══
// safeNumber() writes real NULLs and the loaders' n() maps null → null (an absent input, which
// gates a metric to unavailable) while 0 is a real measured zero. They score differently, so they
// must compare UNEQUAL here. A `==` would have conflated them.
// ═══════════════════════════════════════════════════════════════
import { SCORE_INPUT_COLUMNS, type ScoreInputTable } from "./score-input-columns.js";

/** Prisma's Decimal, duck-typed — avoids coupling this module to a generated class identity. */
function isDecimalLike(v: unknown): v is { equals(o: unknown): boolean; toString(): string } {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as { equals?: unknown }).equals === "function" &&
    typeof (v as { toFixed?: unknown }).toFixed === "function"
  );
}

/**
 * Compare ONE column's before/after values, both as read back from Postgres.
 *
 * Returns true when they differ. Undefined is treated as null (a column absent from a partial
 * select is indistinguishable from a NULL here, and the caller always selects the full relevant
 * set — see scoreRelevantSelect).
 */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  const an = a === undefined ? null : a;
  const bn = b === undefined ? null : b;

  if (an === null || bn === null) return an !== bn; // NULL vs 0 ⇒ different. Deliberate.

  // Decimal(p,s) — numeric equality, so 19.50 === 19.5. Never a string or float compare.
  if (isDecimalLike(an) || isDecimalLike(bn)) {
    if (isDecimalLike(an)) return !an.equals(bn as never);
    return !(bn as { equals(o: unknown): boolean }).equals(an as never);
  }

  if (an instanceof Date || bn instanceof Date) {
    if (!(an instanceof Date) || !(bn instanceof Date)) return true;
    return an.getTime() !== bn.getTime();
  }

  // BigInt (totalShares / promoterShares / pledgedShares) and the primitives.
  if (typeof an === "bigint" || typeof bn === "bigint") return String(an) !== String(bn);

  return an !== bn;
}

export interface ScoreRelevantDiff {
  /** True ⇒ a rescore MUST be triggered. */
  changed: boolean;
  /** Which score-relevant columns moved — for the run log, so an operator can see WHY. */
  changedColumns: string[];
  /** True when there was no prior row (first sighting of this period). Always `changed`. */
  firstSeen: boolean;
}

/**
 * Did any SCORE-RELEVANT column of this row move?
 *
 * `before` is the row as selected via scoreRelevantSelect BEFORE the upsert (null ⇒ no prior row).
 * `after` is the row prisma.upsert() returned.
 *
 * CONSERVATIVE BY CONSTRUCTION: a first-seen row, or any column this manifest marks relevant that
 * differs, returns changed=true. The only way to return false is for every score-relevant column
 * to be provably identical — which, per the loaders, means the scorer will read byte-identical
 * inputs and therefore cannot produce a different fingerprint.
 */
export function diffScoreRelevant(
  table: ScoreInputTable,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): ScoreRelevantDiff {
  if (!before) return { changed: true, changedColumns: [], firstSeen: true };

  const changedColumns: string[] = [];
  for (const col of SCORE_INPUT_COLUMNS[table].relevant) {
    if (valuesDiffer(before[col], after[col])) changedColumns.push(col);
  }
  return { changed: changedColumns.length > 0, changedColumns, firstSeen: false };
}
