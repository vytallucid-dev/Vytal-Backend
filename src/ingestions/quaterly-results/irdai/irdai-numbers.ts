// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NUMBER TOKENISING AND BOUNDS — B1d. Fail loud. Never default to null. Never coerce.
//
// ⚠ THE SCHEDULE-REFERENCE TRAP, MEASURED. IRDAI rows carry a cross-reference to the schedule that
//   supports them, IN THE SAME TEXT RUN as the numbers:
//        "Share capital L-8, L-9 2,15,782 2,15,299"
//        "Premiums earned (Net) NL-4 18,182 69,024 16,325 65,144 ..."
//        "Interest, Dividend & Rent - Gross (Note 1) 3,836 18,269 ..."
//   A naive number scan on the first row returns [8, 9, 215782, 215299] and a caller taking the
//   first column gets 8 -> 0.08 crore instead of 2,157.82 crore.
//
//   ⚠ THIS ONE ACTUALLY HAPPENED during the Stage-9 assessment: the first-pass extractor returned
//     0.08 for HDFCLIFE share capital against a stored 2157.82. It was caught only because the
//     answer was absurd. "L-12" would have yielded 12 — a number small enough to look like a
//     plausible figure in crore and pass any sanity bound. Strip the refs BEFORE tokenising.
//
// ⚠ INDIAN DIGIT GROUPING. "1,27,420.12" is one number, not three. A comma-splitting tokeniser
//   built for western grouping reads 1 / 27 / 420.12. Both groupings appear in this corpus —
//   ICICIGI writes 2,094,910 and LIC writes 1,27,420.12 in the same programme.
//
// ⚠ NEGATIVE STYLE. Every insurer in the corpus brackets negatives: "(3,588)" is -3588. Some also
//   use a leading minus. Both are handled; a bare "-" alone is a STRUCTURAL ZERO (the cell is
//   empty), which is NOT the same as a missing value and is returned as 0, not null.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Schedule cross-references and note markers that sit inline with the numbers. */
const SCHEDULE_REF =
  /\b(?:NL|L)\s?-\s?\d{1,2}[A-Za-z]?\b(?:\s*(?:&|,|and)\s*(?:NL|L)\s?-\s?\d{1,2}[A-Za-z]?\b)*|\(\s*(?:Refer\s+)?Note\s*[-\s]*\d+[^)]{0,12}\)|\bNote\s*-\s*\d\b|\bSchedule\s+Ref\.?\b/gi;

/** Strip schedule refs and note markers. ALWAYS call before tokenising a row. */
export function stripRefs(line: string): string {
  return line.replace(SCHEDULE_REF, " ");
}

export type Cell =
  /** A real figure. */
  | { kind: "number"; value: number; raw: string }
  /** A dash / blank: the form says "nothing here". Distinct from absent. */
  | { kind: "structural_zero"; raw: string }
  /** "NA" / "NIL" as the form writes them. */
  | { kind: "not_applicable"; raw: string };

const NUM_TOKEN =
  /\(\s*-?[\d,]+(?:\.\d+)?\s*\)|-?[\d,]+\.\d+|-?[\d,]+(?![\d,.])|(?<=\s|^)[-–—](?=\s|$)|\bN\.?A\.?\b|\bNIL\b/gi;

/**
 * Tokenise the numeric cells of ONE row, after the label.
 * ⚠ Pass the row with its schedule refs already stripped, and with the leading label removed by the
 *   caller — this function does not know where the label ends.
 */
export function tokeniseCells(afterLabel: string): Cell[] {
  const out: Cell[] = [];
  for (const m of afterLabel.matchAll(NUM_TOKEN)) {
    const raw = m[0].trim();
    if (/^[-–—]$/.test(raw)) {
      out.push({ kind: "structural_zero", raw });
      continue;
    }
    if (/^(N\.?A\.?|NIL)$/i.test(raw)) {
      out.push({ kind: "not_applicable", raw });
      continue;
    }
    const bracketed = raw.startsWith("(") && raw.endsWith(")");
    const body = raw.replace(/[()]/g, "").replace(/,/g, "").trim();
    const n = Number(body);
    if (!Number.isFinite(n)) {
      // ⚠ Do not skip silently. A token the regex matched but Number() rejected means the tokeniser
      //   and the parser disagree, and that is a bug to surface, not a cell to drop.
      throw new NumberParseError(`token ${JSON.stringify(raw)} matched as numeric but is not finite`);
    }
    out.push({ kind: "number", value: bracketed ? -n : n, raw });
  }
  return out;
}

export class NumberParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NumberParseError";
  }
}

/** Raised when an anchor row is not found. ⚠ B1d: never returned as null. */
export class TagNotFoundError extends Error {
  constructor(
    readonly field: string,
    readonly anchor: string,
    readonly formId: string,
  ) {
    super(`TAG NOT FOUND: field "${field}" anchor "${anchor}" absent from ${formId}`);
    this.name = "TagNotFoundError";
  }
}

/** Raised when a value is outside what the column can physically hold. */
export class BoundsError extends Error {
  constructor(
    readonly field: string,
    readonly value: number,
    readonly detail: string,
  ) {
    super(`BOUNDS: ${field} = ${value} — ${detail}`);
    this.name = "BoundsError";
  }
}

/**
 * Sanity-bound every number before it is stored. ⚠ B1d.
 *
 * The money columns are Decimal(18,2) holding RUPEES CRORE. The largest legitimate figure in this
 * corpus is LIC's total assets, order 6e6 crore (~60 lakh crore). A value above 1e9 crore is not a
 * big insurer, it is a unit error that survived the unit rule; a value whose magnitude exceeds the
 * column precision would be silently truncated by Postgres, which is the quiet failure this guards.
 */
const MONEY_ABS_MAX = 1e9; // Rs crore
const MONEY_DECIMAL_MAX = 1e16 - 1; // Decimal(18,2)

export function boundMoney(field: string, v: number): number {
  if (!Number.isFinite(v)) throw new BoundsError(field, v, "not finite");
  if (Math.abs(v) > MONEY_DECIMAL_MAX) {
    throw new BoundsError(field, v, `exceeds Decimal(18,2) capacity — Postgres would truncate`);
  }
  if (Math.abs(v) > MONEY_ABS_MAX) {
    throw new BoundsError(
      field,
      v,
      `abs value above ${MONEY_ABS_MAX} Rs crore. The largest figure in this corpus is LIC total ` +
        `assets at order 6e6 crore, so this is a unit error the unit rule did not catch, not a real figure.`,
    );
  }
  return v;
}

/**
 * ⚠ Ratio columns are FRACTIONS in this schema (0.8907 = 89.07%), except solvency which is a
 *   MULTIPLE (1.77 = 1.77x). The forms state percentages ("177%", "84.9%"). Converting is the
 *   caller's job; this only refuses what cannot be either.
 */
export function boundFraction(field: string, v: number): number {
  if (!Number.isFinite(v)) throw new BoundsError(field, v, "not finite");
  if (v < -1 || v > 5) {
    throw new BoundsError(field, v, `outside -1..5 for a FRACTION column — looks like a percent that was not divided by 100`);
  }
  return v;
}

export function boundMultiple(field: string, v: number): number {
  if (!Number.isFinite(v)) throw new BoundsError(field, v, "not finite");
  if (v <= 0 || v > 100) {
    throw new BoundsError(field, v, `outside 0..100 for a MULTIPLE column (solvency)`);
  }
  return v;
}
