// ─────────────────────────────────────────────────────────────
// Shareholding pattern ingestion pipeline.
//
// Full flow per stock:
//  1. Hit NSE API → get list of XBRL URLs + metadata
//  2. Filter to last N quarters (or all for backfill)
//  3. For each quarter: fetch XBRL XML → parse → upsert
//  4. Log result
//
// Quarterly job processes ALL active stocks.
// Smart trigger: only fetches stocks due for an update
// (earnings event passed 7–21 days ago without a new filing).
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/browser.js";
import { dateToQuarterFY, parseAsOnDate } from "./shareholding-dates.js";
import { fetchShareholdingIndex, fetchXbrlXml } from "./shareholding-fetch.js";
import { nseClient } from "../../lib/client.js";
import { parseXbrlShareholding } from "./xbrl-parser.js";

// ── Types ─────────────────────────────────────────────────────

/**
 * Called after each batch of stocks completes.
 * Return false to abort remaining batches.
 */
export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export interface IngestShareholdingResult {
  success: boolean;
  symbol: string;
  stockId: string | null;
  quartersProcessed: number;
  quartersInserted: number;
  quartersSkipped: number;
  durationMs: number;
  errors: string[];
}

export interface BulkIngestResult {
  totalStocks: number;
  successStocks: number;
  failedStocks: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
  errors: Array<{ symbol: string; error: string }>;
}

// ── Per-stock ingest ──────────────────────────────────────────

export async function ingestShareholdingForStock(
  symbol: string,
  quartersBack: number = 40,
  signal?: AbortSignal,
): Promise<IngestShareholdingResult> {
  const start = Date.now();
  const errors: string[] = [];
  let quartersInserted = 0;
  let quartersSkipped = 0;

  // Find stock in DB
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true },
  });

  if (!stock) {
    return {
      success: false,
      symbol,
      stockId: null,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: [`Stock ${symbol} not found in universe`],
    };
  }

  // Step 1: Get the list of XBRL URLs from NSE
  let filingIndex;
  try {
    filingIndex = await fetchShareholdingIndex(symbol, signal);
  } catch (e) {
    const msg = (e as Error).message;
    await logFetch(
      symbol,
      stock.id,
      "manual",
      0,
      0,
      0,
      "failed",
      msg,
      Date.now() - start,
    );
    return {
      success: false,
      symbol,
      stockId: stock.id,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: [msg],
    };
  }

  if (filingIndex.length === 0) {
    return {
      success: true,
      symbol,
      stockId: stock.id,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: ["No XBRL filings found for this stock"],
    };
  }

  // Step 2: Filter to the most recent N quarters
  // Sort descending by date, take first N
  const sorted = filingIndex
    .filter((row) => row.asOnDate && row.xbrlUrl)
    .map((row) => ({
      ...row,
      parsedDate: parseAsOnDate(row.asOnDate),
    }))
    .filter((row) => row.parsedDate !== null)
    .sort((a, b) => b.parsedDate!.getTime() - a.parsedDate!.getTime())
    .slice(0, quartersBack);

  console.log(`[Shareholding] ${symbol}: ${sorted.length} quarters to process`);

  // Step 3: For each quarter, check if we already have it, if not fetch+parse
  for (const filing of sorted) {
    const asOnDate = filing.parsedDate!;
    const { quarter, fiscalYear } = dateToQuarterFY(asOnDate);

    // Fetch the XBRL XML
    let xmlText: string;
    try {
      xmlText = await fetchXbrlXml(filing.xbrlUrl, signal);
      console.log(`[Shareholding] ${symbol} ${quarter} ${fiscalYear}: fetched XBRL`);
    } catch (e) {
      const msg = `Failed to fetch XBRL for ${filing.asOnDate}: ${(e as Error).message}`;
      errors.push(msg);
      console.warn(`[Shareholding] ${symbol}: ${msg}`);
      // Rate limiting pause
      await sleep(1000);
      continue;
    }

    // Parse the XML
    let parsed;
    try {
      parsed = parseXbrlShareholding(xmlText);
    } catch (e) {
      const msg = `Failed to parse XBRL for ${filing.asOnDate}: ${(e as Error).message}`;
      errors.push(msg);
      console.warn(`[Shareholding] ${symbol}: ${msg}`);
      continue;
    }

    // Use CSV top-level values as fallback/validation for promoter/public %
    // (more reliable than XBRL for top-level percentages)
    const csvPromoterPct = parseFloat(filing.promoter);
    const csvPublicPct = parseFloat(filing.public);

    const promoterPct =
      !isNaN(csvPromoterPct) && csvPromoterPct > 0
        ? csvPromoterPct
        : parsed.promoterPct;

    const publicPct =
      !isNaN(csvPublicPct) && csvPublicPct > 0
        ? csvPublicPct
        : parsed.publicPct;

    const dec = (v: number | null) =>
      v != null ? new Prisma.Decimal(v) : null;

    // Upsert the shareholding record
    const recordData = {
      symbol,
      quarter,
      fiscalYear,
      promoterPct: new Prisma.Decimal(promoterPct),
      publicPct: new Prisma.Decimal(publicPct),
      employeeTrustPct: new Prisma.Decimal(parsed.employeeTrustPct),
      fiiPct: dec(parsed.fiiPct),
      diiPct: dec(parsed.diiPct),
      retailPct: dec(parsed.retailPct),
      othersPct: dec(parsed.othersPct),
      mutualFundPct: dec(parsed.mutualFundPct),
      insurancePct: dec(parsed.insurancePct),
      banksFisPct: dec(parsed.banksFisPct),
      promoterPledgedPct: dec(parsed.promoterPledgedPct),
      promoterPledgedSharesPct: dec(parsed.promoterPledgedSharesPct),
      totalShares: parsed.totalShares ? BigInt(parsed.totalShares) : BigInt(0),
      promoterShares: parsed.promoterShares
        ? BigInt(parsed.promoterShares)
        : BigInt(0),
      pledgedShares: parsed.pledgedShares
        ? BigInt(parsed.pledgedShares)
        : BigInt(0),
      xbrlUrl: filing.xbrlUrl,
      sourceDate: parseAsOnDate(filing.submissionDate) ?? asOnDate,
    };
    try {
      const result = await prisma.shareholdingPattern.upsert({
        where: { stockId_asOnDate: { stockId: stock.id, asOnDate } },
        create: { stockId: stock.id, asOnDate, ...recordData },
        update: recordData,
      });
      quartersInserted++;
      console.log(
        `[Shareholding] ${symbol} ${quarter} ${fiscalYear}: upserted`,
      );
    } catch (e) {
      errors.push(
        `DB upsert failed for ${filing.asOnDate}: ${(e as Error).message}`,
      );
    }

    // Respect NSE rate limits
    await sleep(800);
  }

  const durationMs = Date.now() - start;

  await logFetch(
    symbol,
    stock.id,
    "manual",
    sorted.length,
    quartersInserted,
    quartersSkipped,
    errors.length === 0 ? "success" : "partial",
    errors.length > 0 ? errors.join("; ") : null,
    durationMs,
  );

  return {
    success: true,
    symbol,
    stockId: stock.id,
    quartersProcessed: sorted.length,
    quartersInserted,
    quartersSkipped,
    durationMs,
    errors,
  };
}

// ── Batch processor ───────────────────────────────────────────
// Runs ingest for a list of symbols in concurrent batches.
// A per-stock timeout prevents a single hung request from
// blocking an entire batch.

async function runInBatches(
  symbols: string[],
  processFn: (symbol: string) => Promise<IngestShareholdingResult>,
  batchSize: number,
  delayBetweenBatches: number,
  timeoutMs: number,
  label: string,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<{
  totalInserted: number;
  totalSkipped: number;
  successStocks: number;
  failedStocks: number;
  errors: Array<{ symbol: string; error: string }>;
}> {
  let totalInserted = 0;
  let totalSkipped = 0;
  let successStocks = 0;
  let failedStocks = 0;
  const errors: Array<{ symbol: string; error: string }> = [];
  const totalBatches = Math.ceil(symbols.length / batchSize);

  for (let i = 0; i < symbols.length; i += batchSize) {
    // Fast-path abort check before starting each batch
    if (signal?.aborted) break;

    const batch = symbols.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(
      `[Shareholding] ${label} batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`,
    );

    const settled = await Promise.allSettled(
      batch.map((symbol) =>
        Promise.race([
          processFn(symbol),
          new Promise<IngestShareholdingResult>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)),
              timeoutMs,
            ),
          ),
        ]),
      ),
    );

    for (let j = 0; j < settled.length; j++) {
      const symbol = batch[j];
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        const r = outcome.value;
        totalInserted += r.quartersInserted;
        totalSkipped += r.quartersSkipped;
        if (r.errors.length > 0) {
          errors.push({ symbol, error: r.errors.join("; ") });
          failedStocks++;
        } else {
          successStocks++;
        }
      } else {
        const msg =
          (outcome.reason as Error)?.message ?? String(outcome.reason);
        errors.push({ symbol, error: msg });
        failedStocks++;
        console.error(`[Shareholding] ${symbol} failed: ${msg}`);
      }
    }

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        batchNum,
        totalBatches,
        `batch ${batchNum}/${totalBatches} — ${batch.join(", ")}`,
      );
      if (!shouldContinue) break;
    }

    if (i + batchSize < symbols.length) {
      // Reset NSE session every 3 batches — long-lived sessions get silently
      // dropped by NSE, causing all stocks in the next batch to hang/fail.
      if (batchNum % 3 === 0) {
        console.log(`[Shareholding] ${label} resetting NSE session after batch ${batchNum}…`);
        nseClient.resetSession();
        await sleep(3_000); // give NSE a moment before the next init
      } else {
        await sleep(delayBetweenBatches);
      }
    }
  }

  return { totalInserted, totalSkipped, successStocks, failedStocks, errors };
}

// ── Bulk quarterly job (all active stocks) ────────────────────
// Run quarterly: Jan 20, Apr 20, Jul 20, Oct 20
// By then most companies have filed (21-day deadline from quarter end)

export async function runQuarterlyShareholdingIngest(
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();

  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });

  console.log(
    `[Shareholding] Quarterly job: ${stocks.length} stocks to process`,
  );

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors } =
    await runInBatches(
      stocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, 4, signal),
      5,
      4_000,
      90_000,
      "Quarterly",
      onBatchComplete,
      signal,
    );

  const durationMs = Date.now() - start;
  console.log(
    `[Shareholding] Done — inserted: ${totalInserted}, stocks: ${successStocks}/${stocks.length}`,
  );

  return {
    totalStocks: stocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs,
    errors,
  };
}

// ── Smart trigger: fetch stocks due for update ─────────────────
// Checks corporate_events: if a stock's Q results event
// passed 7–21 days ago, it's due for a new shareholding filing.

export async function runSmartShareholdingRefresh(
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();
  const now = new Date();

  // Find stocks where earnings event was 7–21 days ago
  const cutoffFrom = new Date(now.getTime() - 21 * 86400_000);
  const cutoffTo = new Date(now.getTime() - 7 * 86400_000);

  const dueStocks = await prisma.corporateEvent.findMany({
    where: {
      eventType: "earnings",
      eventDate: { gte: cutoffFrom, lte: cutoffTo },
      stock: { isActive: true },
    },
    select: { symbol: true },
    distinct: ["symbol"],
  });

  if (dueStocks.length === 0) {
    console.log("[Shareholding] Smart refresh: no stocks due");
    return {
      totalStocks: 0,
      successStocks: 0,
      failedStocks: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs: Date.now() - start,
      errors: [],
    };
  }

  console.log(`[Shareholding] Smart refresh: ${dueStocks.length} stocks due`);

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors } =
    await runInBatches(
      dueStocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, 1, signal),
      5,
      3_000,
      60_000,
      "SmartRefresh",
      onBatchComplete,
      signal,
    );

  return {
    totalStocks: dueStocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs: Date.now() - start,
    errors,
  };
}

// ── Backfill (run once on setup) ───────────────────────────────

export async function runShareholdingBackfill(
  quartersBack: number = 20,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();

  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { symbol: true },
  });

  console.log(
    `[Shareholding] Backfill: ${stocks.length} stocks × ${quartersBack} quarters`,
  );

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors } =
    await runInBatches(
      stocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, quartersBack, signal),
      3,
      8_000,
      300_000, // 5 min per stock — 40 quarters × ~4s each
      "Backfill",
      onBatchComplete,
      signal,
    );

  return {
    totalStocks: stocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs: Date.now() - start,
    errors,
  };
}

// ── Helpers ───────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logFetch(
  symbol: string,
  stockId: string | null,
  fetchType: string,
  found: number,
  inserted: number,
  skipped: number,
  status: string,
  error: string | null,
  durationMs: number,
) {
  try {
    await prisma.shareholdingFetchLog.create({
      data: {
        stockSymbol: symbol,
        stockId,
        fetchType,
        quartersFound: found,
        quartersInserted: inserted,
        quartersSkipped: skipped,
        status,
        error,
        durationMs,
      },
    });
  } catch {
    // Non-critical — don't throw
  }
}
