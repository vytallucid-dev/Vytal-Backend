import {
    runManualFetch
} from "../../ingestions/insider-trades/pit-jobs.js";
import type { JobContext } from "../context.js";
import type { InsiderTradesBackfillPayload } from "../types.js";

export async function handleInsiderTradesBackfill(
  ctx: JobContext<InsiderTradesBackfillPayload>,
) {
  const { fromDate, toDate } = ctx.payload;

  await ctx.reportProgress(
    1,
    `Starting insider trades backfill: ${fromDate} → ${toDate}`,
  );

  // Use runManualFetch so the payload's date range is actually honoured.
  // The old runBackfillJob() read from process.argv and ignored the payload.
  const results = await runManualFetch(
    new Date(fromDate),
    new Date(toDate),
    async (done, total, label) => {
      const pct = 1 + Math.round((done / total) * 98);
      await ctx.reportProgress(pct, label);
      return !(await ctx.shouldCancel());
    },
    ctx.signal,
  );

  const totalInserted = results.reduce((s, r) => s + r.totalInserted, 0);
  const totalSkipped = results.reduce((s, r) => s + r.totalSkipped, 0);

  await ctx.reportProgress(
    100,
    `Done — ${totalInserted} inserted, ${totalSkipped} skipped`,
  );

  return {
    fromDate,
    toDate,
    chunks: results.length,
    totalInserted,
    totalSkipped,
    totalFiltered: results.reduce((s, r) => s + (r.totalFiltered ?? 0), 0),
  };
}
