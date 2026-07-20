// ─────────────────────────────────────────────────────────────
// REIT / InvIT INGEST HANDLER (Step 14) — identity + price + distribution yield.
//
// HELD-NOT-SCORED: REIT_DAILY is deliberately NOT a switch arm in scoring-triggers.ts, so a
// successful run hits `default: return null` → NO peer-group rescore is ever enqueued. A trust is
// held, valued and shown — it never gets a Vytal Health Score. That score is an EQUITY judgement
// built on fundamentals (margins, ROCE, leverage, promoter pledge) that a REIT does not have and
// an InvIT reports on a different basis entirely. Scoring one would not be a stretch, it would be
// a category error.
//
// UNLIKE the ETF/MF handlers, this one is BOTH the identity load AND the price refresh — a trust
// trades, so its close changes every night. It is the only reason this job must run daily.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { ReitDailyPayload } from "../types.js";
import { runReitIngest } from "../../ingestions/reits/ingest-reits.js";

export async function handleReitDaily(ctx: JobContext<ReitDailyPayload>) {
  const t0 = Date.now();
  await ctx.reportProgress(1, "Fetching the NSE udiff BhavCopy (series RR/IV)");

  const r = await runReitIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity + r.errors.uniqueness;

  if (!r.ok) {
    await ctx.reportProgress(100, `REIT/InvIT ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`REIT ingest rejected: ${r.abortReason}`);
  }

  const nullReasons = Object.entries(r.yieldNullReasons)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");

  await ctx.reportProgress(
    100,
    `REIT/InvIT ingest complete (${r.priceDate}) — ${r.reits} REIT + ${r.invits} InvIT; ` +
      `${r.created} new, ${r.updated} updated; ${r.pricesInserted} price row(s) inserted; ` +
      `${r.yieldsWritten} yield(s) written, ${r.yieldsNull} honestly NULL` +
      (nullReasons ? ` (${nullReasons})` : "") +
      `; ${r.skipped.length} row(s) refused; ${errs} fault(s) recorded ` +
      `[${Date.now() - t0}ms]`,
  );

  return r;
}
