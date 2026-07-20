// ─────────────────────────────────────────────────────────────
// CORPORATE BONDS HANDLER (Step 17) — NCDs, debentures, municipal bonds.
//
// The fifth lane over the NSE udiff BhavCopy (trusts → ETF prices → govt → bonds), and a SEPARATE
// job for the same reason all of those are: the lanes must fail, retry and get triaged
// independently. A problem loading corporate debt must never be able to take REIT identity, ETF
// pricing or government paper down with it.
//
// HELD-NOT-SCORED: CORPORATE_BONDS_DAILY is deliberately NOT a switch arm in scoring-triggers.ts, so
// a successful run hits `default: return null` → NO rescore is ever enqueued. A bond is held, valued
// and shown; it is never scored. The Vytal Health Score is an EQUITY judgement built on fundamentals
// (margins, ROCE, leverage, promoter pledge). Handing one to an NCD is not a stretch — it is a
// category error, and the bond's actual key signal (its CREDIT RATING) is a number we do not even
// have.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { CorporateBondsDailyPayload } from "../types.js";
import { runBondIngest } from "../../ingestions/corporate-bonds/ingest-bonds.js";

export async function handleCorporateBondsDaily(ctx: JobContext<CorporateBondsDailyPayload>) {
  await ctx.reportProgress(1, "Fetching the NSE udiff BhavCopy (corporate debt — fenced on the ISIN, not the series)");

  const r = await runBondIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity + r.errors.uniqueness + r.errors.null_rate;

  if (!r.ok) {
    await ctx.reportProgress(100, `Corporate bonds ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`Corporate bonds ingest rejected: ${r.abortReason}`);
  }

  await ctx.reportProgress(
    100,
    `Corporate bonds complete (${r.priceDate}, ${r.sessions.length} sessions) — ` +
      `${r.instruments} bonds ${JSON.stringify(r.bySecurityType)}; ` +
      `${r.created} new, ${r.updated} updated; ${r.pricesInserted} price row(s); ` +
      `coupon ${r.couponParsed}/${r.couponExpected} (${r.zeroCoupon} zero-coupon), ` +
      `maturity-year ${r.maturityYearParsed}, exact maturity ${r.maturityDateParsed}, ` +
      `issuer ${r.issuerResolved} (by ISIN-stem join); rating 0 — NOT sourceable, honest-null; ` +
      `${r.unrecognised.length} unrecognised ISIN type(s) FAULTED (never silently dropped); ` +
      `${r.skipped.length} refused; ${errs} fault(s) [${r.durationMs}ms]`,
  );

  return r;
}
