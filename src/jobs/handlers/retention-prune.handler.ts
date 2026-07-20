// ─────────────────────────────────────────────────────────────
// RETENTION_PRUNE HANDLER
//
// Runs the config-driven retention engine as a tracked BackgroundJob. The engine
// reads the `retention_policy` table, clamps every limit UP to its floor, applies
// the named exemptions, and (live only) executes the deletes in the enforced
// score-layer cascade order. The full per-table report becomes the job `result`.
//
// dryRun comes from the payload — explicit, never defaulted at this layer. With
// dryRun=true the engine issues zero mutating statements (counts only), so this
// handler is safe to run at any time to produce the projection.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { RetentionPrunePayload } from "../types.js";
import { runRetention } from "../../retention/engine.js";

export async function handleRetentionPrune(ctx: JobContext<RetentionPrunePayload>) {
  const dryRun = ctx.payload.dryRun;
  await ctx.reportProgress(2, `${dryRun ? "Dry-run" : "LIVE"} retention pass starting`);

  const report = await runRetention({
    dryRun,
    onProgress: (pct, note) => ctx.reportProgress(Math.min(98, pct), note),
  });

  await ctx.reportProgress(
    100,
    `${dryRun ? "Dry-run" : "Prune"} complete — ${dryRun ? report.totalMatched + " rows would delete" : report.totalDeleted + " rows deleted"} across ${report.results.length} tables · ${report.clampsFired} clamp(s)`,
  );
  return report;
}
