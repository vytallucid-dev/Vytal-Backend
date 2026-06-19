// Idempotent ingestion of parsed insider trade records into PostgreSQL.
//
// Design principles (same as block_deals pipeline):
// - Upsert on the unique key — safe to re-run for same date
// - Never update past records — insider trades are immutable disclosures
// - Batch inserts for efficiency (30 records per batch)
// - Full audit trail via InsiderTradeFetchLog
// - Universe-first: load symbol→stockId map once, reuse across all records

import { prisma } from "../../db/prisma.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { InsiderTradeNormalized, FetchJobResult } from "./insider-types.js";
import type { ParseResult } from "./pit-parser.js";

const BATCH_SIZE = 30;

// ── Load symbol → stockId map from DB ────────────────────────────────────────
// Call this once per job run, not per record.
export async function loadStockUniverse(): Promise<Map<string, string>> {
  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true },
  });

  const map = new Map<string, string>();
  stocks.forEach((s) => map.set(s.symbol.toUpperCase(), s.id));

  console.log(`[PitIngester] Universe loaded: ${map.size} stocks`);
  return map;
}

// ── Insert a batch of parsed records ─────────────────────────────────────────
// Returns count of actually inserted records (skips duplicates).
async function insertBatch(records: InsiderTradeNormalized[]): Promise<number> {
  if (records.length === 0) return 0;

  let inserted = 0;

  for (const record of records) {
    try {
      await prisma.insiderTrade.upsert({
        where: {
          insider_trade_unique: {
            stockId: record.stockId,
            personName: record.personName,
            transactionType: record.transactionType,
            tradeDate: record.tradeDate ?? record.intimationDate,
            securitiesTraded: record.securitiesTraded
              ? Number(record.securitiesTraded)
              : 0,
          },
        },
        // If record already exists — do nothing (don't overwrite)
        update: {},
        // If record is new — insert it
        create: {
          stockId: record.stockId,
          symbol: record.symbol,
          regulation: record.regulation,
          intimationDate: record.intimationDate,
          personName: record.personName,
          personCategory: record.personCategory,
          transactionType: record.transactionType,
          securityType: record.securityType,
          tradeDate: record.tradeDate,
          securitiesPre: record.securitiesPre
            ? Number(record.securitiesPre)
            : null,
          securitiesTraded: record.securitiesTraded
            ? Number(record.securitiesTraded)
            : null,
          securitiesPost: record.securitiesPost
            ? Number(record.securitiesPost)
            : null,
          holdingPctPre: record.holdingPctPre,
          holdingPctPost: record.holdingPctPost,
          holdingPctDelta: record.holdingPctDelta,
          tradePrice: record.tradePrice,
          tradeValueCr: record.tradeValueCr,
          acquisitionMode: record.acquisitionMode,
          remarks: record.remarks,
          exchangeRef: record.exchangeRef,
          source: "nse_pit",
        },
      });
      inserted++;
    } catch (err: any) {
      // Log but don't throw — one bad record shouldn't stop the batch
      console.error(
        `[PitIngester] Failed to upsert record for ${record.symbol} / ${record.personName}: ${err.message}`,
      );
    }
  }

  return inserted;
}

// ── Main ingestion function ───────────────────────────────────────────────────
export async function ingestInsiderTrades(
  parseResult: ParseResult,
  fetchDate: Date,
  fetchType: "daily" | "backfill" | "manual",
): Promise<FetchJobResult> {
  const startTime = Date.now();
  let totalInserted = 0;
  let totalSkipped = parseResult.skippedCount;

  const { records, filteredCount } = parseResult;

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const inserted = await insertBatch(batch);
    totalInserted += inserted;
    totalSkipped += batch.length - inserted; // records that were already in DB
  }

  const durationMs = Date.now() - startTime;
  const status =
    parseResult.totalRaw === 0
      ? "no_data"
      : totalInserted > 0
        ? "success"
        : records.length > 0
          ? "partial" // records existed but all were already in DB (re-run)
          : "success"; // all filtered out — normal on slow disclosure days

  const result: FetchJobResult = {
    fetchDate,
    fetchType,
    status,
    totalFetched: parseResult.totalRaw,
    totalInserted,
    totalSkipped,
    totalFiltered: filteredCount,
    durationMs,
  };

  // Write to fetch log
  await writeFetchLog(result);

  return result;
}

// ── Write fetch log ───────────────────────────────────────────────────────────
async function writeFetchLog(result: FetchJobResult): Promise<void> {
  try {
    await prisma.insiderTradeFetchLog.upsert({
      where: {
        fetchDate_fetchType: {
          fetchDate: result.fetchDate,
          fetchType: result.fetchType,
        },
      },
      update: {
        // If job is re-run for same date — update the log
        status: result.status,
        totalFetched: result.totalFetched,
        totalInserted: result.totalInserted,
        totalSkipped: result.totalSkipped,
        totalFiltered: result.totalFiltered,
        error: result.error ?? null,
        durationMs: result.durationMs,
      },
      create: {
        fetchDate: result.fetchDate,
        fetchType: result.fetchType,
        status: result.status,
        totalFetched: result.totalFetched,
        totalInserted: result.totalInserted,
        totalSkipped: result.totalSkipped,
        totalFiltered: result.totalFiltered,
        error: result.error ?? null,
        durationMs: result.durationMs,
      },
    });
  } catch (err: any) {
    // Logging failure should never crash the pipeline
    console.error("[PitIngester] Failed to write fetch log:", err.message);
  }
}

// ── Check if date was already fetched successfully ────────────────────────────
// Used by the daily job to skip already-processed dates.
//
// Only a "success" log counts as done. "no_data" is deliberately NOT treated as
// done: under PIT V2.0 it means the gg endpoint returned zero filings market-
// wide, which is abnormal on a trading day — so the day is re-attempted on the
// next run (self-healing). This is what lets the daily job recover days that
// were wrongly logged "no_data" while the old endpoint was frozen.
export async function wasDateFetchedSuccessfully(
  date: Date,
  fetchType: "daily" | "backfill" | "manual",
): Promise<boolean> {
  const log = await prisma.insiderTradeFetchLog.findUnique({
    where: {
      fetchDate_fetchType: { fetchDate: date, fetchType },
    },
    select: { status: true },
  });

  return log?.status === "success";
}

// ── Alert: detect a multi-day market-wide blackout ────────────────────────────
// "no_data" means the gg endpoint returned ZERO filings for a trading day —
// abnormal, since the whole market files something every session. N consecutive
// such daily runs signals the upstream feed broke again (e.g. another NSE
// endpoint migration), the exact failure that previously went unnoticed for
// weeks. The daily job throws on this so the run surfaces as a FAILED job.
export interface NoDataStreak {
  detected: boolean;
  noDataCount: number;
  dates: string[];
}

export async function checkNoDataStreak(threshold = 3): Promise<NoDataStreak> {
  const recent = await prisma.insiderTradeFetchLog.findMany({
    where: { fetchType: "daily" },
    orderBy: { fetchDate: "desc" },
    take: threshold,
    select: { fetchDate: true, status: true },
  });

  const dates = recent.map((r) => r.fetchDate.toISOString().slice(0, 10));
  const noDataCount = recent.filter((r) => r.status === "no_data").length;
  const detected = recent.length >= threshold && recent.every((r) => r.status === "no_data");

  if (detected) {
    console.error(
      `[PitDaily][ALERT] Insider-trade feed returned NO DATA for ${threshold} consecutive ` +
        `trading days (${dates.join(", ")}). Either the NSE corporates-pit-gg endpoint changed ` +
        `again, or the market was closed for this stretch. Investigate the PIT pipeline.`,
    );
  }

  return { detected, noDataCount, dates };
}
