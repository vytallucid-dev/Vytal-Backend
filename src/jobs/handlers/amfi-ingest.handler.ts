// ─────────────────────────────────────────────────────────────
// AMFI MUTUAL-FUND INGEST HANDLER (Step 9) — identity + current NAV.
//
// HELD-NOT-SCORED: AMFI_NAV_DAILY is deliberately NOT a switch arm in scoring-triggers.ts,
// so a successful run hits `default: return null` → NO PG rescore is ever enqueued. A mutual
// fund gets a native rating later; it never gets a Vytal Health Score.
//
// STEP 10: retro-fitted with a RUN-LOG. This cron shipped with none — it ran nightly and
// nobody could see that it had. Every other pipeline in this codebase is observable; now so
// is this one.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { AmfiNavDailyPayload } from "../types.js";
import { runAmfiNavIngest } from "../../ingestions/amfi/ingest-amfi.js";
import { writeMfRunLog, MF_JOBS } from "../../ingestions/amfi/mf-run-log.js";

export async function handleAmfiNavDaily(ctx: JobContext<AmfiNavDailyPayload>) {
  const t0 = Date.now();
  await ctx.reportProgress(1, "Fetching AMFI NAVAll.txt (whole MF universe, one file)");

  const r = await runAmfiNavIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity + r.errors.uniqueness;
  const navDate = r.maxNavDate ? new Date(r.maxNavDate) : null;

  if (!r.ok) {
    await writeMfRunLog({
      job: MF_JOBS.NAV_DAILY,
      status: "failed",
      faults: errs,
      durationMs: Date.now() - t0,
      error: r.abortReason ?? "unknown",
    });
    await ctx.reportProgress(100, `AMFI ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`AMFI ingest rejected: ${r.abortReason}`);
  }

  await writeMfRunLog({
    job: MF_JOBS.NAV_DAILY,
    // `partial` = it landed, but recorded faults worth an operator's eye.
    status: errs > 0 ? "partial" : "success",
    schemesProcessed: r.candidates,
    rowsFolded: r.classRows,
    analyticsWritten: r.created + r.updated,
    faults: errs,
    windowFrom: navDate,
    windowTo: navDate,
    pulls: 1, // ONE file carries the whole universe — that is the point of this feed
    durationMs: Date.now() - t0,
    error: null,
  });

  await ctx.reportProgress(
    100,
    `AMFI ingest complete — ${r.created} new, ${r.updated} updated ` +
      `(${r.activeRows} active / ${r.staleRows} dormant, newest NAV ${r.maxNavDate}); ` +
      `${r.dormancyFlips} dormancy flip(s); ` +
      `${r.honestEmptySkips} absent-plan cells skipped (not faults); ${errs} fault(s) recorded`,
  );

  return r;
}
