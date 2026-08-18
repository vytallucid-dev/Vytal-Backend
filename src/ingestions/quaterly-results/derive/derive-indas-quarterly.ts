// ─────────────────────────────────────────────────────────────
// PURE derivation for QuarterlyResult (Ind-AS quarterly) — deriveFromRow bridge.
//
// VERBATIM EXTRACTION of the inline block in ingest-indas-quarterly.ts (CN-8:
// no math change). The ingester now CALLS this, so ingestion ≡ fill.
//
// 6 derived columns, all Decimal(8,4) via decimalPct, EACH BOUNDED by
// boundDerived (S4.2). ⚠ This comment previously read "no boundDerived here —
// matching the existing ingester exactly". That was true and is now FALSE: the
// unbounded form failed whole upserts on thin-revenue quarters (Stage 3b: 9
// filings lost, ADANIENSOL operatingMargin 301,900% vs a 10,000 ceiling). The
// bound stores NULL for an unrepresentable display ratio; it never clamps and
// never fails the write:
//   • NON-prior (byte-identical-gated): operatingMargin, netMargin.
//   • PRIOR-dependent (gate-exempt, determinism-checked): revenueQoq/profitQoq
//     (prior quarter) and revenueYoy/profitYoy (year-ago quarter). These read
//     other stored rows, so they reflect DB-state-at-ingest (the Stage-1a
//     order-dependence finding), and a fresh re-derive corrects stale values.
//
// I/O stays in the ingester (the prior-quarter + year-ago fetches); this module
// is pure and takes those prior rows as plain-number params.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import { decimalPct, pctChange } from "../ingester-utils.js";
import { boundDerived } from "./derive-indas-annual.js";

export interface IndAsQuarterlyRaw {
  revenue: number | null;
  netProfit: number | null;
  operatingProfit: number | null;
}

// Prior-period inputs (prior quarter for QoQ; year-ago quarter for YoY).
export interface IndAsQuarterlyPriorPeriod {
  revenue: number | null;
  netProfit: number | null;
}

export interface IndAsQuarterlyDerivedColumns {
  operatingMargin: Prisma.Decimal | null;
  netMargin: Prisma.Decimal | null;
  revenueQoq: Prisma.Decimal | null;
  revenueYoy: Prisma.Decimal | null;
  profitQoq: Prisma.Decimal | null;
  profitYoy: Prisma.Decimal | null;
}

export interface IndAsQuarterlyDerived {
  columns: IndAsQuarterlyDerivedColumns;
  numbers: { revenueYoy: number | null };
}

/**
 * Reproduce the 6 derived QuarterlyResult columns from raw inputs + the prior
 * quarter + the year-ago quarter. Byte-identical to the former inline block.
 */
export function deriveIndAsQuarterly(
  raw: IndAsQuarterlyRaw,
  priorQuarter: IndAsQuarterlyPriorPeriod | null,
  yearAgoQuarter: IndAsQuarterlyPriorPeriod | null,
): IndAsQuarterlyDerived {
  const operatingMargin =
    raw.operatingProfit !== null && raw.revenue !== null && raw.revenue !== 0
      ? (raw.operatingProfit / raw.revenue) * 100
      : null;
  const netMargin =
    raw.netProfit !== null && raw.revenue !== null && raw.revenue !== 0
      ? (raw.netProfit / raw.revenue) * 100
      : null;

  const revenueQoq = pctChange(raw.revenue, priorQuarter?.revenue ?? null);
  const revenueYoy = pctChange(raw.revenue, yearAgoQuarter?.revenue ?? null);
  const profitQoq = pctChange(raw.netProfit, priorQuarter?.netProfit ?? null);
  const profitYoy = pctChange(raw.netProfit, yearAgoQuarter?.netProfit ?? null);

  // ⚠ ALL SIX ARE Decimal(8,4) — |value| must be < 10000. The guard on each
  //   division is `denominator !== 0`, which a NEAR-zero denominator passes, so a
  //   thin-revenue quarter produces a percentage far outside the column and the
  //   upsert FAILS — taking the whole row, including revenue / netProfit /
  //   profitBeforeTax / depreciation / interest, with it. Measured in Stage 3b:
  //   9 filings absent, 4 inside the Jan-2022 window, ADANIENSOL operatingMargin
  //   at 301,900% against a 10,000 ceiling.
  //   boundDerived stores NULL rather than failing. It does NOT clamp: 301,900%
  //   is meaningless at any precision, and a clamped 9,999.99 would be a fabricated
  //   number. These six are COSMETIC for quarterly_results in the score-input
  //   manifest — no scoring path reads them — so nulling one costs nothing, while
  //   failing the write costs every score-relevant column on the row.
  const tag = "indas-quarterly";
  return {
    columns: {
      operatingMargin: boundDerived(decimalPct(operatingMargin), 4, "operatingMargin", tag),
      netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
      revenueQoq: boundDerived(decimalPct(revenueQoq), 4, "revenueQoq", tag),
      revenueYoy: boundDerived(decimalPct(revenueYoy), 4, "revenueYoy", tag),
      profitQoq: boundDerived(decimalPct(profitQoq), 4, "profitQoq", tag),
      profitYoy: boundDerived(decimalPct(profitYoy), 4, "profitYoy", tag),
    },
    numbers: { revenueYoy },
  };
}
