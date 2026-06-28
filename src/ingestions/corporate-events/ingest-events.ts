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
import {
  deduplicateEvents,
  fetchAllEvents,
  fetchCorporateActionsForSymbol,
  type EventRecord,
} from "./events.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  EVENTS_CRON,
  EVENTS_SOURCE,
  RECORD_DATE_MAX,
  DIV_NO_AMOUNT_MAX,
  BONUS_NO_RATIO_MAX,
  DIVIDEND_MAX,
  checkFetchFloor,
  checkBatchRate,
  checkDividendRange,
  checkEventDateImplausible,
  checkRecordBeforeEx,
  eventsRunRef,
} from "./events-guards.js";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ── GUARD 3: RANGE / validity (per-record, on write) ──
// Called only when an event is actually written (insert or material update),
// so unchanged weekly re-scans never re-flag known events.
async function flagEventRangeOnWrite(
  event: EventRecord,
  runLabel: string,
): Promise<void> {
  const entity = `${event.symbol}@${event.eventType}@${isoDay(event.eventDate)}`;
  const runRef = eventsRunRef(runLabel);

  if (checkDividendRange(event.dividendAmount)) {
    await reportIngestionError({
      source: EVENTS_SOURCE,
      cron: EVENTS_CRON,
      guardType: "range",
      targetTable: "CorporateEvent",
      targetField: "dividendAmount",
      targetEntity: entity,
      severity: "medium",
      resolutionPath: "admin_fill",
      expected: `dividendAmount in (0, ${DIVIDEND_MAX}] ₹/share`,
      observed: `dividendAmount=${event.dividendAmount}`,
      detail: "Dividend amount implausible — the subject regex likely grabbed the wrong number.",
      runRef,
    });
  }
  if (checkEventDateImplausible(event.eventDate, new Date())) {
    await reportIngestionError({
      source: EVENTS_SOURCE,
      cron: EVENTS_CRON,
      guardType: "range",
      targetTable: "CorporateEvent",
      targetField: "eventDate",
      targetEntity: entity,
      severity: "medium",
      resolutionPath: "source_code",
      expected: "event year in [2000, now+2]",
      observed: `eventDate=${isoDay(event.eventDate)}`,
      detail: "Implausible event date — a date-parse error.",
      runRef,
    });
  }
  if (checkRecordBeforeEx(event.exDate, event.recordDate)) {
    await reportIngestionError({
      source: EVENTS_SOURCE,
      cron: EVENTS_CRON,
      guardType: "range",
      targetTable: "CorporateEvent",
      targetField: "recordDate",
      targetEntity: entity,
      severity: "medium",
      resolutionPath: "source_code",
      expected: "recordDate ≥ exDate",
      observed: `exDate=${event.exDate ? isoDay(event.exDate) : null}, recordDate=${event.recordDate ? isoDay(event.recordDate) : null}`,
      detail: "Record date before ex date — impossible ordering; a date swap/parse error.",
      runRef,
    });
  }
}

// ── GUARDS 1 + 2: run-level COUNT + batch CLASSIFICATION null-rate ──
// Over the run's parsed events. Catches a parser break (whole batch
// re-parsed each run, so a format change spikes the rates) and a fetch
// collapse. Hooked in the recurring weekly/daily jobs.
async function runEventCoverageGuards(
  events: EventRecord[],
  runLabel: string,
): Promise<void> {
  const base = {
    source: EVENTS_SOURCE,
    cron: EVENTS_CRON,
    targetTable: "CorporateEvent",
    runRef: eventsRunRef(runLabel),
  } as const;

  // GUARD 1: COUNT — fetch collapse.
  if (checkFetchFloor(events.length)) {
    await reportIngestionError({
      ...base,
      guardType: "count",
      severity: "high",
      resolutionPath: "source_code",
      expected: `≥10 events fetched`,
      observed: `${events.length} fetched`,
      detail: `${runLabel} fetch collapsed — a date-format break (all skipped) or NSE down.`,
    });
  }

  // GUARD 2: CLASSIFICATION null-rate.
  const n = events.length;
  const recordDateRate = checkBatchRate(
    events.filter((e) => e.eventType === "record_date").length,
    n,
    RECORD_DATE_MAX,
  );
  if (recordDateRate != null) {
    await reportIngestionError({
      ...base,
      guardType: "null_rate",
      targetField: "eventType",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `record_date (catch-all) ≤ ${(RECORD_DATE_MAX * 100).toFixed(0)}% (normal 0.9%)`,
      observed: `${(recordDateRate * 100).toFixed(1)}% classified record_date`,
      detail: "Subjects falling through to the catch-all — the subject parser likely broke.",
    });
  }

  const divEvents = events.filter((e) => e.eventType === "dividend");
  const divNoAmountRate = checkBatchRate(
    divEvents.filter((e) => e.dividendAmount == null).length,
    divEvents.length,
    DIV_NO_AMOUNT_MAX,
  );
  if (divNoAmountRate != null) {
    await reportIngestionError({
      ...base,
      guardType: "null_rate",
      targetField: "dividendAmount",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `dividend null-amount ≤ ${(DIV_NO_AMOUNT_MAX * 100).toFixed(0)}% (normal 10.2%)`,
      observed: `${(divNoAmountRate * 100).toFixed(1)}% of dividends have no amount (${divEvents.length} dividends)`,
      detail: "Dividend amount regex failing across the batch — a subject-format change.",
    });
  }

  const bonusEvents = events.filter((e) => e.eventType === "bonus");
  const bonusNoRatioRate = checkBatchRate(
    bonusEvents.filter((e) => e.bonusRatio == null).length,
    bonusEvents.length,
    BONUS_NO_RATIO_MAX,
  );
  if (bonusNoRatioRate != null) {
    await reportIngestionError({
      ...base,
      guardType: "null_rate",
      targetField: "bonusRatio",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `bonus null-ratio ≤ ${(BONUS_NO_RATIO_MAX * 100).toFixed(0)}% (normal 3.6%)`,
      observed: `${(bonusNoRatioRate * 100).toFixed(1)}% of bonuses have no ratio (${bonusEvents.length} bonuses)`,
      detail: "Bonus ratio regex failing across the batch — a subject-format change.",
    });
  }
}

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
  runLabel: string,
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
      // Update if anything material changed (dividendAmount, exDate, splitRatio, etc.)
      const needsUpdate =
        existing.exDate?.getTime() !== event.exDate?.getTime() ||
        existing.recordDate?.getTime() !== event.recordDate?.getTime() ||
        parseFloat(existing.dividendAmount?.toString() ?? "0") !==
          (event.dividendAmount ?? 0) ||
        existing.description !== event.description ||
        existing.splitRatio !== event.splitRatio ||
        existing.bonusRatio !== event.bonusRatio;

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
        await flagEventRangeOnWrite(event, runLabel); // on write only
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
      await flagEventRangeOnWrite(event, runLabel); // on write only
    }
  }

  return { inserted, updated, skipped };
}

// ── Weekly job ─────────────────────────────────────────────────
// Fetches next 30 days of calendar events + full corporate-actions history per symbol.
// Run every Sunday at 7:30 AM IST to have the week's events ready.
// NSE dropped date-range support on /api/corporates-corporateActions, so we now
// fetch corporate-actions per-symbol (one call per universe stock).

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
    // Load universe and calendar events in parallel (calendar still supports date-range)
    const [universe, calendarEvents] = await Promise.all([
      loadUniverse(),
      fetchAllEvents(fromDate, toDate),
    ]);

    console.log(`[EventIngest] Calendar events fetched: ${calendarEvents.length}`);

    // Corporate actions: per-symbol (NSE no longer supports date-range filtering)
    const actionEvents: EventRecord[] = [];
    for (const symbol of universe.keys()) {
      const acts = await fetchCorporateActionsForSymbol(symbol);
      actionEvents.push(...acts);
    }

    console.log(`[EventIngest] Corporate-actions fetched: ${actionEvents.length} across ${universe.size} symbols`);

    const events = deduplicateEvents([...actionEvents, ...calendarEvents]);
    console.log(`[EventIngest] Total after dedup: ${events.length}`);

    await runEventCoverageGuards(events, "weekly");
    const { inserted, updated, skipped } = await upsertEvents(events, universe, "weekly");
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
// Run daily to catch rescheduled calendar events (meetings, earnings dates).
// Fetches the next 7 days from event-calendar only — very fast, ~1 API call.
// Corporate-actions history is refreshed by the weekly job (per-symbol).

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

    await runEventCoverageGuards(events, "daily_refresh");
    const { inserted, updated, skipped } = await upsertEvents(events, universe, "daily_refresh");
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
// Fetches full corporate-actions history per universe stock.
// NSE no longer supports date-range filtering on corporates-corporateActions —
// per-symbol is the only mode that returns data. One call per stock gives the
// full history NSE holds for that symbol (dividends, splits, bonuses, etc.).
// The daysBack param is retained for the job interface but no longer filters
// the NSE query; NSE returns all available history regardless.

export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export async function runEventBackfill(
  _daysBack = 365,
  onBatchComplete?: BatchProgressFn,
): Promise<{ totalInserted: number; totalUpdated: number }> {
  const universe = await loadUniverse();
  const symbols = Array.from(universe.keys());
  const total = symbols.length;

  let totalInserted = 0;
  let totalUpdated = 0;

  console.log(
    `[EventBackfill] Starting per-symbol corporate-actions fetch for ${total} stocks…`,
  );

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    console.log(`[EventBackfill] ${i + 1}/${total} — ${symbol}`);

    try {
      const events = await fetchCorporateActionsForSymbol(symbol);
      const { inserted, updated } = await upsertEvents(events, universe, "backfill");
      totalInserted += inserted;
      totalUpdated += updated;
    } catch (e) {
      console.error(`[EventBackfill] ${symbol} failed:`, e);
    }

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        i + 1,
        total,
        `${symbol} (${i + 1}/${total})`,
      );
      if (!shouldContinue) break;
    }
  }

  console.log(
    `[EventBackfill] Complete — inserted: ${totalInserted}, updated: ${totalUpdated}`,
  );
  return { totalInserted, totalUpdated };
}
