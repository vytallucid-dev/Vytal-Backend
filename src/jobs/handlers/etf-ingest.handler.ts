// ─────────────────────────────────────────────────────────────
// ETF INGEST HANDLER (Step 13) — identity + current NAV + the NSE ticker.
//
// The sibling of amfi-ingest.handler: the SAME AMFI file, the 4 ETF sections Step 9 excluded.
//
// HELD-NOT-SCORED: ETF_NAV_DAILY is deliberately NOT a switch arm in scoring-triggers.ts, so a
// successful run hits `default: return null` → NO PG rescore is ever enqueued. An ETF is held,
// valued and richly analysed (the nightly fold computes its returns/vol/Sharpe/drawdown from
// NAV, exactly as it does for a fund) — it never gets a Vytal Health Score. That score is an
// EQUITY judgement built on fundamentals an ETF does not have.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { EtfNavDailyPayload } from "../types.js";
import { runEtfNavIngest } from "../../ingestions/amfi/ingest-amfi.js";
import { writeMfRunLog, MF_JOBS } from "../../ingestions/amfi/mf-run-log.js";

export async function handleEtfNavDaily(ctx: JobContext<EtfNavDailyPayload>) {
  const t0 = Date.now();
  await ctx.reportProgress(1, "Fetching AMFI NAVAll.txt (ETF sections) + the NSE ticker list");

  const r = await runEtfNavIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity + r.errors.uniqueness;
  const navDate = r.maxNavDate ? new Date(r.maxNavDate) : null;

  if (!r.ok) {
    await writeMfRunLog({
      job: MF_JOBS.ETF_NAV_DAILY,
      status: "failed",
      faults: errs,
      durationMs: Date.now() - t0,
      error: r.abortReason ?? "unknown",
    });
    await ctx.reportProgress(100, `ETF ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`ETF ingest rejected: ${r.abortReason}`);
  }

  await writeMfRunLog({
    job: MF_JOBS.ETF_NAV_DAILY,
    // `partial` = it landed, but recorded faults worth an operator's eye. An NSE ticker-join
    // failure lands here: identity is fine, but new ETFs will have no symbol until it is fixed.
    status: errs > 0 ? "partial" : "success",
    schemesProcessed: r.candidates,
    rowsFolded: r.classRows,
    analyticsWritten: r.created + r.updated,
    faults: errs,
    windowFrom: navDate,
    windowTo: navDate,
    pulls: 2, // the AMFI file + the NSE ticker list
    durationMs: Date.now() - t0,
    error: null,
  });

  await ctx.reportProgress(
    100,
    `ETF ingest complete — ${r.created} new, ${r.updated} updated ` +
      `(${r.activeRows} active / ${r.staleRows} dormant, newest NAV ${r.maxNavDate}); ` +
      `${r.tickersResolved} NSE ticker(s) resolved, ${r.tickersMissing} honestly NULL ` +
      `(BSE-listed or matured — not a fault); ` +
      `${r.dormancyFlips} dormancy flip(s); ${errs} fault(s) recorded`,
  );

  return r;
}
