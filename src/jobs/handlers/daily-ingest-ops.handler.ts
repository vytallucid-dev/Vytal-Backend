// ─────────────────────────────────────────────────────────────
// DAILY / WEEKLY OPERATIONAL INGESTION HANDLERS
//
// These are invoked by the scheduler (cron → enqueueJob → worker).
// All call the existing ingestion service functions and return
// their result so the job record holds a useful audit trail.
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import type {
  EodPricesDailyPayload,
  DealsDailyIngestPayload,
  EventsWeeklyIngestPayload,
  EventsDailyRefreshPayload,
  ShareholdingQuarterlyPayload,
  ShareholdingSmartRefreshPayload,
  InsiderTradesDailyPayload,
} from "../types.js";

import { runEodPriceIngest } from "../../ingestions/prices/ingest-prices.js";
import { runDailyDealIngest } from "../../ingestions/block-deals/ingest-deals.js";
import {
  runWeeklyEventIngest,
  runDailyEventRefresh,
} from "../../ingestions/corporate-events/ingest-events.js";
import {
  runQuarterlyShareholdingIngest,
  runSmartShareholdingRefresh,
} from "../../ingestions/shareholdings/ingest-shareholding.js";
import { runDailyJob } from "../../ingestions/insider-trades/pit-jobs.js";

// ── EOD Prices ────────────────────────────────────────────────

export async function handleEodPricesDaily(
  ctx: JobContext<EodPricesDailyPayload>,
) {
  await ctx.reportProgress(1, "Starting EOD price ingest for today");
  const result = await runEodPriceIngest();
  await ctx.reportProgress(100, "EOD price ingest complete");
  return result;
}

// ── Block / Bulk Deals ────────────────────────────────────────

export async function handleDealsDailyIngest(
  ctx: JobContext<DealsDailyIngestPayload>,
) {
  await ctx.reportProgress(1, "Starting daily block deals ingest");
  const result = await runDailyDealIngest();
  await ctx.reportProgress(
    100,
    `Done — ${result.totalInserted} inserted, ${result.totalSkipped} skipped`,
  );
  return result;
}

// ── Corporate Events — weekly full fetch ─────────────────────

export async function handleEventsWeeklyIngest(
  ctx: JobContext<EventsWeeklyIngestPayload>,
) {
  await ctx.reportProgress(1, "Starting weekly corporate events ingest");
  const result = await runWeeklyEventIngest();
  await ctx.reportProgress(
    100,
    `Done — ${result.totalInserted} inserted, ${result.totalUpdated} updated`,
  );
  return result;
}

// ── Corporate Events — daily refresh ─────────────────────────

export async function handleEventsDailyRefresh(
  ctx: JobContext<EventsDailyRefreshPayload>,
) {
  await ctx.reportProgress(1, "Starting daily corporate events refresh");
  const result = await runDailyEventRefresh();
  await ctx.reportProgress(
    100,
    `Done — ${result.totalInserted} inserted, ${result.totalUpdated} updated`,
  );
  return result;
}

// ── Shareholding — quarterly full ingest ─────────────────────

export async function handleShareholdingQuarterly(
  ctx: JobContext<ShareholdingQuarterlyPayload>,
) {
  await ctx.reportProgress(1, "Starting quarterly shareholding ingest");
  const result = await runQuarterlyShareholdingIngest(async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    const cancelled = await ctx.shouldCancel();
    return !cancelled;
  }, ctx.signal);
  await ctx.reportProgress(100, "Quarterly shareholding ingest complete");
  return result;
}

// ── Shareholding — smart daily refresh ───────────────────────

export async function handleShareholdingSmartRefresh(
  ctx: JobContext<ShareholdingSmartRefreshPayload>,
) {
  await ctx.reportProgress(1, "Starting smart shareholding refresh");
  const result = await runSmartShareholdingRefresh(async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    const cancelled = await ctx.shouldCancel();
    return !cancelled;
  }, ctx.signal);
  await ctx.reportProgress(100, "Smart shareholding refresh complete");
  return result;
}

// ── Insider Trades — daily PIT refresh ───────────────────────

export async function handleInsiderTradesDaily(
  ctx: JobContext<InsiderTradesDailyPayload>,
) {
  await ctx.reportProgress(1, "Starting daily insider trades ingest (T and T-1)");
  await runDailyJob();
  await ctx.reportProgress(100, "Daily insider trades ingest complete");
  return { status: "complete" };
}
