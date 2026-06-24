// ─────────────────────────────────────────────────────────────
// YAHOO FINANCE 5-YEAR PRICE BACKFILL
//
// Fetches 5 years of daily OHLCV data from Yahoo Finance for
// all stocks in the DB (active + inactive peer-benchmark stocks)
// and writes to:
//   - daily_prices     (append-only, skipDuplicates)
//   - stock_prices     (upsert latest snapshot with returns)
//
// Safe to run alongside the existing NSE bhavcopy pipeline —
// different provider tag, skipDuplicates prevents collisions.
//
// Usage:
//   tsx src/scripts/yahoo-price-backfill.ts
//   tsx src/scripts/yahoo-price-backfill.ts --years 5
//   tsx src/scripts/yahoo-price-backfill.ts --years 5 --batch-size 5 --batch-delay 3000
//   tsx src/scripts/yahoo-price-backfill.ts --symbols TCS,INFY,HDFCBANK
//   tsx src/scripts/yahoo-price-backfill.ts --skip-existing   # skip stocks that already have history
//   tsx src/scripts/yahoo-price-backfill.ts --dry-run         # fetch + parse, no DB writes
//
// Install dependency first:
//   npm install yahoo-finance2
// ─────────────────────────────────────────────────────────────

import YahooFinance from "yahoo-finance2";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";

const yahooFinance = new YahooFinance();

// ── Constants ─────────────────────────────────────────────────

const PROVIDER = "yahoo-finance";

/** NSE symbol overrides → Yahoo Finance ticker.
 *  Add entries here whenever Yahoo lags behind a stock rename.
 *
 *  Verify by searching on https://finance.yahoo.com/
 *    e.g. search "Zomato" → note the ticker shown
 */
const YAHOO_SYMBOL_OVERRIDES: Record<string, string> = {
  // Zomato renamed to Eternal in 2025 on NSE, but Yahoo may still serve old symbol
  ETERNAL: "ETERNAL.NS",
  // Tata Motors demerger effective Oct 1 2025: TATAMOTORS → TMCV (CV) + TMPV (PV+JLR)
  TMCV: "TMCV.NS",
  TMPV: "TMPV.NS",
  // Adani Energy Solutions renamed from ADANITRANS — check if Yahoo updated
  ADANIENSOL: "ADANIENSOL.NS",
  // GE Vernova T&D renamed from GET&D — verify on Yahoo
  "GVT&D": "GVT%26D.NS",
};

// ── Types ──────────────────────────────────────────────────────

interface CliArgs {
  years: number;
  batchSize: number;
  batchDelayMs: number;
  symbols: string[] | null; // null = all stocks
  skipExisting: boolean;
  dryRun: boolean;
}

interface StockResult {
  symbol: string;
  status: "success" | "failed" | "skipped" | "no_data";
  rowsInserted: number;
  error?: string;
  durationMs: number;
}

interface BackfillSummary {
  totalStocks: number;
  successful: number;
  failed: number;
  skipped: number;
  noData: number;
  totalRowsInserted: number;
  durationMs: number;
  failures: Array<{ symbol: string; error: string }>;
}

// ── CLI arg parser ─────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    years: 5,
    batchSize: 10,
    batchDelayMs: 3000,
    symbols: null,
    skipExisting: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--years") args.years = parseInt(argv[++i]);
    else if (a === "--batch-size") args.batchSize = parseInt(argv[++i]);
    else if (a === "--batch-delay") args.batchDelayMs = parseInt(argv[++i]);
    else if (a === "--symbols")
      args.symbols = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (a === "--skip-existing") args.skipExisting = true;
    else if (a === "--dry-run") args.dryRun = true;
  }

  return args;
}

// ── Symbol helpers ────────────────────────────────────────────

/** Convert NSE symbol to Yahoo Finance ticker (appends .NS) */
function toYahooTicker(nseSymbol: string): string {
  return YAHOO_SYMBOL_OVERRIDES[nseSymbol] ?? `${nseSymbol}.NS`;
}

// ── Yahoo Finance fetcher ─────────────────────────────────────

interface RawOhlcv {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number | null;
}

/**
 * Fetch daily OHLCV from Yahoo Finance.
 * Returns rows sorted oldest → newest.
 * Returns empty array on valid "no data" (delisted, wrong symbol, etc.)
 * Throws on network/auth errors so the caller can retry.
 */
async function fetchYahooHistory(
  nseSymbol: string,
  yearsBack: number,
): Promise<RawOhlcv[]> {
  const ticker = toYahooTicker(nseSymbol);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setUTCFullYear(from.getUTCFullYear() - yearsBack);

  // yahoo-finance2 suppresses internal console errors by default.
  // Pass { suppressNotices: ['yahooSurvey'] } to suppress survey prompts.
  const rows = (await yahooFinance.historical(
    ticker,
    {
      period1: from,
      period2: today,
      interval: "1d",
    },
    { validateResult: false },
  )) as RawOhlcv[] | undefined;

  if (!rows || rows.length === 0) return [];

  return rows
    .filter(
      (r) =>
        r.open != null &&
        r.high != null &&
        r.low != null &&
        r.close != null &&
        r.volume != null &&
        r.close > 0,
    )
    .map((r) => ({
      date: normaliseDate(r.date),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.adjClose ?? r.close,
      volume: r.volume,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Normalise any date to UTC midnight (Date column in Prisma requires this). */
function normaliseDate(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// ── DB writers ────────────────────────────────────────────────

/**
 * Bulk-insert OHLCV rows into daily_prices.
 * prevClose[i] = close[i-1] (derived; null for the first row).
 * skipDuplicates ensures NSE bhavcopy rows are never overwritten.
 */
async function insertDailyPrices(
  prisma: PrismaClient,
  stockId: string,
  rows: RawOhlcv[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const data: Prisma.DailyPriceCreateManyInput[] = rows.map((r, i) => ({
    stockId,
    date: r.date,
    open: new Prisma.Decimal(r.open),
    high: new Prisma.Decimal(r.high),
    low: new Prisma.Decimal(r.low),
    close: new Prisma.Decimal(r.close),
    prevClose: i > 0 ? new Prisma.Decimal(rows[i - 1].close) : null,
    volume: BigInt(Math.round(r.volume)),
    tradedValue: null, // Yahoo does not provide ₹ Crore traded value
    isin: null, // Yahoo does not provide ISIN
    provider: PROVIDER,
  }));

  const result = await prisma.dailyPrice.createMany({
    data,
    skipDuplicates: true, // won't overwrite NSE bhavcopy rows
  });

  return result.count;
}

/**
 * Compute period returns + 52W range + sparkline from daily_prices,
 * then upsert stock_prices snapshot.
 * Must be called AFTER insertDailyPrices so the queries see fresh rows.
 */
async function updateSnapshot(
  prisma: PrismaClient,
  stockId: string,
  latestRow: RawOhlcv,
): Promise<void> {
  const now = latestRow.date;
  const close = latestRow.close;

  const [ago1m, ago3m, ago6m, ago1y, yearRange, sparklineRows] =
    await Promise.all([
      prisma.dailyPrice.findFirst({
        where: { stockId, date: { lte: msAgo(now, 30) } },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      prisma.dailyPrice.findFirst({
        where: { stockId, date: { lte: msAgo(now, 90) } },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      prisma.dailyPrice.findFirst({
        where: { stockId, date: { lte: msAgo(now, 180) } },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      prisma.dailyPrice.findFirst({
        where: { stockId, date: { lte: msAgo(now, 365) } },
        orderBy: { date: "desc" },
        select: { close: true },
      }),
      prisma.dailyPrice.aggregate({
        where: { stockId, date: { gte: msAgo(now, 365), lte: now } },
        _max: { high: true },
        _min: { low: true },
      }),
      prisma.dailyPrice.findMany({
        where: { stockId },
        orderBy: { date: "desc" },
        take: 30,
        select: { close: true },
      }),
    ]);

  const pct = (past: Prisma.Decimal | null | undefined): number | null => {
    if (!past) return null;
    const p = parseFloat(past.toString());
    return p > 0 ? (close - p) / p : null;
  };

  const sparkline = sparklineRows
    .reverse()
    .map((r) => parseFloat(r.close.toString()));

  const dec = (v: number | null) => (v != null ? new Prisma.Decimal(v) : null);

  const prevClose = latestRow.open; // closest proxy; actual prevClose needs prior row
  // Better prevClose: the close of the day before latestRow
  const prevRow = await prisma.dailyPrice.findFirst({
    where: { stockId, date: { lt: now } },
    orderBy: { date: "desc" },
    select: { close: true },
  });
  const prevCloseVal = prevRow ? parseFloat(prevRow.close.toString()) : null;
  const dayChangePct =
    prevCloseVal && prevCloseVal > 0
      ? (close - prevCloseVal) / prevCloseVal
      : null;

  await prisma.stockPrice.upsert({
    where: { stockId },
    create: {
      stockId,
      price: new Prisma.Decimal(close),
      open: new Prisma.Decimal(latestRow.open),
      high: new Prisma.Decimal(latestRow.high),
      low: new Prisma.Decimal(latestRow.low),
      prevClose: dec(prevCloseVal),
      dayChangePct: dec(dayChangePct),
      volume: BigInt(Math.round(latestRow.volume)),
      week52High: yearRange._max.high
        ? new Prisma.Decimal(yearRange._max.high.toString())
        : null,
      week52Low: yearRange._min.low
        ? new Prisma.Decimal(yearRange._min.low.toString())
        : null,
      return1m: dec(pct(ago1m?.close)),
      return3m: dec(pct(ago3m?.close)),
      return6m: dec(pct(ago6m?.close)),
      return1y: dec(pct(ago1y?.close)),
      sparkline,
      priceDate: now,
      provider: PROVIDER,
      marketCap: null,
      faceValue: null,
    },
    update: {
      price: new Prisma.Decimal(close),
      open: new Prisma.Decimal(latestRow.open),
      high: new Prisma.Decimal(latestRow.high),
      low: new Prisma.Decimal(latestRow.low),
      prevClose: dec(prevCloseVal),
      dayChangePct: dec(dayChangePct),
      volume: BigInt(Math.round(latestRow.volume)),
      week52High: yearRange._max.high
        ? new Prisma.Decimal(yearRange._max.high.toString())
        : null,
      week52Low: yearRange._min.low
        ? new Prisma.Decimal(yearRange._min.low.toString())
        : null,
      return1m: dec(pct(ago1m?.close)),
      return3m: dec(pct(ago3m?.close)),
      return6m: dec(pct(ago6m?.close)),
      return1y: dec(pct(ago1y?.close)),
      sparkline,
      priceDate: now,
      provider: PROVIDER,
    },
  });
}

// ── Per-stock orchestrator ────────────────────────────────────

async function backfillStock(
  prisma: PrismaClient,
  stockId: string,
  symbol: string,
  yearsBack: number,
  skipExisting: boolean,
  dryRun: boolean,
): Promise<StockResult> {
  const start = Date.now();

  // Skip-existing check: does this stock already have a full history?
  if (skipExisting) {
    const approxExpected = yearsBack * 220; // ~220 trading days/year
    const count = await prisma.dailyPrice.count({ where: { stockId } });
    if (count >= approxExpected) {
      return {
        symbol,
        status: "skipped",
        rowsInserted: 0,
        durationMs: Date.now() - start,
      };
    }
  }

  // Fetch from Yahoo
  let rows: RawOhlcv[];
  try {
    rows = await fetchYahooHistory(symbol, yearsBack);
  } catch (err) {
    return {
      symbol,
      status: "failed",
      rowsInserted: 0,
      error: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }

  if (rows.length === 0) {
    return {
      symbol,
      status: "no_data",
      rowsInserted: 0,
      error: `Yahoo returned 0 rows for ${toYahooTicker(symbol)}`,
      durationMs: Date.now() - start,
    };
  }

  if (dryRun) {
    console.log(
      `   [dry-run] ${symbol.padEnd(14)} → ${rows.length} rows, ` +
        `${rows[0].date.toISOString().slice(0, 10)} → ${rows[rows.length - 1].date.toISOString().slice(0, 10)}`,
    );
    return {
      symbol,
      status: "success",
      rowsInserted: 0,
      durationMs: Date.now() - start,
    };
  }

  // Insert daily prices
  let inserted: number;
  try {
    inserted = await insertDailyPrices(prisma, stockId, rows);
  } catch (err) {
    return {
      symbol,
      status: "failed",
      rowsInserted: 0,
      error: `DB insert failed: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  // Update snapshot with latest price + returns
  try {
    const latest = rows[rows.length - 1];
    await updateSnapshot(prisma, stockId, latest);
  } catch (err) {
    // Snapshot failure is non-fatal — daily data was already written
    console.warn(
      `   [warn] ${symbol} snapshot update failed: ${(err as Error).message}`,
    );
  }

  return {
    symbol,
    status: "success",
    rowsInserted: inserted,
    durationMs: Date.now() - start,
  };
}

// ── Main export ───────────────────────────────────────────────

export async function runYahooBackfill(
  args: CliArgs,
): Promise<BackfillSummary> {
  const overallStart = Date.now();

  try {
    // Load stocks — include ALL (active + inactive peer-benchmark stocks)
    const allStocks = await prisma.stock.findMany({
      select: { id: true, symbol: true, isActive: true },
      orderBy: { symbol: "asc" },
    });

    const stocks = args.symbols
      ? allStocks.filter((s) => args.symbols!.includes(s.symbol))
      : allStocks;

    if (stocks.length === 0) {
      console.error("No stocks found. Run the seed scripts first.");
      process.exit(1);
    }

    const batchSize = args.batchSize;
    const totalBatches = Math.ceil(stocks.length / batchSize);

    console.log(
      "─────────────────────────────────────────────────────────────",
    );
    console.log("Yahoo Finance 5-Year Price Backfill");
    console.log(
      "─────────────────────────────────────────────────────────────",
    );
    console.log(`  Stocks     : ${stocks.length}`);
    console.log(`  Years back : ${args.years}`);
    console.log(`  Batch size : ${batchSize}`);
    console.log(`  Batch delay: ${args.batchDelayMs}ms`);
    console.log(`  Skip exist.: ${args.skipExisting}`);
    console.log(`  Dry run    : ${args.dryRun}`);
    console.log(`  Batches    : ${totalBatches}`);
    console.log("");

    const results: StockResult[] = [];
    let batchNum = 0;

    for (let i = 0; i < stocks.length; i += batchSize) {
      batchNum++;
      const batch = stocks.slice(i, i + batchSize);
      const batchStart = Date.now();

      console.log(
        `Batch ${batchNum}/${totalBatches} — ` +
          batch.map((s) => s.symbol).join(", "),
      );

      // Process batch sequentially within the batch.
      // Yahoo Finance has per-IP rate limits; parallel requests within a batch
      // are fine at small sizes (≤10) but we stay sequential to be safe.
      for (const stock of batch) {
        const result = await backfillStock(
          prisma,
          stock.id,
          stock.symbol,
          args.years,
          args.skipExisting,
          args.dryRun,
        );
        results.push(result);

        const statusIcon =
          result.status === "success"
            ? "✓"
            : result.status === "skipped"
              ? "⊘"
              : result.status === "no_data"
                ? "?"
                : "✗";

        console.log(
          `  ${statusIcon} ${result.symbol.padEnd(14)} ` +
            `${result.rowsInserted} rows  ` +
            `${result.durationMs}ms` +
            (result.error ? `  ⚠ ${result.error.slice(0, 80)}` : ""),
        );
      }

      const batchMs = Date.now() - batchStart;
      const done = Math.min(i + batchSize, stocks.length);
      const pct = Math.round((done / stocks.length) * 100);
      const elapsed = Date.now() - overallStart;
      const eta =
        done < stocks.length
          ? Math.round(((elapsed / done) * (stocks.length - done)) / 1000)
          : 0;

      console.log(
        `  Batch done in ${batchMs}ms — ` +
          `${done}/${stocks.length} (${pct}%) — ETA ~${eta}s\n`,
      );

      // Delay between batches to respect Yahoo rate limits
      if (i + batchSize < stocks.length) {
        await sleep(args.batchDelayMs);
      }
    }

    // ── Summary ──────────────────────────────────────────────
    const summary: BackfillSummary = {
      totalStocks: results.length,
      successful: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      noData: results.filter((r) => r.status === "no_data").length,
      totalRowsInserted: results.reduce((s, r) => s + r.rowsInserted, 0),
      durationMs: Date.now() - overallStart,
      failures: results
        .filter((r) => r.status === "failed" || r.status === "no_data")
        .map((r) => ({ symbol: r.symbol, error: r.error ?? "no data" })),
    };

    console.log(
      "─────────────────────────────────────────────────────────────",
    );
    console.log(`Done in ${Math.round(summary.durationMs / 1000)}s`);
    console.log(`  ✓ Successful : ${summary.successful}`);
    console.log(`  ✗ Failed     : ${summary.failed}`);
    console.log(`  ? No data    : ${summary.noData}`);
    console.log(`  ⊘ Skipped   : ${summary.skipped}`);
    console.log(
      `  Rows inserted: ${summary.totalRowsInserted.toLocaleString()}`,
    );

    if (summary.failures.length > 0) {
      console.log("\nFailures (investigate these):");
      for (const f of summary.failures) {
        console.log(`  - ${f.symbol.padEnd(14)} ${f.error}`);
      }
      console.log(
        "\nFor failed symbols, check YAHOO_SYMBOL_OVERRIDES at the top of this file.",
      );
    }

    return summary;
  } finally {
    await prisma.$disconnect();
  }
}

// ── Helpers ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function msAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

// ── CLI entry point ───────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

runYahooBackfill(args)
  .then((summary) => {
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
