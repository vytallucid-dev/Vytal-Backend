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

// ─────────────────────────────────────────────────────────────
// INDUSTRY TAXONOMY VALIDATION — compares Stock.industryType against the
// taxonomy namespace a stock's OWN filed XBRL declares, using
// ResultFetchLog as ground truth.
//
// WHY result_fetch_logs AND NOT A LIVE RE-FETCH: scan.ts's processGroup
// already detects the taxonomy from the real filed XBRL on every scan
// (detectTaxonomy → industryForTaxonomy) and, whenever that disagrees with
// the stock's CURRENT industryType at fetch time, writes a
// `status: "skipped", error: "Industry mismatch (basis): stock=X, xbrl=Y"`
// row (see scan.ts's processGroup). That row is free, already-collected
// ground truth for every stock that has ever been scanned — reusing it
// costs one query instead of a live NSE re-fetch per stock.
//
// THE COMPARISON IS AGAINST CURRENT industryType, NOT THE `stock=X` VALUE
// EMBEDDED IN THE LOG ROW. The embedded value is what industryType WAS at
// fetch time; if a correction has since landed (SYMBOL_OVERRIDES edited +
// refreshIndustryTypes run), the embedded value is stale and comparing
// against it would flag an already-fixed stock as still broken. Only the
// most recent mismatch row per stock is used, so a taxonomy that changed
// again after a fix is caught too.
//
// SCOPE / BLIND SPOT: this can only see stocks that have been scanned at
// least once AND hit a mismatch. A stock that has never been scanned, or
// whose sole scan succeeded because industryType happened to be right,
// produces no signal either way — it is not "confirmed correct", just
// unobserved. That is an accepted gap: it mirrors exactly the evidence
// that diagnosed the original 13 (and the 14th, HDFCAMC — see
// industry-type-utils.ts), so it costs nothing new to check and it is the
// only ground truth this system currently records.
// ─────────────────────────────────────────────────────────────

const MISMATCH_RE =
  /^Industry mismatch \(([^)]+)\): stock=(\w+), xbrl=(\w+)$/;

export interface IndustryTaxonomyDisagreement {
  symbol: string;
  stockId: string;
  /** Stock.industryType RIGHT NOW (not the value recorded in the log row). */
  currentIndustryType: IndustryType;
  /** The industry implied by the most recently filed XBRL's own taxonomy namespace. */
  filedTaxonomy: IndustryType;
  basis: string; // "standalone" | "consolidated"
  fiscalYear: string | null;
  quarter: string | null;
  fetchedAt: Date;
}

/**
 * Compare every stock's CURRENT industryType against the taxonomy namespace
 * its own most-recently-scanned filing declared, using the "Industry
 * mismatch" trail in result_fetch_logs. Read-only — never writes.
 *
 * Returns one entry per stock still in disagreement, sorted by symbol.
 */
export async function findIndustryTaxonomyDisagreements(): Promise<
  IndustryTaxonomyDisagreement[]
> {
  // Rows are logged only on mismatch, so this table is the disagreement
  // trail — not a full audit log of every fetch.
  const rows = await prisma.resultFetchLog.findMany({
    where: { error: { contains: "Industry mismatch" } },
    select: {
      stockId: true,
      error: true,
      fetchedAt: true,
      fiscalYear: true,
      quarter: true,
    },
    orderBy: { fetchedAt: "desc" },
  });

  // Most-recent mismatch per stock (rows are already fetchedAt-desc, so the
  // first one seen per stockId wins).
  const latestByStock = new Map<
    string,
    { basis: string; xbrlIndustry: string; fetchedAt: Date; fiscalYear: string | null; quarter: string | null }
  >();
  for (const row of rows) {
    if (latestByStock.has(row.stockId)) continue;
    const m = MISMATCH_RE.exec(row.error ?? "");
    if (!m) continue; // unrecognised error shape — skip rather than misparse
    latestByStock.set(row.stockId, {
      basis: m[1],
      xbrlIndustry: m[3],
      fetchedAt: row.fetchedAt,
      fiscalYear: row.fiscalYear,
      quarter: row.quarter,
    });
  }
  if (latestByStock.size === 0) return [];

  const stocks = await prisma.stock.findMany({
    where: { id: { in: [...latestByStock.keys()] } },
    select: { id: true, symbol: true, industryType: true },
  });

  // ⚠ `xbrlIndustry` is REGEX-CAPTURED from a log string — the one value in this family that is
  // not compile-time enum-typed. scan.ts writes it from industryForTaxonomy() so it is lowercase
  // by construction today, but a free-text round-trip compared case-sensitively against an enum is
  // exactly the shape that silently reclassifies every stock if the writer's casing ever drifts.
  // Normalise both sides; the comparison is then casing-proof without hardcoding any literal.
  const sameIndustry = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const disagreements: IndustryTaxonomyDisagreement[] = [];
  for (const stock of stocks) {
    const latest = latestByStock.get(stock.id)!;
    if (sameIndustry(stock.industryType, latest.xbrlIndustry)) continue; // already agrees
    disagreements.push({
      symbol: stock.symbol,
      stockId: stock.id,
      currentIndustryType: stock.industryType,
      filedTaxonomy: latest.xbrlIndustry.toLowerCase() as IndustryType,
      basis: latest.basis,
      fiscalYear: latest.fiscalYear,
      quarter: latest.quarter,
      fetchedAt: latest.fetchedAt,
    });
  }
  return disagreements.sort((a, b) => a.symbol.localeCompare(b.symbol));
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
