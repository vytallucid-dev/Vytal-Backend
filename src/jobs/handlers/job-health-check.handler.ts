// ─────────────────────────────────────────────────────────────
// JOB_HEALTH_CHECK HANDLER — the nightly operations report.
//
// Thin by design: every decision lives in health/check.ts. This maps the report onto the
// existing BackgroundJob lifecycle and nothing else.
//
// ★ THE JOB RESULT *IS* THE PERSISTED RECORD. There is no health-report table, and that is
//   a decision rather than an omission: background_jobs already has a retention policy
//   (30d, terminal rows only), an admin read path, and the run history the report is about.
//   A second table would need its own retention rule and would become a second place to
//   look for the same night. GET /admin/jobs/health reads the newest succeeded row of this
//   type; that is the whole storage layer.
//
// ⚠ THE JOB SUCCEEDS EVEN WHEN THE REPORT IS CRITICAL, and that distinction matters.
//   "The health check ran and found problems" and "the health check did not run" are
//   different operational facts, and collapsing them would make the detector's own failure
//   look like a detection. A thrown handler here would mean the FORMER hides the LATTER —
//   so findings go in the result, and only a genuine inability to produce a report throws.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { JobHealthCheckPayload } from "../types.js";
import { runHealthCheck, logHealthReport } from "../health/check.js";

export async function handleJobHealthCheck(ctx: JobContext<JobHealthCheckPayload>) {
  const { windowHours, lookbackDays, asOf } = ctx.payload ?? {};
  await ctx.reportProgress(5, "Deriving expected cron firings from the scheduler registry");

  const report = await runHealthCheck({
    now: asOf ? new Date(asOf) : undefined,
    windowHours,
    lookbackDays,
  });

  await ctx.reportProgress(90, `Report built — ${report.severity}: ${report.headline}`);
  logHealthReport(report);
  await ctx.reportProgress(100, report.headline);

  return report;
}
