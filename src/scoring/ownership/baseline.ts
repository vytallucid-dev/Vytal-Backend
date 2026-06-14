// File: src/scoring/ownership/baseline.ts
//
// OWNERSHIP PRIMARY — step 1: the data-history BASELINE.
//
//   • 60  when FEWER than 8 consecutive trailing quarters of ShareholdingPattern
//         data exist at the snapshot. 60 = "we don't know yet" — a DATA-ABSENT
//         neutral, never a healthy score earned from absence.
//   • 75  once 8+ consecutive trailing quarters exist.
//
// THRESHOLD = 8 QUARTERS (§11.10-fix). The §11.5 "3 quarters" line is SUPERSEDED
// and is NOT used here. "Consecutive" = no gap in the quarterly filing series up
// to the snapshot; a gap is detected with the SAME calendar-cadence heuristic the
// dilution detector uses (isPriorQuarterGap), so history-counting and dilution
// agree on what "the immediately preceding quarter" means.

import { isPriorQuarterGap } from "./dilution.js";
import type { OwnershipQuarter } from "./types.js";

/** Mirrors the schema enum `OwnershipBaselineReason`. */
export type OwnershipBaselineReason =
  | "insufficient_history_60"
  | "established_75";

export const BASELINE_QUARTERS_THRESHOLD = 8; // §11.10-fix (supersedes §11.5 "3")
export const BASELINE_INSUFFICIENT = 60;
export const BASELINE_ESTABLISHED = 75;

export interface BaselineResult {
  baseline: number; // 60 | 75
  reason: OwnershipBaselineReason;
  /** Length of the unbroken trailing run of quarterly filings ending AT the
   * snapshot (includes the snapshot quarter itself). */
  consecutiveTrailingQuarters: number;
  reasonText: string;
}

/**
 * Count the unbroken trailing run of quarterly filings ending at `snapshotIdx`
 * (an index into `rows`, which MUST be sorted by asOnDate ASC). The run breaks at
 * the first calendar gap (>~4 months between consecutive rows → a quarter is
 * missing). The snapshot quarter itself counts as 1.
 */
export function countConsecutiveTrailingQuarters(
  rows: OwnershipQuarter[],
  snapshotIdx: number,
): number {
  if (rows.length === 0 || snapshotIdx < 0) return 0;
  let count = 1; // the snapshot quarter itself
  for (let i = snapshotIdx; i >= 1; i--) {
    if (isPriorQuarterGap(rows[i].asOnDate, rows[i - 1].asOnDate)) break;
    count++;
  }
  return count;
}

/**
 * Compute the Ownership baseline at the snapshot. PURE.
 *
 * @param rows        full quarterly series, sorted asOnDate ASC
 * @param snapshotIdx the quarter being scored (default = latest)
 */
export function computeBaseline(
  rows: OwnershipQuarter[],
  snapshotIdx: number = rows.length - 1,
): BaselineResult {
  const n = countConsecutiveTrailingQuarters(rows, snapshotIdx);
  const established = n >= BASELINE_QUARTERS_THRESHOLD;
  return {
    baseline: established ? BASELINE_ESTABLISHED : BASELINE_INSUFFICIENT,
    reason: established ? "established_75" : "insufficient_history_60",
    consecutiveTrailingQuarters: n,
    reasonText: established
      ? `established_75: ${n} consecutive trailing quarters present (≥ ${BASELINE_QUARTERS_THRESHOLD})`
      : `insufficient_history_60: only ${n} consecutive trailing quarter(s) present ` +
        `(< ${BASELINE_QUARTERS_THRESHOLD}) — data-absent neutral, NOT a healthy score from absence`,
  };
}
