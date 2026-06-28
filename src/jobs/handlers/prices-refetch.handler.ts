// ─────────────────────────────────────────────────────────────
// PRICES_REFETCH HANDLER
//
// The async wrap of the (synchronous) runEodPriceIngest, exposed as the
// "re-fetch the feed for this date" resolution action — chosen by the admin for
// a FEED break (whole bhavcopy bad/missing), vs a manual fill for one bad value.
// Re-fetches the EOD bhavcopy for ONE date (idempotent upsert/skip-duplicates),
// then reuses the SAME universe-rescore policy the daily cron uses, so corrected
// prices flow into the scores. Pollable like any job (GET /admin/jobs/:id).
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import { JobCancelledError } from "../context.js";
import type { PricesRefetchPayload } from "../types.js";
import { JobTypes } from "../types.js";
import { runEodPriceIngest } from "../../ingestions/prices/ingest-prices.js";
import { maybeEnqueueRescoresForJob } from "../scoring-triggers.js";

export interface PricesRefetchResult {
  dateIso: string;
  success: boolean;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  rescore: { enqueued: number; pgIds: string[] } | null;
}

export async function handlePricesRefetch(
  ctx: JobContext<PricesRefetchPayload>,
): Promise<PricesRefetchResult> {
  const { dateIso } = ctx.payload;
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) throw new Error(`prices_refetch: bad dateIso "${dateIso}"`);

  await ctx.reportProgress(5, `re-fetching EOD bhavcopy for ${dateIso}`);
  if (await ctx.shouldCancel()) throw new JobCancelledError();

  const result = await runEodPriceIngest(date);
  await ctx.reportProgress(80, `re-fetched ${dateIso} — inserted ${result.totalInserted ?? 0}; triggering rescore`);

  // Reuse the daily cron's universe-rescore policy (idempotent; unchanged PGs no-op).
  let rescore: PricesRefetchResult["rescore"] = null;
  try {
    const out = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [result]);
    if (out) rescore = { enqueued: out.enqueued, pgIds: out.pgIds };
  } catch (e) {
    console.warn(`[prices_refetch] rescore trigger failed: ${(e as Error).message}`);
  }

  await ctx.reportProgress(100, `done — ${dateIso}: inserted ${result.totalInserted ?? 0}, skipped ${result.totalSkipped ?? 0}`);
  return {
    dateIso,
    success: result.success,
    totalFetched: result.totalFetched ?? 0,
    totalInserted: result.totalInserted ?? 0,
    totalSkipped: result.totalSkipped ?? 0,
    rescore,
  };
}
