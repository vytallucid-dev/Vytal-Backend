// src/scheduler/pit-jobs.ts
// Orchestrates the daily and backfill jobs.
//
// Daily job:
//   - Runs every weekday evening after market close (~6 PM IST)
//   - Fetches T and T-1 (NSE disclosures can be delayed by 1-2 days)
//   - Idempotent — safe to re-run
//
// Backfill job:
//   - One-time run to populate historical data
//   - Fetches in 7-day chunks with 2s delay between chunks
//   - Recommended initial backfill: last 12 months

import { generateChunkRanges } from "./nse-pit-fetcher.js";
import { fetchAndParseInsiderTrades } from "./pit-source.js";
import {
  ingestInsiderTrades,
  loadStockUniverse,
  wasDateFetchedSuccessfully,
  checkNoDataStreak,
} from "./pit-ingester.js";
import type { FetchJobResult } from "./insider-types.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { nseClient } from "../../lib/client.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { INSIDER_CRON, INSIDER_SOURCE } from "./insider-guards.js";

/**
 * Called after each date chunk is ingested.
 * Return false to abort remaining chunks.
 */
export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

// ── Daily job ─────────────────────────────────────────────────────────────────
// Fetches today and yesterday. NSE disclosures can be T or T+1.
// Run this at 6:30 PM IST every weekday.
export async function runDailyJob(): Promise<void> {
  console.log("[PitDaily] Starting daily insider trades job...");

  const stockMap = await loadStockUniverse();

  // Fetch today and yesterday — covers T and T-1 disclosures
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const datesToFetch = [today, yesterday];

  for (const date of datesToFetch) {
    // Skip weekends
    const day = date.getDay();
    if (day === 0 || day === 6) {
      console.log(`[PitDaily] Skipping weekend: ${date.toDateString()}`);
      continue;
    }

    // Skip if already fetched successfully today
    const alreadyDone = await wasDateFetchedSuccessfully(date, "daily");
    if (alreadyDone) {
      console.log(
        `[PitDaily] Already fetched for ${date.toDateString()}, skipping`,
      );
      continue;
    }

    try {
      const parseResult = await fetchAndParseInsiderTrades(date, date, stockMap);
      const result = await ingestInsiderTrades(parseResult, date, "daily");
      logResult(result);
    } catch (err: any) {
      console.error(
        `[PitDaily] Job failed for ${date.toDateString()}:`,
        err.message,
      );

      // Write failure to log so we can monitor it
      await prisma.insiderTradeFetchLog.upsert({
        where: { fetchDate_fetchType: { fetchDate: date, fetchType: "daily" } },
        update: { status: "failed", error: err.message },
        create: {
          fetchDate: date,
          fetchType: "daily",
          status: "failed",
          error: err.message,
          totalFetched: 0,
          totalInserted: 0,
          totalSkipped: 0,
          totalFiltered: 0,
        },
      });
    }
  }

  console.log("[PitDaily] Daily job complete.");

  // Surface a multi-day market-wide blackout as a failed job so it doesn't go
  // unnoticed (as the previous endpoint freeze did for ~6 weeks).
  const alert = await checkNoDataStreak();
  if (alert.detected) {
    // GUARD 2 (STREAK): the trailing-window-zero IS the feed-down signal
    // (single-day volume is bursty — p10=1 — so a single no_data is a normal
    // quiet day). Route it into the unified error table, then surface the run
    // as failed via the existing throw.
    await reportIngestionError({
      source: INSIDER_SOURCE,
      cron: INSIDER_CRON,
      guardType: "count",
      targetTable: "InsiderTrade",
      severity: "high",
      resolutionPath: "source_code",
      expected: "≥1 of the last 3 daily runs returns data",
      observed: `${alert.dates.length} consecutive no_data daily runs (${alert.dates.join(", ")})`,
      detail: "Insider-trade feed blackout — NSE corporates-pit-gg may have changed again (the failure that previously went unnoticed for ~6 weeks).",
      runRef: `${alert.dates[0] ?? "unknown"}:daily`,
    });
    throw new Error(
      `Insider-trade feed blackout: ${alert.dates.length} consecutive daily runs returned ` +
        `no data (${alert.dates.join(", ")}). NSE corporates-pit-gg may have changed again — investigate.`,
    );
  }
}

// ── Backfill job ──────────────────────────────────────────────────────────────
// Processes historical data one chunk at a time:
//   1. Fetch chunk from NSE
//   2. Parse records
//   3. Insert into DB
//   4. Log progress
// NSE session is restarted every 3 chunks to avoid stale-cookie failures.
export async function runBackfillJob(): Promise<FetchJobResult[]> {
  const monthsBack = parseInt(process.argv[2] ?? "12", 10);

  const toDate = new Date();
  toDate.setHours(0, 0, 0, 0);

  const fromDate = new Date(toDate);
  fromDate.setMonth(fromDate.getMonth() - monthsBack);

  console.log(
    `[PitBackfill] Starting backfill: ${fromDate.toDateString()} → ${toDate.toDateString()}`,
  );

  const stockMap = await loadStockUniverse();
  const results: FetchJobResult[] = [];

  const chunkRanges = generateChunkRanges(fromDate, toDate);
  console.log(`[PitBackfill] Total chunks: ${chunkRanges.length}`);

  for (let idx = 0; idx < chunkRanges.length; idx++) {
    // Restart NSE session every 3 chunks to keep cookies fresh
    if (idx > 0 && idx % 3 === 0) {
      console.log(`[PitBackfill] Restarting NSE session after chunk ${idx}`);
      nseClient.resetSession();
      await nseClient.initSession();
    }

    const { chunkStart, chunkEnd } = chunkRanges[idx];

    try {
      // 1. Fetch index + XBRL → 2. parse → normalised records
      const parseResult = await fetchAndParseInsiderTrades(chunkStart, chunkEnd, stockMap);

      // 3. Insert + log
      const result = await ingestInsiderTrades(parseResult, chunkStart, "backfill");
      logResult(result);
      results.push(result);
    } catch (err: any) {
      console.error(
        `[PitBackfill] Error on chunk ${chunkStart.toDateString()}: ${err.message}`,
      );
      const failedResult: FetchJobResult = {
        fetchDate: chunkStart,
        fetchType: "backfill",
        status: "failed",
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: 0,
        totalFiltered: 0,
        error: err.message,
        durationMs: 0,
      };
      results.push(failedResult);
    }

    // Polite delay between chunks (NseClient already adds requestDelay per call)
    if (idx + 1 < chunkRanges.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const totalInserted = results.reduce((s, r) => s + r.totalInserted, 0);
  const totalFetched = results.reduce((s, r) => s + r.totalFetched, 0);

  console.log(
    `[PitBackfill] Complete. Fetched: ${totalFetched}, Inserted: ${totalInserted}`,
  );

  return results;
}

// ── One-time manual fetch ─────────────────────────────────────────────────────
// Useful for fetching a specific date range on demand
// (e.g., after a pipeline outage).
// Processes one chunk at a time: fetch → parse → insert → progress callback.
// NSE session is restarted every 3 chunks.
export async function runManualFetch(
  fromDate: Date,
  toDate: Date,
  onChunkComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<FetchJobResult[]> {
  console.log(
    `[PitManual] Manual fetch: ${fromDate.toDateString()} → ${toDate.toDateString()}`,
  );

  const stockMap = await loadStockUniverse();
  const chunkRanges = generateChunkRanges(fromDate, toDate);
  const results: FetchJobResult[] = [];

  console.log(`[PitManual] Total chunks: ${chunkRanges.length}`);

  for (let idx = 0; idx < chunkRanges.length; idx++) {
    if (signal?.aborted) break;

    // Restart NSE session every 3 chunks to keep cookies fresh
    if (idx > 0 && idx % 3 === 0) {
      console.log(`[PitManual] Restarting NSE session after chunk ${idx}`);
      nseClient.resetSession();
      await nseClient.initSession();
    }

    const { chunkStart, chunkEnd } = chunkRanges[idx];

    try {
      // 1. Fetch index + XBRL → 2. parse → normalised records
      const parseResult = await fetchAndParseInsiderTrades(chunkStart, chunkEnd, stockMap, signal);

      // 3. Insert + log
      const result = await ingestInsiderTrades(parseResult, chunkStart, "manual");
      logResult(result);
      results.push(result);

      // 4. Update progress
      if (onChunkComplete) {
        const shouldContinue = await onChunkComplete(
          idx + 1,
          chunkRanges.length,
          `chunk ${idx + 1}/${chunkRanges.length} — ${chunkStart.toDateString()}`,
        );
        if (!shouldContinue) break;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      console.error(
        `[PitManual] Error on chunk ${chunkStart.toDateString()}: ${err.message}`,
      );
      const failedResult: FetchJobResult = {
        fetchDate: chunkStart,
        fetchType: "manual",
        status: "failed",
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: 0,
        totalFiltered: 0,
        error: err.message,
        durationMs: 0,
      };
      results.push(failedResult);
    }

    // Polite delay between chunks
    if (idx + 1 < chunkRanges.length && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return results;
}

// ── Logging helper ────────────────────────────────────────────────────────────
function logResult(result: FetchJobResult): void {
  const date = result.fetchDate.toDateString();
  console.log(
    `[PitJob] ${date} | status=${result.status} | ` +
      `fetched=${result.totalFetched} | inserted=${result.totalInserted} | ` +
      `filtered=${result.totalFiltered} | skipped=${result.totalSkipped} | ` +
      `${result.durationMs}ms`,
  );
}
