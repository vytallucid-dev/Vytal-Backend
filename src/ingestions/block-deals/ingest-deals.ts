// ─────────────────────────────────────────────────────────────
// Ingestion pipeline for block/bulk deals.
// Universe filtering, deduplication, DB upsert, fetch logging.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { fetchDailyDeals, backfillDeals, type DealRecord } from "./deals.js";

// ── Types ─────────────────────────────────────────────────────

export interface IngestDealsResult {
  success: boolean;
  fetchDate: Date;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
  error?: string;
}

// ── Universe loader ────────────────────────────────────────────
// Loads your active stock universe once per job run.
// Returns a Map of symbol → stockId for O(1) lookup.

async function loadUniverse(): Promise<Map<string, string>> {
  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true },
  });
  return new Map(stocks.map((s) => [s.symbol, s.id]));
}

// ── Core insert ────────────────────────────────────────────────
// Inserts deals that are in the universe, skips the rest.
// Uses createMany with skipDuplicates for efficiency.

async function insertDeals(
  deals: DealRecord[],
  universe: Map<string, string>,
): Promise<{ inserted: number; skipped: number }> {
  let skipped = 0;

  // Filter to universe and map to DB shape
  const rows: Prisma.BlockDealCreateManyInput[] = [];

  for (const deal of deals) {
    const stockId = universe.get(deal.symbol);
    if (!stockId) {
      skipped++;
      continue;
    }

    rows.push({
      stockId,
      dealDate: deal.dealDate,
      dealType: deal.dealType,
      clientName: deal.clientName,
      transactionType: deal.transactionType,
      quantity: deal.quantity,
      price: new Prisma.Decimal(deal.price),
      valueCr: new Prisma.Decimal(deal.valueCr),
      remarks: deal.remarks,
      source: "nse",
    });
  }

  if (rows.length === 0) return { inserted: 0, skipped };

  // createMany with skipDuplicates handles re-runs safely
  const result = await prisma.blockDeal.createMany({
    data: rows,
    skipDuplicates: true, // uses the @@unique constraint
  });

  return { inserted: result.count, skipped };
}

// ── Daily job ─────────────────────────────────────────────────

export async function runDailyDealIngest(): Promise<IngestDealsResult> {
  const start = Date.now();
  const fetchDate = new Date();
  fetchDate.setUTCHours(0, 0, 0, 0);

  // Check if we already ran today
  const existing = await prisma.dealFetchLog.findUnique({
    where: { fetchDate_fetchType: { fetchDate, fetchType: "daily" } },
  });
  if (existing?.status === "success") {
    console.log(
      `[DealIngest] Already ran successfully for ${fetchDate.toDateString()} — skipping`,
    );
    return {
      success: true,
      fetchDate,
      totalFetched: existing.totalFetched,
      totalInserted: existing.totalInserted,
      totalSkipped: existing.totalSkipped,
      durationMs: 0,
    };
  }

  try {
    const [universe, { deals, rawBulk, rawBlock }] = await Promise.all([
      loadUniverse(),
      fetchDailyDeals(),
    ]);

    const totalFetched = rawBulk + rawBlock;
    const { inserted, skipped } = await insertDeals(deals, universe);
    const durationMs = Date.now() - start;

    // Log success
    await prisma.dealFetchLog.upsert({
      where: { fetchDate_fetchType: { fetchDate, fetchType: "daily" } },
      create: {
        fetchDate,
        fetchType: "daily",
        status: "success",
        totalFetched,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
      },
      update: {
        status: "success",
        totalFetched,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
      },
    });

    console.log(
      `[DealIngest] Daily complete — fetched: ${totalFetched}, inserted: ${inserted}, skipped: ${skipped}, took: ${durationMs}ms`,
    );

    return {
      success: true,
      fetchDate,
      totalFetched,
      totalInserted: inserted,
      totalSkipped: skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = (error as Error).message;

    await prisma.dealFetchLog.upsert({
      where: { fetchDate_fetchType: { fetchDate, fetchType: "daily" } },
      create: {
        fetchDate,
        fetchType: "daily",
        status: "failed",
        totalFetched: 0,
        totalInserted: 0,
        totalSkipped: 0,
        error: message,
        durationMs,
      },
      update: { status: "failed", error: message, durationMs },
    });

    console.error(`[DealIngest] Daily failed:`, error);
    return {
      success: false,
      fetchDate,
      totalFetched: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs,
      error: message,
    };
  }
}

// ── Backfill job ──────────────────────────────────────────────

export async function runBackfillDealIngest(
  daysBack = 90,
): Promise<IngestDealsResult> {
  const start = Date.now();
  const fetchDate = new Date();
  fetchDate.setUTCHours(0, 0, 0, 0);

  try {
    const [universe, deals] = await Promise.all([
      loadUniverse(),
      backfillDeals(daysBack),
    ]);

    const totalFetched = deals.length;
    const { inserted, skipped } = await insertDeals(deals, universe);
    const durationMs = Date.now() - start;

    await prisma.dealFetchLog.upsert({
      where: { fetchDate_fetchType: { fetchDate, fetchType: "backfill" } },
      create: {
        fetchDate,
        fetchType: "backfill",
        status: "success",
        totalFetched,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
      },
      update: {
        status: "success",
        totalFetched,
        totalInserted: inserted,
        totalSkipped: skipped,
        durationMs,
      },
    });

    console.log(
      `[DealIngest] Backfill complete — inserted: ${inserted}, skipped: ${skipped}`,
    );
    return {
      success: true,
      fetchDate,
      totalFetched,
      totalInserted: inserted,
      totalSkipped: skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = (error as Error).message;
    console.error(`[DealIngest] Backfill failed:`, error);
    return {
      success: false,
      fetchDate,
      totalFetched: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs,
      error: message,
    };
  }
}
