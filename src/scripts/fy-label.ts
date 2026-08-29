// ═══════════════════════════════════════════════════════════════════════════════
// THE FISCAL-YEAR LABEL, in one place.
//
// ⚠ THE CANONICAL FORM IS TWO DIGITS. fiscal.ts states it outright:
//       /** "FY25" — 2-digit year of the fiscal year END */
//       `FY${String(fyEnd.getUTCFullYear()).slice(-2)}`
//   and every production lane writes that: 21,404 rows in quarterly_results,
//   13,393 in shareholding_patterns, all "FY18"-shaped.
//
// ⚠ WHY A SHARED HELPER RATHER THAN A LOCAL ONE-LINER. Six backfill scripts each
//   grew their own `FY${y}` and one of them reached the database: 28 insurance
//   rows were written "FY2019" where the rest of the corpus says "FY19".
//   Two consequences, and the second is the sharp one:
//
//   1. DUPLICATE QUARTERS. Every result table has a unique index on its natural
//      key — (stock_id, quarter, fiscal_year, result_type) — but fiscal_year is
//      PART of that key, so "FY19" and "FY2019" are different keys. The index
//      does not prevent the same quarter existing twice under two spellings.
//
//   2. IT BREAKS decrementFY, WHICH THROWS. ingester-utils.ts:
//          const m = fy.match(/^FY(\d{2})$/);
//          if (!m) throw new Error(`Invalid FY format: ${fy}`);
//      re-derive.ts calls it to find the year-ago quarter. Any re-derive that
//      touched one of those 28 rows would have thrown on contact — a live crash,
//      not a cosmetic inconsistency.
//
//   A label is not cosmetic when it is part of a key AND parsed by a regex.
// ═══════════════════════════════════════════════════════════════════════════════

/** Indian FY from a period end. Q4 is the only quarter whose calendar year matches the FY. */
export function fyq(periodEnd: string): { fy: string; q: "Q1" | "Q2" | "Q3" | "Q4"; fyYear: number } {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  const fyYear = m <= 3 ? y : y + 1;
  const q = m === 3 ? "Q4" : m === 6 ? "Q1" : m === 9 ? "Q2" : "Q3";
  return { fy: fyLabel(fyYear), q, fyYear };
}

/** 2026 -> "FY26". The ONLY place a fiscal-year label is formatted. */
export function fyLabel(fyEndYear: number): string {
  return `FY${String(fyEndYear).slice(-2)}`;
}
