import type { JobContext } from "../context.js";
import type { EventsBackfillPayload } from "../types.js";
import { runEventBackfill } from "../../ingestions/corporate-events/ingest-events.js";

export async function handleEventsBackfill(
  ctx: JobContext<EventsBackfillPayload>,
) {
  const { days } = ctx.payload;

  await ctx.reportProgress(1, `Starting corporate events backfill for last ${days} days`);

  const result = await runEventBackfill(days, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    return !(await ctx.shouldCancel());
  });

  await ctx.reportProgress(100, `Done — ${result.totalInserted} inserted, ${result.totalUpdated} updated`);

  return {
    days,
    totalInserted: result.totalInserted,
    totalUpdated: result.totalUpdated,
  };
}
