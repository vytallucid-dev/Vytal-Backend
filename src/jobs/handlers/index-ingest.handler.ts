// ─────────────────────────────────────────────────────────────
// INDEX INGESTION HANDLERS  (DISPLAY-ONLY — NOT scored)
//
// Siblings of the equity daily-ingest-ops / price-backfill handlers.
// Invoked by the scheduler (cron → enqueueJob → worker) and by the
// admin backfill endpoint. They call the index ingest service and
// return its result for the job audit trail.
//
// NOTE: neither job type (INDEX_PRICES_DAILY / INDEX_PRICES_BACKFILL)
// is a switch arm in scoring-triggers.ts, so a successful run hits
// the `default: return null` branch → NO PG rescore is ever enqueued.
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import type { IndexPricesDailyPayload, IndexBackfillPayload } from "../types.js";
import {
  runDailyIndexIngest,
  runIndexBackfill,
} from "../../ingestions/indices/ingest-indices.js";

// ── Daily index ingest (self-healing, last few trading days) ──

export async function handleIndexPricesDaily(
  ctx: JobContext<IndexPricesDailyPayload>,
) {
  await ctx.reportProgress(1, "Starting EOD index ingest (last few trading days)");
  const results = await runDailyIndexIngest();
  const inserted = results.reduce((s, r) => s + r.totalInserted, 0);
  const ingestedDays = results
    .filter((r) => r.totalInserted > 0)
    .map((r) => r.indexDate.toISOString().slice(0, 10));
  await ctx.reportProgress(
    100,
    `EOD index ingest complete — ${inserted} rows across ${ingestedDays.length} day(s): ${ingestedDays.join(", ") || "none new"}`,
  );
  return results;
}

// ── Historical index backfill ─────────────────────────────────

export async function handleIndexBackfill(
  ctx: JobContext<IndexBackfillPayload>,
) {
  const { days } = ctx.payload;

  await ctx.reportProgress(1, `Starting EOD index backfill for last ${days} days`);

  await runIndexBackfill(days, async (done, total, date) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, `${date.toDateString()} — ${done}/${total} trading days`);
    const cancelled = await ctx.shouldCancel();
    return !cancelled; // false = abort backfill
  });

  await ctx.reportProgress(100, "Index backfill complete");

  return { days, status: "complete" };
}
