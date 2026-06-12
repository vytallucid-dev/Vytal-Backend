import type { JobContext } from "../context.js";
import type { DealsBackfillPayload } from "../types.js";
import { runBackfillDealIngest } from "../../ingestions/block-deals/ingest-deals.js";

export async function handleDealsBackfill(
  ctx: JobContext<DealsBackfillPayload>,
) {
  const { days } = ctx.payload;

  await ctx.reportProgress(1, `Starting deals backfill for last ${days} days`);

  const result = await runBackfillDealIngest(days);

  await ctx.reportProgress(100, `Done — ${result.totalInserted} inserted, ${result.totalSkipped} skipped`);

  return {
    days,
    success: result.success,
    totalFetched: result.totalFetched,
    totalInserted: result.totalInserted,
    totalSkipped: result.totalSkipped,
    durationMs: result.durationMs,
    error: result.error,
  };
}
