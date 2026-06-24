// ─────────────────────────────────────────────────────────────
// EOD price ingestion pipeline.
// 1. Fetch bhavcopy via provider (with fallback)
// 2. Filter to active universe
// 3. Insert daily_prices rows (append-only)
// 4. Compute 1M/3M/6M/1Y returns + 52W high/low + sparkline
// 5. Upsert stock_prices snapshot
// 6. Log result
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { EodPrice } from "./providers/provider.js";
import { fetchWithFallback } from "./registry.js";
import { computeMarketCap } from "./market-cap.js";

// ── Types ─────────────────────────────────────────────────────

export interface IngestPricesResult {
  success: boolean;
  priceDate: Date;
  provider: string;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
  error?: string;
}

// ── Universe loader ────────────────────────────────────────────

async function loadUniverse(): Promise<Map<string, string>> {
  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true },
  });
  return new Map(stocks.map((s) => [s.symbol, s.id]));
}

// ── Return calculator ─────────────────────────────────────────
// Queries historical closes for a single stock to compute
// period returns. Runs in parallel for all stocks.

async function computeReturns(
  stockId: string,
  currentClose: number,
  priceDate: Date,
): Promise<{
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
  week52High: number | null;
  week52Low: number | null;
  sparkline: number[];
}> {
  const now = priceDate;

  const [ago1m, ago3m, ago6m, ago1y, yearPrices, sparklinePrices] =
    await Promise.all([
      // Price ~1 month ago (30 days)
      prisma.dailyPrice.findFirst({
        where: {
          stockId,
          date: { lte: new Date(now.getTime() - 30 * 86400_000) },
        },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      // Price ~3 months ago
      prisma.dailyPrice.findFirst({
        where: {
          stockId,
          date: { lte: new Date(now.getTime() - 90 * 86400_000) },
        },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      // Price ~6 months ago
      prisma.dailyPrice.findFirst({
        where: {
          stockId,
          date: { lte: new Date(now.getTime() - 180 * 86400_000) },
        },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      // Price ~1 year ago
      prisma.dailyPrice.findFirst({
        where: {
          stockId,
          date: { lte: new Date(now.getTime() - 365 * 86400_000) },
        },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      // 52-week high/low
      prisma.dailyPrice.aggregate({
        where: {
          stockId,
          date: {
            gte: new Date(now.getTime() - 365 * 86400_000),
            lte: now,
          },
        },
        _max: { high: true },
        _min: { low: true },
      }),
      // Sparkline: last 30 closes
      prisma.dailyPrice.findMany({
        where: { stockId },
        orderBy: { date: "desc" },
        take: 30,
        select: { close: true },
      }),
    ]);

  const pct = (past: number | null) =>
    past && past > 0 ? (currentClose - past) / past : null;

  const close1m = ago1m ? parseFloat(ago1m.close.toString()) : null;
  const close3m = ago3m ? parseFloat(ago3m.close.toString()) : null;
  const close6m = ago6m ? parseFloat(ago6m.close.toString()) : null;
  const close1y = ago1y ? parseFloat(ago1y.close.toString()) : null;

  return {
    return1m: pct(close1m),
    return3m: pct(close3m),
    return6m: pct(close6m),
    return1y: pct(close1y),
    week52High: yearPrices._max.high
      ? parseFloat(yearPrices._max.high.toString())
      : null,
    week52Low: yearPrices._min.low
      ? parseFloat(yearPrices._min.low.toString())
      : null,
    // Sparkline: reverse so oldest first, sample to 30 points
    sparkline: sparklinePrices
      .reverse()
      .map((p) => parseFloat(p.close.toString())),
  };
}

// ── Core insert ────────────────────────────────────────────────

async function insertDailyPrices(
  prices: EodPrice[],
  universe: Map<string, string>,
  provider: string,
): Promise<{
  inserted: number;
  skipped: number;
  stocksWithNewPrices: Array<{ stockId: string; price: EodPrice }>;
}> {
  let skipped = 0;
  const stocksWithNewPrices: Array<{ stockId: string; price: EodPrice }> = [];
  const rows: Prisma.DailyPriceCreateManyInput[] = [];

  for (const price of prices) {
    const stockId = universe.get(price.symbol);
    if (!stockId) {
      skipped++;
      continue;
    }

    rows.push({
      stockId,
      isin: price.isin,
      date: price.date,
      open: new Prisma.Decimal(price.open),
      high: new Prisma.Decimal(price.high),
      low: new Prisma.Decimal(price.low),
      close: new Prisma.Decimal(price.close),
      prevClose:
        price.prevClose != null ? new Prisma.Decimal(price.prevClose) : null,
      volume: price.volume,
      tradedValue:
        price.tradedValue != null
          ? new Prisma.Decimal(price.tradedValue)
          : null,
      provider,
    });

    stocksWithNewPrices.push({ stockId, price });
  }

  if (rows.length === 0)
    return { inserted: 0, skipped, stocksWithNewPrices: [] };

  const result = await prisma.dailyPrice.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return { inserted: result.count, skipped, stocksWithNewPrices };
}

// ── Snapshot updater ───────────────────────────────────────────
// Updates stock_prices with latest close + computed returns.
// Runs after insert so returns can query the newly inserted rows.

async function updateSnapshots(
  stocksWithPrices: Array<{ stockId: string; price: EodPrice }>,
  provider: string,
): Promise<void> {
  // Process in parallel but batch to avoid DB overload
  const BATCH = 10;

  for (let i = 0; i < stocksWithPrices.length; i += BATCH) {
    const batch = stocksWithPrices.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async ({ stockId, price }) => {
        const close = price.close;
        const prevClose = price.prevClose;
        const dayChangePct =
          prevClose && prevClose > 0 ? (close - prevClose) / prevClose : null;

        const returns = await computeReturns(stockId, close, price.date);

        // Spot market cap (₹Cr) = close × latest total_shares / 1e7, split-gated.
        // Sibling display value — NOT a scoring input; null (honest-empty) when gated.
        const mc = await computeMarketCap(stockId, close, price.date);

        const dec = (v: number | null) =>
          v != null ? new Prisma.Decimal(v) : null;

        await prisma.stockPrice.upsert({
          where: { stockId },
          create: {
            stockId,
            price: new Prisma.Decimal(close),
            open: new Prisma.Decimal(price.open),
            high: new Prisma.Decimal(price.high),
            low: new Prisma.Decimal(price.low),
            prevClose: dec(prevClose),
            dayChangePct: dec(dayChangePct),
            volume: price.volume,
            week52High: dec(returns.week52High),
            week52Low: dec(returns.week52Low),
            return1m: dec(returns.return1m),
            return3m: dec(returns.return3m),
            return6m: dec(returns.return6m),
            return1y: dec(returns.return1y),
            sparkline: returns.sparkline,
            priceDate: price.date,
            provider,
            marketCap: dec(mc.marketCapCr),
            sharesAsOfDate: mc.sharesAsOfDate,
            faceValue: null,
          },
          update: {
            price: new Prisma.Decimal(close),
            open: new Prisma.Decimal(price.open),
            high: new Prisma.Decimal(price.high),
            low: new Prisma.Decimal(price.low),
            prevClose: dec(prevClose),
            dayChangePct: dec(dayChangePct),
            volume: price.volume,
            week52High: dec(returns.week52High),
            week52Low: dec(returns.week52Low),
            return1m: dec(returns.return1m),
            return3m: dec(returns.return3m),
            return6m: dec(returns.return6m),
            return1y: dec(returns.return1y),
            sparkline: returns.sparkline,
            priceDate: price.date,
            provider,
            marketCap: dec(mc.marketCapCr),
            sharesAsOfDate: mc.sharesAsOfDate,
          },
        });
      }),
    );
  }
}

// ── Daily EOD job ──────────────────────────────────────────────

export async function runEodPriceIngest(
  targetDate?: Date,
): Promise<IngestPricesResult> {
  const start = Date.now();
  const priceDate = targetDate ?? new Date();
  priceDate.setUTCHours(0, 0, 0, 0);

  // Guard: already ran successfully today?
  const existing = await prisma.priceFetchLog.findFirst({
    where: {
      priceDate,
      status: "success",
    },
  });
  if (existing) {
    console.log(
      `[PriceIngest] Already succeeded for ${priceDate.toDateString()} — skipping`,
    );
    return {
      success: true,
      priceDate,
      provider: existing.provider,
      totalFetched: existing.totalFetched,
      totalInserted: existing.totalInserted,
      totalSkipped: existing.totalSkipped,
      durationMs: 0,
    };
  }

  try {
    const [universe, fetchResult] = await Promise.all([
      loadUniverse(),
      fetchWithFallback(priceDate),
    ]);

    // Market closed — log and return cleanly
    if (fetchResult.prices.length === 0) {
      await prisma.priceFetchLog.upsert({
        where: {
          priceDate_provider: { priceDate, provider: fetchResult.provider },
        },
        create: {
          priceDate,
          provider: fetchResult.provider,
          status: "market_closed",
          totalFetched: 0,
          totalInserted: 0,
          totalSkipped: 0,
          durationMs: Date.now() - start,
        },
        update: {
          status: "market_closed",
          durationMs: Date.now() - start,
        },
      });
      return {
        success: true,
        priceDate,
        provider: fetchResult.provider,
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: 0,
        durationMs: Date.now() - start,
      };
    }

    const { inserted, skipped, stocksWithNewPrices } = await insertDailyPrices(
      fetchResult.prices,
      universe,
      fetchResult.provider,
    );

    // Update snapshots with returns (only for newly inserted)
    if (stocksWithNewPrices.length > 0) {
      await updateSnapshots(stocksWithNewPrices, fetchResult.provider);
    }

    const durationMs = Date.now() - start;

    await prisma.priceFetchLog.upsert({
      where: {
        priceDate_provider: { priceDate, provider: fetchResult.provider },
      },
      create: {
        priceDate,
        provider: fetchResult.provider,
        status: "success",
        totalFetched: fetchResult.prices.length,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
      },
      update: {
        status: "success",
        totalFetched: fetchResult.prices.length,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
        error: null,
      },
    });

    console.log(
      `[PriceIngest] Done — provider: ${fetchResult.provider}, inserted: ${inserted}, skipped: ${skipped}, took: ${durationMs}ms`,
    );

    return {
      success: true,
      priceDate,
      provider: fetchResult.provider,
      totalFetched: fetchResult.prices.length,
      totalInserted: inserted,
      totalSkipped: skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = (error as Error).message;

    const failedProvider = process.env.PRICE_PROVIDER ?? "nse-bhavcopy-csv";
    await prisma.priceFetchLog.upsert({
      where: { priceDate_provider: { priceDate, provider: failedProvider } },
      create: {
        priceDate,
        provider: failedProvider,
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

    console.error("[PriceIngest] Failed:", error);
    return {
      success: false,
      priceDate,
      provider: process.env.PRICE_PROVIDER ?? "unknown",
      totalFetched: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs,
      error: message,
    };
  }
}

// ── Daily EOD job (self-healing) ───────────────────────────────
// The weekday cron calls this. Instead of fetching only "today"
// (which silently leaves a permanent gap if the run fires before
// NSE publishes the file, or if a run is missed), it re-checks the
// last few trading days. Every day is idempotent: a day already
// logged as "success" short-circuits on a cheap DB check before any
// network call, so the only real fetch is for days still missing.
export async function runDailyEodPriceIngest(
  lookBackDays = 3,
): Promise<IngestPricesResult[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const results: IngestPricesResult[] = [];
  for (let i = 0; i <= lookBackDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);

    // Skip weekends — no bhavcopy is published.
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    results.push(await runEodPriceIngest(d));
  }
  return results;
}

// ── Historical backfill ────────────────────────────────────────
// Fetches EOD prices for the last N trading days.
// Run once after deployment to seed return calculations.

/**
 * Callback invoked after each trading day is processed.
 * Receives (daysProcessed, totalTradingDays, date).
 * Return `false` to abort the backfill early (cooperative cancellation).
 */
export type PriceBackfillProgressFn = (
  done: number,
  total: number,
  date: Date,
) => Promise<boolean>;

export async function runPriceBackfill(
  daysBack = 365,
  onDayComplete?: PriceBackfillProgressFn,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  console.log(`[PriceBackfill] Starting ${daysBack}-day backfill…`);

  // Pre-collect trading days (weekdays only) so we can report accurate
  // progress fractions rather than guessing what fraction of days are weekends.
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
      const result = await runEodPriceIngest(date);
      if (result.totalInserted > 0) {
        console.log(
          `[PriceBackfill] ${date.toDateString()}: ${result.totalInserted} inserted`,
        );
      }
    } catch (e) {
      console.error(`[PriceBackfill] Failed for ${date.toDateString()}:`, e);
    }

    // Respectful delay between API calls regardless of whether a callback is provided
    await new Promise((r) => setTimeout(r, 500));

    if (onDayComplete) {
      const shouldContinue = await onDayComplete(idx + 1, dates.length, date);
      if (!shouldContinue) {
        console.log(`[PriceBackfill] Aborted at ${date.toDateString()}`);
        break;
      }
    }
  }

  console.log("[PriceBackfill] Complete");
}
