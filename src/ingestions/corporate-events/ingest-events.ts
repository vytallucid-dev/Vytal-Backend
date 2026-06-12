// src/lib/nse/ingest-events.ts
// ─────────────────────────────────────────────────────────────
// Corporate events ingestion pipeline.
//
// Two modes:
//  weekly  — fetches next 60 days from today (run every Sunday)
//  backfill — fetches a historical range (run once on setup)
//
// Strategy:
//  - Universe-filtered: only stocks in your active universe
//  - Upsert on (stockId, eventType, eventDate) — idempotent
//  - Re-running is always safe — updates dates if rescheduled
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/browser.js";
import { fetchAllEvents, type EventRecord } from "./events.js";

// ── Types ─────────────────────────────────────────────────────

export interface IngestEventsResult {
  success: boolean;
  fromDate: Date;
  toDate: Date;
  totalFetched: number;
  totalInserted: number;
  totalUpdated: number;
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

// ── Core upsert ────────────────────────────────────────────────

async function upsertEvents(
  events: EventRecord[],
  universe: Map<string, string>,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    const stockId = universe.get(event.symbol);
    if (!stockId) {
      skipped++;
      continue;
    }

    const dec = (v: number | null) =>
      v != null ? new Prisma.Decimal(v) : null;

    // Check if this event already exists
    const existing = await prisma.corporateEvent.findUnique({
      where: {
        corporate_event_unique: {
          stockId,
          eventType: event.eventType,
          eventDate: event.eventDate,
        },
      },
    });

    if (existing) {
      // Update if anything material changed (dividendAmount, exDate, etc.)
      const needsUpdate =
        existing.exDate?.getTime() !== event.exDate?.getTime() ||
        existing.recordDate?.getTime() !== event.recordDate?.getTime() ||
        parseFloat(existing.dividendAmount?.toString() ?? "0") !==
          (event.dividendAmount ?? 0) ||
        existing.description !== event.description;

      if (needsUpdate) {
        await prisma.corporateEvent.update({
          where: { id: existing.id },
          data: {
            exDate: event.exDate ?? undefined,
            recordDate: event.recordDate ?? undefined,
            description: event.description ?? undefined,
            dividendAmount: dec(event.dividendAmount) ?? undefined,
            dividendType: event.dividendType ?? undefined,
            bonusRatio: event.bonusRatio ?? undefined,
            splitRatio: event.splitRatio ?? undefined,
            purpose: event.purpose ?? undefined,
            impactLevel: event.impactLevel,
          },
        });
        updated++;
      }
    } else {
      await prisma.corporateEvent.create({
        data: {
          stockId,
          symbol: event.symbol,
          eventType: event.eventType,
          eventDate: event.eventDate,
          exDate: event.exDate,
          recordDate: event.recordDate,
          description: event.description,
          isConfirmed: event.isConfirmed,
          impactLevel: event.impactLevel,
          dividendAmount: dec(event.dividendAmount),
          dividendType: event.dividendType,
          bonusRatio: event.bonusRatio,
          splitRatio: event.splitRatio,
          purpose: event.purpose,
          source: "nse",
        },
      });
      inserted++;
    }
  }

  return { inserted, updated, skipped };
}

// ── Weekly job ─────────────────────────────────────────────────
// Fetches next 30 days of events.
// Run every Sunday at 7:30 AM IST to have the week's events ready.

export async function runWeeklyEventIngest(): Promise<IngestEventsResult> {
  const start = Date.now();

  const fromDate = new Date();
  fromDate.setUTCHours(0, 0, 0, 0);

  const toDate = new Date(fromDate);
  toDate.setUTCDate(toDate.getUTCDate() + 30); // 30 days ahead

  console.log(
    `[EventIngest] Weekly fetch: ${fromDate.toDateString()} → ${toDate.toDateString()}`,
  );

  try {
    const [universe, events] = await Promise.all([
      loadUniverse(),
      fetchAllEvents(fromDate, toDate),
    ]);

    console.log(`[EventIngest] Fetched ${events.length} events from NSE`);

    const { inserted, updated, skipped } = await upsertEvents(events, universe);
    const durationMs = Date.now() - start;

    await prisma.eventFetchLog.create({
      data: {
        fetchType: "weekly",
        fromDate,
        toDate,
        status: "success",
        totalFetched: events.length,
        totalInserted: inserted,
        totalUpdated: updated,
        totalSkipped: skipped,
        durationMs,
      },
    });

    console.log(
      `[EventIngest] Done — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`,
    );

    return {
      success: true,
      fromDate,
      toDate,
      totalFetched: events.length,
      totalInserted: inserted,
      totalUpdated: updated,
      totalSkipped: skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = (error as Error).message;

    await prisma.eventFetchLog.create({
      data: {
        fetchType: "weekly",
        fromDate,
        toDate,
        status: "failed",
        totalFetched: 0,
        totalInserted: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        error: message,
        durationMs,
      },
    });

    console.error("[EventIngest] Weekly failed:", error);
    return {
      success: false,
      fromDate,
      toDate,
      totalFetched: 0,
      totalInserted: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      durationMs,
      error: message,
    };
  }
}

// ── Pre-event refresh ──────────────────────────────────────────
// Run daily to catch rescheduled events.
// Only fetches the next 7 days — very fast, ~1 API call pair.

export async function runDailyEventRefresh(): Promise<IngestEventsResult> {
  const start = Date.now();

  const fromDate = new Date();
  fromDate.setUTCHours(0, 0, 0, 0);

  const toDate = new Date(fromDate);
  toDate.setUTCDate(toDate.getUTCDate() + 7);

  try {
    const [universe, events] = await Promise.all([
      loadUniverse(),
      fetchAllEvents(fromDate, toDate),
    ]);

    const { inserted, updated, skipped } = await upsertEvents(events, universe);
    const durationMs = Date.now() - start;

    // Only log if something changed — keeps logs clean
    if (inserted > 0 || updated > 0) {
      console.log(
        `[EventRefresh] Daily — inserted: ${inserted}, updated: ${updated}`,
      );
    }

    await prisma.eventFetchLog.create({
      data: {
        fetchType: "daily_refresh",
        fromDate,
        toDate,
        status: "success",
        totalFetched: events.length,
        totalInserted: inserted,
        totalUpdated: updated,
        totalSkipped: skipped,
        durationMs,
      },
    });

    return {
      success: true,
      fromDate,
      toDate,
      totalFetched: events.length,
      totalInserted: inserted,
      totalUpdated: updated,
      totalSkipped: skipped,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    return {
      success: false,
      fromDate,
      toDate,
      totalFetched: 0,
      totalInserted: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      durationMs,
      error: (error as Error).message,
    };
  }
}

// ── Historical backfill ────────────────────────────────────────
// Fetches past events so your DB has historical context.
// Run once after deployment. Chunks in 30-day windows.

export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export async function runEventBackfill(
  daysBack = 365,
  onBatchComplete?: BatchProgressFn,
): Promise<{ totalInserted: number; totalUpdated: number }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const universe = await loadUniverse();

  let totalInserted = 0;
  let totalUpdated = 0;

  const CHUNK = 30; // days per request
  const totalChunks = Math.ceil(daysBack / CHUNK);
  let chunksDone = 0;

  let cursor = new Date(today);
  cursor.setUTCDate(cursor.getUTCDate() - daysBack);

  console.log(
    `[EventBackfill] Starting ${daysBack}-day backfill in ${CHUNK}-day chunks…`,
  );

  while (cursor < today) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + CHUNK - 1);
    if (chunkEnd > today) chunkEnd.setTime(today.getTime());

    console.log(
      `[EventBackfill] Chunk: ${cursor.toDateString()} → ${chunkEnd.toDateString()}`,
    );

    try {
      const events = await fetchAllEvents(cursor, chunkEnd);
      const { inserted, updated } = await upsertEvents(events, universe);
      totalInserted += inserted;
      totalUpdated += updated;
    } catch (e) {
      console.error(`[EventBackfill] Chunk failed:`, e);
    }

    chunksDone++;
    cursor.setUTCDate(cursor.getUTCDate() + CHUNK);

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        chunksDone,
        totalChunks,
        `chunk ${chunksDone}/${totalChunks} (${cursor.toDateString()})`,
      );
      if (!shouldContinue) break;
    }

    await new Promise((r) => setTimeout(r, 2000)); // rate limit respect
  }

  console.log(
    `[EventBackfill] Complete — inserted: ${totalInserted}, updated: ${totalUpdated}`,
  );
  return { totalInserted, totalUpdated };
}
