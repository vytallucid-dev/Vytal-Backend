// ─────────────────────────────────────────────────────────────
// EOD INDEX ingestion pipeline.  (DISPLAY-ONLY — NOT scored.)
//
// Sibling of the equity ingest-prices.ts, deliberately simpler:
//   1. Fetch the ind_close_all archive via the NSE provider
//   2. Parse → IndexEodValue[] (no universe filter — store all)
//   3. Upsert index_prices rows on (indexName, date)
//   4. Log the run in index_fetch_logs
//
// There is NO snapshot table, NO returns computation, and — by
// design — this NEVER enters the scoring / PG-rescore trigger
// layer (its job types are not switch arms in scoring-triggers.ts).
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { IndexEodValue } from "./providers/provider.js";
import { fetchIndexBhavcopy } from "./providers/nse-index-bhavcopy.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  INDEX_CRON,
  INDEX_SOURCE,
  COUNT_FLOOR,
  CHANGEPCT_NULL_MAX,
  OHL_NULL_MAX,
  VALUATION_NULL_MAX,
  classifyCount,
  checkNullRate,
  indexRunRef,
} from "./indices-guards.js";

const SOURCE = "nse-index-csv";

// ── Types ─────────────────────────────────────────────────────

export interface IngestIndicesResult {
  success: boolean;
  indexDate: Date;
  source: string;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
  error?: string;
}

// ── Upsert ─────────────────────────────────────────────────────
// Idempotent on (indexName, date). Re-runs/backfills overwrite in
// place — never duplicate. Batched to avoid DB overload.

async function upsertIndexValues(values: IndexEodValue[]): Promise<number> {
  const BATCH = 20;
  let written = 0;

  const dec = (v: number | null) =>
    v != null ? new Prisma.Decimal(v) : null;

  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (v) => {
        const data = {
          open: dec(v.open),
          high: dec(v.high),
          low: dec(v.low),
          close: new Prisma.Decimal(v.close),
          pointsChange: dec(v.pointsChange),
          changePct: dec(v.changePct),
          volume: v.volume,
          turnover: dec(v.turnover),
          pe: dec(v.pe),
          pb: dec(v.pb),
          divYield: dec(v.divYield),
          provider: SOURCE,
        };

        await prisma.indexPrice.upsert({
          where: { indexName_date: { indexName: v.indexName, date: v.date } },
          create: { indexName: v.indexName, date: v.date, ...data },
          update: data,
        });
        written++;
      }),
    );
  }

  return written;
}

// ── Daily EOD job ──────────────────────────────────────────────

export async function runIndexIngest(
  targetDate?: Date,
): Promise<IngestIndicesResult> {
  const start = Date.now();
  const indexDate = targetDate ?? new Date();
  indexDate.setUTCHours(0, 0, 0, 0);

  // Guard: already ran successfully for this date?
  const existing = await prisma.indexFetchLog.findFirst({
    where: { indexDate, status: "success" },
  });
  if (existing) {
    console.log(
      `[IndexIngest] Already succeeded for ${indexDate.toDateString()} — skipping`,
    );
    return {
      success: true,
      indexDate,
      source: existing.source,
      totalFetched: existing.totalFetched,
      totalInserted: existing.totalInserted,
      totalSkipped: existing.totalSkipped,
      durationMs: 0,
    };
  }

  try {
    const fetchResult = await fetchIndexBhavcopy(indexDate);

    // Market closed — log and return cleanly
    if (fetchResult.values.length === 0) {
      await prisma.indexFetchLog.upsert({
        where: { indexDate_source: { indexDate, source: fetchResult.source } },
        create: {
          indexDate,
          source: fetchResult.source,
          status: "market_closed",
          totalFetched: 0,
          totalInserted: 0,
          totalSkipped: fetchResult.skipped,
          durationMs: Date.now() - start,
        },
        update: {
          status: "market_closed",
          durationMs: Date.now() - start,
        },
      });
      return {
        success: true,
        indexDate,
        source: fetchResult.source,
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: fetchResult.skipped,
        durationMs: Date.now() - start,
      };
    }

    const inserted = await upsertIndexValues(fetchResult.values);

    // ── GUARDS 3 + 4: run post-insert. Only reached on NON-market-closed
    // days (the market_closed branch returned above), so no holiday flags.
    // index uses upsert (not createMany+skipDuplicates), so `inserted`
    // always equals the file's row count — no re-run false-flag (the equity
    // Guard-3 fix does not apply here). ──
    const runRef = indexRunRef(indexDate);
    const batch = fetchResult.values;

    // GUARD 3: COUNT — roster collapse (partial fetch). No ceiling: the
    // roster grows over time and upsert dedups.
    const countVerdict = classifyCount(inserted);
    if (countVerdict) {
      await reportIngestionError({
        source: INDEX_SOURCE,
        cron: INDEX_CRON,
        guardType: "count",
        targetTable: "IndexPrice",
        severity: countVerdict.severity,
        resolutionPath: "source_code",
        expected: `≥${COUNT_FLOOR} indices (normal 135–160)`,
        observed: `${inserted} indices upserted`,
        detail: countVerdict.note,
        runRef,
      });
    }

    // GUARD 4: NULL-RATE — a column rename nulls a field across the batch.
    // changePct is ~always present (tight); OHL/valuation/turnover/volume
    // are legitimately sparse (G-Sec/rate/bond indices), so their thresholds
    // sit above the legit baseline.
    const n = batch.length;
    const nullChecks: Array<[string, number, number, string]> = [
      ["changePct", batch.filter((v) => v.changePct == null).length, CHANGEPCT_NULL_MAX, "0.7%"],
      ["open", batch.filter((v) => v.open == null).length, OHL_NULL_MAX, "10.2%"],
      ["high", batch.filter((v) => v.high == null).length, OHL_NULL_MAX, "10.2%"],
      ["low", batch.filter((v) => v.low == null).length, OHL_NULL_MAX, "10.2%"],
      ["pe", batch.filter((v) => v.pe == null).length, VALUATION_NULL_MAX, "15.9%"],
      ["pb", batch.filter((v) => v.pb == null).length, VALUATION_NULL_MAX, "15.1%"],
      ["divYield", batch.filter((v) => v.divYield == null).length, VALUATION_NULL_MAX, "15.1%"],
      ["turnover", batch.filter((v) => v.turnover == null).length, VALUATION_NULL_MAX, "15.8%"],
      ["volume", batch.filter((v) => v.volume == null).length, VALUATION_NULL_MAX, "15.8%"],
    ];
    for (const [field, nulls, max, normal] of nullChecks) {
      const rate = checkNullRate(nulls, n, max);
      if (rate == null) continue;
      await reportIngestionError({
        source: INDEX_SOURCE,
        cron: INDEX_CRON,
        guardType: "null_rate",
        targetTable: "IndexPrice",
        targetField: field,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `${field} null-rate ≤ ${(max * 100).toFixed(0)}% (normal ${normal})`,
        observed: `${(rate * 100).toFixed(1)}% null (${nulls}/${n})`,
        detail: "Index column nulled across the batch — likely a CSV column rename.",
        runRef,
      });
    }

    const durationMs = Date.now() - start;

    await prisma.indexFetchLog.upsert({
      where: { indexDate_source: { indexDate, source: fetchResult.source } },
      create: {
        indexDate,
        source: fetchResult.source,
        status: "success",
        totalFetched: fetchResult.values.length,
        totalInserted: inserted,
        totalSkipped: fetchResult.skipped,
        durationMs,
      },
      update: {
        status: "success",
        totalFetched: fetchResult.values.length,
        totalInserted: inserted,
        totalSkipped: fetchResult.skipped,
        durationMs,
        error: null,
      },
    });

    console.log(
      `[IndexIngest] Done — source: ${fetchResult.source}, upserted: ${inserted}, skipped: ${fetchResult.skipped}, took: ${durationMs}ms`,
    );

    return {
      success: true,
      indexDate,
      source: fetchResult.source,
      totalFetched: fetchResult.values.length,
      totalInserted: inserted,
      totalSkipped: fetchResult.skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = (error as Error).message;

    await prisma.indexFetchLog.upsert({
      where: { indexDate_source: { indexDate, source: SOURCE } },
      create: {
        indexDate,
        source: SOURCE,
        status: "failed",
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: 0,
        error: message,
        durationMs,
      },
      update: {
        status: "failed",
        error: message,
        durationMs,
      },
    });

    console.error("[IndexIngest] Failed:", error);
    return {
      success: false,
      indexDate,
      source: SOURCE,
      totalFetched: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs,
      error: message,
    };
  }
}

// ── Daily EOD job (self-healing) ───────────────────────────────
// The weekday cron calls this. Re-checks the last few trading days
// so a late archive or a missed run self-heals; each day is
// idempotent (a "success" log short-circuits before any fetch).
export async function runDailyIndexIngest(
  lookBackDays = 3,
): Promise<IngestIndicesResult[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const results: IngestIndicesResult[] = [];
  for (let i = 0; i <= lookBackDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);

    // Skip weekends — no archive is published.
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    results.push(await runIndexIngest(d));
  }
  return results;
}

// ── Historical backfill ────────────────────────────────────────
// Fetches EOD index values for the last N trading days. Run once
// after deployment to seed chart history; the cron takes over after.

/**
 * Callback invoked after each trading day. Receives
 * (daysProcessed, totalTradingDays, date). Return `false` to abort.
 */
export type IndexBackfillProgressFn = (
  done: number,
  total: number,
  date: Date,
) => Promise<boolean>;

export async function runIndexBackfill(
  daysBack = 365,
  onDayComplete?: IndexBackfillProgressFn,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  console.log(`[IndexBackfill] Starting ${daysBack}-day backfill…`);

  // Pre-collect trading days (weekdays only) for accurate progress.
  const dates: Date[] = [];
  for (let i = daysBack; i >= 1; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(d);
  }

  for (let idx = 0; idx < dates.length; idx++) {
    const date = dates[idx];

    try {
      const result = await runIndexIngest(date);
      if (result.totalInserted > 0) {
        console.log(
          `[IndexBackfill] ${date.toDateString()}: ${result.totalInserted} upserted`,
        );
      }
    } catch (e) {
      console.error(`[IndexBackfill] Failed for ${date.toDateString()}:`, e);
    }

    // Respectful delay between archive fetches.
    await new Promise((r) => setTimeout(r, 500));

    if (onDayComplete) {
      const shouldContinue = await onDayComplete(idx + 1, dates.length, date);
      if (!shouldContinue) {
        console.log(`[IndexBackfill] Aborted at ${date.toDateString()}`);
        break;
      }
    }
  }

  console.log("[IndexBackfill] Complete");
}
