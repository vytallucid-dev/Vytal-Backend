// ─────────────────────────────────────────────────────────────
// MF ANALYTICS HANDLER (Step 10+11, Option B) — nightly compute-and-discard.
//
// HELD-NOT-SCORED: MF_ANALYTICS_DAILY is deliberately NOT a switch arm in scoring-triggers.ts,
// so a successful run hits `default: return null` → NO PG rescore is ever enqueued. A mutual
// fund gets NAV-derived analytics; it never gets a Vytal Health Score.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { MfAnalyticsDailyPayload } from "../types.js";
import { runMfAnalytics } from "../../ingestions/amfi/mf-analytics.js";
import { writeMfRunLog, MF_JOBS } from "../../ingestions/amfi/mf-run-log.js";

export async function handleMfAnalyticsDaily(ctx: JobContext<MfAnalyticsDailyPayload>) {
  await ctx.reportProgress(1, "Streaming 5 years of AMFI NAV history (folded, never stored)");

  const r = await runMfAnalytics();

  const windowFrom = r.asOfDate ? new Date(new Date(r.asOfDate).getTime() - 1856 * 86_400_000) : null;
  const windowTo = r.asOfDate ? new Date(r.asOfDate) : null;

  if (!r.ok) {
    // The write barrier held: nothing was written, so yesterday's analytics still stand.
    await writeMfRunLog({
      job: MF_JOBS.ANALYTICS_DAILY, status: "failed",
      schemesProcessed: r.schemesFolded, rowsFolded: r.rowsFolded,
      analyticsWritten: 0, faults: r.faults,
      windowFrom, windowTo, pulls: r.windows,
      durationMs: r.durationMs, error: r.abortReason ?? "unknown",
    });
    await ctx.reportProgress(100, `MF analytics REJECTED (${r.abortReason}) — nothing written, prior analytics intact`);
    throw new Error(`MF analytics rejected: ${r.abortReason}`);
  }

  await writeMfRunLog({
    job: MF_JOBS.ANALYTICS_DAILY,
    // `partial` = it completed and wrote, but recorded faults worth an operator's eye.
    status: r.faults > 0 ? "partial" : "success",
    schemesProcessed: r.schemesFolded,
    rowsFolded: r.rowsFolded,
    analyticsWritten: r.analyticsWritten,
    faults: r.faults,
    windowFrom, windowTo, pulls: r.windows,
    durationMs: r.durationMs,
    error: null,
  });

  const rfNote = r.riskFreeCovers.length
    ? `risk-free "${r.riskFreeIndex}" covers ${r.riskFreeCovers.join("/")}`
    : `NO risk-free horizon covered — Sharpe/Sortino honest-empty (deepen INDEX_PRICES_BACKFILL)`;

  // Group-3 (Step 18). The coverage number belongs in the run note, not just in the table: ~49% of
  // active schemes have NO benchmark by design (credit-bearing debt, FoFs, ambiguous thematics), and
  // an operator glancing at this line should see that as a stated OUTPUT rather than discover it
  // later as a suspicious pile of nulls.
  const g3Note =
    `Group-3: ${r.benchmarked} schemes benchmarked against ${r.benchmarkIndices} index series ` +
    `(READ-ONLY on index_prices — nothing pulled), ${r.betaComputed} with a 1Y beta; ` +
    `${r.unpairedReturns.toLocaleString()} fund returns unpairable (refused, never zero-filled)`;

  await ctx.reportProgress(
    100,
    `MF analytics complete — ${r.analyticsWritten} schemes written from ${r.rowsFolded.toLocaleString()} ` +
      `NAV rows folded across ${r.windows} windows (${(r.bytes / 1e6).toFixed(0)} MB streamed, ` +
      `${(r.durationMs / 1000).toFixed(0)}s); ${r.ranked} category ranks; ${rfNote}; ${g3Note}; ` +
      `${r.faults} fault(s). RAW NAV DISCARDED.`,
  );

  return r;
}
