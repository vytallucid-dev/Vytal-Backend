// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ONE ROW PER QUARTER — the contract OwnershipQuarter already declares, enforced at the DB boundary.
//
// ── WHY THIS IS NEEDED ───────────────────────────────────────────────────────────────────────────
// `shareholding_patterns` is keyed (stock_id, as_on_date), and MULTIPLE ROWS PER QUARTER ARE
// INTENTIONAL: SEBI requires a disclosure on capital changes, not only at quarter end. MEASURED in
// this database: 12,922 quarter-end rows and 471 intra-quarter rows, across 433 (stock, fy, quarter)
// groups.
//
// The consumers assume the opposite. `OwnershipQuarter` is documented "One quarter of shareholding
// input", and the rules take ADJACENT ARRAY ELEMENTS as consecutive quarters:
//
//     r2-promoter-exit.ts          ownership/primary.ts
//     current = sh[len - 1]        current = rows[snapshotIdx]
//     prior   = sh[len - 2]        prior   = rows[snapshotIdx - 1]
//
// dilution.ts even reasons about the spacing — "if two consecutive ROWS are more than ~4 months
// apart, a quarter is missing" — so it guards against rows being too FAR apart and has no guard for
// them being too CLOSE. An intra-quarter filing is exactly the too-close case, and then `prior` is
// not the previous quarter at all but a point a few weeks earlier in the SAME quarter.
//
// MEASURED IMPACT: 27 stocks currently have their two most recent rows inside one quarter. None
// currently crosses R2's 5pp trigger (largest 2.01pp) so the false-POSITIVE risk is nil today; the
// live harm is the false NEGATIVE — the true quarter-over-quarter move is compared against a point
// three weeks back and damped toward zero. computeBaseline and computePledging read the same series.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
// Keep the LAST row of each (fiscalYear, quarter) — the latest as_on_date is the closest thing to
// the quarter-end position, and for a completed quarter it IS the quarter-end filing. Input must be
// ascending by asOnDate, which both call sites already guarantee via `orderBy: { asOnDate: "asc" }`.
//
// ⚠ The intra-quarter rows are NOT deleted and must not be — they are real filings, and the "latest
//   shareholding" API reads them correctly by ordering on asOnDate. This collapses the SERIES handed
//   to the scoring engine, nothing else.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { OwnershipQuarter } from "./types.js";

/**
 * Collapse a per-filing series to one row per fiscal quarter, keeping the latest filing in each.
 * Order is preserved. A series that already has one row per quarter is returned unchanged.
 */
export function collapseToOneRowPerQuarter<T extends { asOnDate: Date; quarter: string; fiscalYear: string }>(
  rowsAscByAsOnDate: readonly T[],
): T[] {
  const lastOf = new Map<string, T>();
  for (const r of rowsAscByAsOnDate) lastOf.set(`${r.fiscalYear}|${r.quarter}`, r);
  // Map preserves insertion order, and first insertion happens in ascending date order, so the
  // resulting sequence stays chronological.
  return [...lastOf.values()];
}

/** How many rows a collapse would drop. For logging when a caller wants to say what it did. */
export function collapsedCount(rows: readonly OwnershipQuarter[]): number {
  return rows.length - collapseToOneRowPerQuarter(rows).length;
}
