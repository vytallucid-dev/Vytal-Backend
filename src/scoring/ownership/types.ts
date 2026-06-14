// File: src/scoring/ownership/types.ts
//
// Shared input shape for the Ownership PRIMARY engine (baseline + pledging +
// disturbances). UNIVERSAL core-engine code — identical for every stock / PG,
// zero per-PG content. PG build chats never touch this.
//
// The engine is PURE: it operates on plain numbers / bigints only. The Decimal→
// number and Prisma-row→OwnershipQuarter mapping happens at the DB boundary (the
// harness / a future production loader) via `toOwnershipQuarter`, NEVER inside the
// scoring functions — so the scoring logic has no Prisma/Decimal dependency.

import type { ShareholdingRow } from "./dilution.js";

/**
 * One quarter of shareholding input for the Ownership engine. A SUPERSET of the
 * dilution detector's {@link ShareholdingRow} (so an OwnershipQuarter can be
 * passed directly to `classifyDilution`), adding the pledge count and the three
 * CLEAN percentage buckets the distribution / FII rules read.
 *
 * Share fields are BigInt COUNTS — ground truth, never rescaled. Percentages are
 * already converted to plain numbers (post the FII/DII fix; see [[shareholding-xbrl-vintages]]).
 */
export interface OwnershipQuarter extends ShareholdingRow {
  asOnDate: Date;
  quarter: string; // "Q1".."Q4"
  fiscalYear: string; // "FY26"

  // ── Counts (ground truth) ──────────────────────────────────────────────
  promoterShares: bigint | null;
  totalShares: bigint | null;
  /** NumberOfSharesEncumberedUnderPledged — PLEDGE-PROPER ONLY. NDU encumbrance
   * is deliberately NOT folded in here (flagged open spec item; see pledging.ts). */
  pledgedShares: bigint | null;

  // ── Clean percentage buckets (NOT the corrupt promoterPledged* fields) ──
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null; // FII+DII drive Flow Category B (institutional)
  retailPct: number | null;
}

/** Quarter label for human-readable reasons, e.g. "FY26 Q3 (2025-12-31)". */
export function quarterLabel(q: OwnershipQuarter): string {
  return `${q.fiscalYear} ${q.quarter} (${q.asOnDate.toISOString().slice(0, 10)})`;
}

/** Period key used as PillarScore.sourcePeriod, e.g. "FY26Q3". */
export function periodKeyOf(q: OwnershipQuarter): string {
  return `${q.fiscalYear}${q.quarter}`;
}
