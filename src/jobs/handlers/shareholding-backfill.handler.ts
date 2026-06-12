import type { JobContext } from "../context.js";
import type { ShareholdingBackfillPayload } from "../types.js";
import { runShareholdingBackfill } from "../../ingestions/shareholdings/ingest-shareholding.js";

export async function handleShareholdingBackfill(
  ctx: JobContext<ShareholdingBackfillPayload>,
) {
  const { quartersBack } = ctx.payload;

  await ctx.reportProgress(
    1,
    `Starting shareholding backfill — last ${quartersBack} quarters per stock`,
  );

  const result = await runShareholdingBackfill(
    quartersBack,
    async (done, total, label) => {
      const pct = 1 + Math.round((done / total) * 98);
      await ctx.reportProgress(pct, label);
      return !(await ctx.shouldCancel());
    },
    ctx.signal,
  );

  await ctx.reportProgress(
    100,
    `Done — ${result.totalInserted} quarters inserted across ${result.successStocks}/${result.totalStocks} stocks`,
  );

  return {
    quartersBack,
    totalStocks: result.totalStocks,
    successStocks: result.successStocks,
    failedStocks: result.failedStocks,
    totalInserted: result.totalInserted,
    totalSkipped: result.totalSkipped,
  };
}
