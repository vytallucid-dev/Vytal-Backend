// ─────────────────────────────────────────────────────────────
// PURE derivation for QuarterlyResult (Ind-AS quarterly) — deriveFromRow bridge.
//
// VERBATIM EXTRACTION of the inline block in ingest-indas-quarterly.ts (CN-8:
// no math change). The ingester now CALLS this, so ingestion ≡ fill.
//
// 6 derived columns, all Decimal(8,4) via decimalPct (no boundDerived here —
// matching the existing ingester exactly):
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

  return {
    columns: {
      operatingMargin: decimalPct(operatingMargin),
      netMargin: decimalPct(netMargin),
      revenueQoq: decimalPct(revenueQoq),
      revenueYoy: decimalPct(revenueYoy),
      profitQoq: decimalPct(profitQoq),
      profitYoy: decimalPct(profitYoy),
    },
    numbers: { revenueYoy },
  };
}
