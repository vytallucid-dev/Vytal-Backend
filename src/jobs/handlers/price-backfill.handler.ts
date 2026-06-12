import type { JobContext } from "../context.js";
import type { PriceBackfillPayload } from "../types.js";
import { runPriceBackfill } from "../../ingestions/prices/ingest-prices.js";

export async function handlePriceBackfill(
  ctx: JobContext<PriceBackfillPayload>,
) {
  const { days } = ctx.payload;

  await ctx.reportProgress(1, `Starting EOD price backfill for last ${days} days`);

  await runPriceBackfill(days, async (done, total, date) => {
    // Report per-day progress so the frontend shows meaningful movement
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, `${date.toDateString()} — ${done}/${total} trading days`);
    // Honour cancellation between days
    const cancelled = await ctx.shouldCancel();
    return !cancelled; // false = abort backfill
  });

  await ctx.reportProgress(100, "Price backfill complete");

  return { days, status: "complete" };
}
