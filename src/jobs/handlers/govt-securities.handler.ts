// ─────────────────────────────────────────────────────────────
// GOVERNMENT SECURITIES HANDLER (Step 15) — G-secs, T-bills, SDLs, Sovereign Gold Bonds.
//
// The third lane over the NSE udiff BhavCopy (after the trusts of Step 14 and the ETF prices of
// Step 14.5), and a SEPARATE job for the same reason both of those are: the three must fail, retry
// and get triaged independently. A problem loading government paper must never be able to take REIT
// identity or ETF pricing down with it.
//
// HELD-NOT-SCORED: GOVT_SECURITIES_DAILY is deliberately NOT a switch arm in scoring-triggers.ts, so
// a successful run hits `default: return null` → NO rescore is ever enqueued. A government bond is
// held, valued and shown — it is never scored. The Vytal Health Score is an EQUITY judgement built
// on fundamentals (margins, ROCE, leverage, promoter pledge); handing one to a T-bill would not be a
// stretch, it would be a category error.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { GovtSecuritiesDailyPayload } from "../types.js";
import { runGovtIngest } from "../../ingestions/govt-securities/ingest-govt.js";

export async function handleGovtSecuritiesDaily(ctx: JobContext<GovtSecuritiesDailyPayload>) {
  await ctx.reportProgress(1, "Fetching the NSE udiff BhavCopy (series GS / TB / GB / SG)");

  const r = await runGovtIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity + r.errors.uniqueness + r.errors.null_rate;

  if (!r.ok) {
    await ctx.reportProgress(100, `Government securities ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`Government securities ingest rejected: ${r.abortReason}`);
  }

  await ctx.reportProgress(
    100,
    `Government securities complete (${r.priceDate}, ${r.sessions.length} sessions) — ` +
      `${r.instruments} instruments (${r.gsec} gsec + ${r.sgb} sgb) ${JSON.stringify(r.bySeries)}; ` +
      `${r.created} new, ${r.updated} updated; ${r.pricesInserted} price row(s); ` +
      `coupon parsed ${r.couponParsed}/${r.couponExpected}, maturity-year ${r.maturityYearParsed}, ` +
      `exact maturity ${r.maturityDateParsed} (T-bills only — the rest is not in the feed and is not invented); ` +
      `${r.skipped.length} refused; ${errs} fault(s) [${r.durationMs}ms]`,
  );

  return r;
}
