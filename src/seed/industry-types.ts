// ─────────────────────────────────────────────────────────────
// INDUSTRY TYPES — reusable refresh function
//
// Extracted from src/scripts/refresh-industry-types.ts so it can
// be called by HTTP routes without shelling out to a script.
//
// The script itself is kept intact as a CLI entry point.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import {
  deriveIndustryType,
  type IndustryType,
} from "../scripts/industry-type-utils.js";
import calendarYearStocks from "./calendar-year-stocks.json" with { type: "json" };

export type { IndustryType };

export interface RefreshIndustryTypesResult {
  total: number;
  updated: number;
  unchanged: number;
  dryRun: boolean;
  byIndustry: Record<IndustryType, number>;
  changes: { symbol: string; from: string; to: string }[];
}

/**
 * Recompute Stock.industryType for every stock in the DB.
 *
 * Uses the same derivation logic as the CLI script
 * (src/scripts/refresh-industry-types.ts).
 *
 * @param opts.dryRun — if true, compute and return changes without writing.
 */
export async function refreshIndustryTypes(
  opts: { dryRun?: boolean } = {},
): Promise<RefreshIndustryTypesResult> {
  const dryRun = opts.dryRun ?? false;

  const stocks = await prisma.stock.findMany({
    select: {
      id: true,
      symbol: true,
      industryType: true,
      sector: { select: { name: true } },
    },
  });

  let updated = 0;
  let unchanged = 0;

  const byIndustry: Record<IndustryType, number> = {
    non_financial: 0,
    banking: 0,
    nbfc: 0,
    life_insurance: 0,
    general_insurance: 0,
  };

  const changes: { symbol: string; from: string; to: string }[] = [];

  for (const stock of stocks) {
    const derived = deriveIndustryType(
      stock.symbol,
      stock.sector?.name ?? null,
    );
    byIndustry[derived]++;

    if (stock.industryType === derived) {
      unchanged++;
      continue;
    }

    changes.push({
      symbol: stock.symbol,
      from: stock.industryType,
      to: derived,
    });

    if (!dryRun) {
      await prisma.stock.update({
        where: { id: stock.id },
        data: { industryType: derived },
      });
    }

    updated++;
  }

  return {
    total: stocks.length,
    updated,
    unchanged,
    dryRun,
    byIndustry,
    changes,
  };
}

const calendarYearSet = new Set<string>(
  (calendarYearStocks as string[]).map((s) => s.toUpperCase()),
);

/**
 * Refresh fiscalYearEnd for all stocks based on the calendar-year override list.
 * Stocks in calendar-year-stocks.json get fiscalYearEnd='december';
 * everyone else gets 'march' (the Indian default).
 */
export async function refreshFiscalYearEnds(): Promise<{
  updated: number;
  december: number;
  march: number;
}> {
  const stocks = await prisma.stock.findMany({
    select: { id: true, symbol: true, fiscalYearEnd: true },
  });

  let updated = 0;
  let december = 0;
  let march = 0;

  for (const s of stocks) {
    const desired = calendarYearSet.has(s.symbol.toUpperCase())
      ? "december"
      : "march";
    if (desired === "december") december++;
    else march++;
    if (s.fiscalYearEnd !== desired) {
      await prisma.stock.update({
        where: { id: s.id },
        data: { fiscalYearEnd: desired },
      });
      updated++;
    }
  }
  return { updated, december, march };
}
