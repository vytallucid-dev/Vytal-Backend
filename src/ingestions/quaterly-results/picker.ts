// File: src/ingestions/quaterly-results/picker.ts (NEW — replaces v2's pickBestFilingForQuarter)

import type { NseFilingEntry } from "./xbrl/types.js";
import type { IndustryType } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export type IngestDecision = "ingest" | "upgrade" | "refresh" | "skip";

export interface IngestDecisionResult {
  decision: IngestDecision;
  reason: string;
  existingResultType?: "standalone" | "consolidated";
  existingFilingDate?: Date;
}

export interface PickResult {
  filing: NseFilingEntry;
  reason:
    | "only_one_available"
    | "preferred_consolidation"
    | "fallback_consolidation"
    | "latest_revision";
}

/**
 * Decide which filing to ingest from a group of variants for the same period.
 *
 * Inputs: candidates that share (qeDate, filingType).
 * They may differ in `consolidated` ("Standalone" vs "Consolidated") and/or
 * `typeSub` ("Original" vs "Revision" vs "New").
 *
 * Industry preference (Decision #14):
 *   non_financial          → Consolidated preferred
 *   banking, nbfc, li, gi  → Standalone preferred
 *
 * Revision preference: Revision > New > Original (latest broadcastDate as tiebreaker).
 *
 * Returns null if no candidates.
 */
export function pickBestFilingForQuarter(
  candidates: NseFilingEntry[],
  industry: IndustryType,
): PickResult | null {
  if (candidates.length === 0) return null;

  const preferStandalone =
    industry === "banking" ||
    industry === "nbfc" ||
    industry === "life_insurance" ||
    industry === "general_insurance";

  const preferred = preferStandalone ? "Standalone" : "Consolidated";
  const fallback = preferStandalone ? "Consolidated" : "Standalone";

  // 1) Filter to preferred consolidation
  const preferredCandidates = candidates.filter(
    (c) => c.consolidated === preferred,
  );
  const fallbackCandidates = candidates.filter(
    (c) => c.consolidated === fallback,
  );

  let pool: NseFilingEntry[];
  let consolidationReason: PickResult["reason"];

  if (preferredCandidates.length > 0) {
    pool = preferredCandidates;
    consolidationReason = "preferred_consolidation";
  } else if (fallbackCandidates.length > 0) {
    pool = fallbackCandidates;
    consolidationReason = "fallback_consolidation";
  } else {
    // Neither preferred nor fallback explicit — null consolidated. Take all.
    pool = candidates;
    consolidationReason = "only_one_available";
  }

  if (pool.length === 1) {
    return {
      filing: pool[0],
      reason:
        pool.length === 1 && candidates.length === 1
          ? "only_one_available"
          : consolidationReason,
    };
  }

  // 2) Among the preferred consolidation, pick the best revision.
  //    Revision > New > Original; tiebreak by latest broadcastDate.
  const subRank: Record<NseFilingEntry["typeSub"], number> = {
    Revision: 0,
    New: 1,
    Original: 2,
  };

  const sorted = [...pool].sort((a, b) => {
    const aRank = subRank[a.typeSub] ?? 3;
    const bRank = subRank[b.typeSub] ?? 3;
    if (aRank !== bRank) return aRank - bRank;
    return b.filingDateParsed.getTime() - a.filingDateParsed.getTime();
  });

  const winner = sorted[0];
  return {
    filing: winner,
    reason:
      winner.typeSub === "Revision" ? "latest_revision" : consolidationReason,
  };
}

/**
 * Decide whether to (re)ingest a chosen filing.
 *
 * "ingest"   → no row exists for (stockId, period). Insert.
 * "upgrade"  → existing row has consolidation that doesn't match preferred.
 *              For example: existing "consolidated" but stock is now banking
 *              (preferred standalone). Replace.
 * "refresh"  → existing row has same consolidation, but new filing is from a
 *              later filingDate (likely a Revision). Replace.
 * "skip"     → existing row matches consolidation and is at-or-after this
 *              filing's filingDate. No-op.
 */
export async function decideIngest(
  stockId: string,
  table:
    | "fundamental"
    | "quarterly_result"
    | "banking_fundamental"
    | "banking_quarterly_result"
    | "nbfc_fundamental"
    | "nbfc_quarterly_result"
    | "li_fundamental"
    | "li_quarterly_result"
    | "gi_fundamental"
    | "gi_quarterly_result",
  period: { quarter?: string; fiscalYear: string },
  filing: NseFilingEntry,
  industry: IndustryType,
): Promise<IngestDecisionResult> {
  const existing = await fetchExistingRow(stockId, table, period);

  if (!existing) {
    return { decision: "ingest", reason: "no_existing_row" };
  }

  const preferStandalone =
    industry === "banking" ||
    industry === "nbfc" ||
    industry === "life_insurance" ||
    industry === "general_insurance";

  const preferredResultType = preferStandalone ? "standalone" : "consolidated";
  const newResultType =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";

  // Upgrade case: existing is wrong consolidation, new is preferred.
  if (
    existing.resultType !== preferredResultType &&
    newResultType === preferredResultType
  ) {
    return {
      decision: "upgrade",
      reason: `replacing ${existing.resultType} with preferred ${preferredResultType}`,
      existingResultType: existing.resultType as "standalone" | "consolidated",
      existingFilingDate: existing.filingDate,
    };
  }

  // Same consolidation: refresh if new filing is more recent.
  if (existing.resultType === newResultType) {
    if (filing.filingDateParsed.getTime() > existing.filingDate.getTime()) {
      return {
        decision: "refresh",
        reason: "newer filingDate (likely revision)",
        existingResultType: existing.resultType as
          | "standalone"
          | "consolidated",
        existingFilingDate: existing.filingDate,
      };
    }
    return {
      decision: "skip",
      reason: "already ingested at same or later filingDate",
      existingResultType: existing.resultType as "standalone" | "consolidated",
      existingFilingDate: existing.filingDate,
    };
  }

  // Existing is preferred, new is fallback consolidation: keep existing.
  return {
    decision: "skip",
    reason: `existing ${existing.resultType} preferred over new ${newResultType}`,
    existingResultType: existing.resultType as "standalone" | "consolidated",
    existingFilingDate: existing.filingDate,
  };
}

interface ExistingRowSummary {
  resultType: string;
  filingDate: Date;
}

async function fetchExistingRow(
  stockId: string,
  table: string,
  period: { quarter?: string; fiscalYear: string },
): Promise<ExistingRowSummary | null> {
  const select = { resultType: true, filingDate: true } as const;

  switch (table) {
    case "fundamental":
      return prisma.fundamental.findUnique({
        where: {
          stockId_fiscalYear: { stockId, fiscalYear: period.fiscalYear },
        },
        select,
      });
    case "quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for quarterly_result");
      return prisma.quarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
          },
        },
        select,
      });
    case "banking_fundamental":
      return prisma.bankingFundamental.findUnique({
        where: {
          stockId_fiscalYear: { stockId, fiscalYear: period.fiscalYear },
        },
        select,
      });
    case "banking_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for banking_quarterly_result");
      return prisma.bankingQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
          },
        },
        select,
      });
    case "nbfc_fundamental":
      return prisma.nbfcFundamental.findUnique({
        where: {
          stockId_fiscalYear: { stockId, fiscalYear: period.fiscalYear },
        },
        select,
      });
    case "nbfc_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for nbfc_quarterly_result");
      return prisma.nbfcQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
          },
        },
        select,
      });
    case "li_fundamental":
      return prisma.lifeInsuranceFundamental.findUnique({
        where: {
          stockId_fiscalYear: { stockId, fiscalYear: period.fiscalYear },
        },
        select,
      });
    case "li_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for li_quarterly_result");
      return prisma.lifeInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
          },
        },
        select,
      });
    case "gi_fundamental":
      return prisma.generalInsuranceFundamental.findUnique({
        where: {
          stockId_fiscalYear: { stockId, fiscalYear: period.fiscalYear },
        },
        select,
      });
    case "gi_quarterly_result":
      if (!period.quarter)
        throw new Error("quarter required for gi_quarterly_result");
      return prisma.generalInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: period.quarter,
            fiscalYear: period.fiscalYear,
          },
        },
        select,
      });
    default:
      throw new Error(`Unknown table: ${table}`);
  }
}
