// File: src/ingestions/quaterly-results/picker.ts
//
// DUAL-BASIS picker (replaces the old "pick the preferred basis, discard the
// other" model). We now store BOTH Standalone and Consolidated for every
// stock-period — nothing is discarded for being the non-preferred basis.
// Which basis SCORING reads is a downstream engine concern, not decided here.

import type { NseFilingEntry } from "./xbrl/types.js";
import { prisma } from "../../db/prisma.js";

export type ResultBasis = "standalone" | "consolidated";

export type IngestDecision = "ingest" | "refresh" | "skip";

export interface IngestDecisionResult {
  decision: IngestDecision;
  reason: string;
  existingResultType?: ResultBasis;
  existingFilingDate?: Date;
}

export interface BasisPick {
  filing: NseFilingEntry;
  basis: ResultBasis;
  reason: "only_revision" | "latest_revision";
}

/**
 * From a group of variants that share (qeDate, filingType), pick the best
 * filing for EACH basis present. We no longer choose between Standalone and
 * Consolidated — both are returned (when both exist) so both get stored.
 *
 * Basis mapping mirrors the parser: `consolidated === "Consolidated"` →
 * consolidated; everything else (incl. a null `consolidated`) → standalone.
 *
 * Within a basis, revision preference is Revision > New > Original, with the
 * latest broadcastDate as the tiebreaker.
 *
 * Returns [] if there are no candidates; otherwise 1 entry (single basis filed)
 * or 2 entries (both bases filed).
 */
export function pickFilingsPerBasis(candidates: NseFilingEntry[]): BasisPick[] {
  if (candidates.length === 0) return [];

  const byBasis = new Map<ResultBasis, NseFilingEntry[]>();
  for (const c of candidates) {
    const basis: ResultBasis =
      c.consolidated === "Consolidated" ? "consolidated" : "standalone";
    const arr = byBasis.get(basis);
    if (arr) arr.push(c);
    else byBasis.set(basis, [c]);
  }

  const subRank: Record<NseFilingEntry["typeSub"], number> = {
    Revision: 0,
    New: 1,
    Original: 2,
  };

  const picks: BasisPick[] = [];
  for (const [basis, pool] of byBasis) {
    const sorted = [...pool].sort((a, b) => {
      const aRank = subRank[a.typeSub] ?? 3;
      const bRank = subRank[b.typeSub] ?? 3;
      if (aRank !== bRank) return aRank - bRank;
      return b.filingDateParsed.getTime() - a.filingDateParsed.getTime();
    });
    const winner = sorted[0];
    picks.push({
      filing: winner,
      basis,
      reason: pool.length === 1 ? "only_revision" : "latest_revision",
    });
  }

  return picks;
}

export type PickerTable =
  | "fundamental"
  | "quarterly_result"
  | "banking_fundamental"
  | "banking_quarterly_result"
  | "nbfc_fundamental"
  | "nbfc_quarterly_result"
  | "li_fundamental"
  | "li_quarterly_result"
  | "gi_fundamental"
  | "gi_quarterly_result";

/**
 * Decide whether to (re)ingest a chosen filing FOR ITS OWN BASIS.
 *
 * Dual-basis model: a Standalone filing is only ever compared against the
 * existing Standalone row, and a Consolidated filing against the existing
 * Consolidated row. We never replace one basis with the other (the old
 * "upgrade" decision is gone).
 *
 * "ingest"  → no row exists for (stockId, period, basis). Insert.
 * "refresh" → a row for this basis exists but the new filing is later-dated
 *             (a revision). Replace that basis row.
 * "skip"    → a row for this basis exists at-or-after this filing's date. No-op.
 */
export async function decideIngest(
  stockId: string,
  table: PickerTable,
  period: { quarter?: string; fiscalYear: string },
  filing: NseFilingEntry,
): Promise<IngestDecisionResult> {
  const basis: ResultBasis =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";

  const existing = await fetchExistingRow(stockId, table, period, basis);

  if (!existing) {
    return { decision: "ingest", reason: `no existing ${basis} row for period` };
  }

  if (filing.filingDateParsed.getTime() > existing.filingDate.getTime()) {
    return {
      decision: "refresh",
      reason: `newer filingDate for ${basis} (likely revision)`,
      existingResultType: basis,
      existingFilingDate: existing.filingDate,
    };
  }

  return {
    decision: "skip",
    reason: `${basis} already ingested at same or later filingDate`,
    existingResultType: basis,
    existingFilingDate: existing.filingDate,
  };
}

interface ExistingRowSummary {
  resultType: string;
  filingDate: Date;
}

async function fetchExistingRow(
  stockId: string,
  table: PickerTable,
  period: { quarter?: string; fiscalYear: string },
  resultType: ResultBasis,
): Promise<ExistingRowSummary | null> {
  const select = { resultType: true, filingDate: true } as const;

  switch (table) {
    case "fundamental":
      return prisma.fundamental.findUnique({
        where: {
          stockId_fiscalYear_resultType: {
            stockId,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for quarterly_result");
      return prisma.quarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "banking_fundamental":
      return prisma.bankingFundamental.findUnique({
        where: {
          stockId_fiscalYear_resultType: {
            stockId,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "banking_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for banking_quarterly_result");
      return prisma.bankingQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "nbfc_fundamental":
      return prisma.nbfcFundamental.findUnique({
        where: {
          stockId_fiscalYear_resultType: {
            stockId,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "nbfc_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for nbfc_quarterly_result");
      return prisma.nbfcQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "li_fundamental":
      return prisma.lifeInsuranceFundamental.findUnique({
        where: {
          stockId_fiscalYear_resultType: {
            stockId,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "li_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for li_quarterly_result");
      return prisma.lifeInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "gi_fundamental":
      return prisma.generalInsuranceFundamental.findUnique({
        where: {
          stockId_fiscalYear_resultType: {
            stockId,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    case "gi_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for gi_quarterly_result");
      return prisma.generalInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
            resultType,
          },
        },
        select,
      });
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}
