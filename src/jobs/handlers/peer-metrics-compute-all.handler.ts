import type { JobContext } from "../context.js";
import type { PeerMetricsComputeAllPayload } from "../types.js";
import { runManualPeerMetrics } from "../../ingestions/peer-metrics/peer-metrics.service.js";

export async function handlePeerMetricsComputeAll(
  ctx: JobContext<PeerMetricsComputeAllPayload>,
) {
  await ctx.reportProgress(1, "Starting peer metrics computation for all groups");

  const result = await runManualPeerMetrics({
    scope: "all",
    onBatchComplete: async (done, total, label) => {
      const pct = 1 + Math.round((done / total) * 98);
      await ctx.reportProgress(pct, label);
      return !(await ctx.shouldCancel());
    },
  });

  await ctx.reportProgress(100, `Done — ${result.computed} computed, ${result.skipped} skipped`);

  return {
    totalGroups: result.totalGroups,
    computed: result.computed,
    skipped: result.skipped,
    failed: result.failed,
    fiscalYear: result.fiscalYear,
    durationMs: result.durationMs,
  };
}
