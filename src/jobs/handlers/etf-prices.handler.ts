// ─────────────────────────────────────────────────────────────
// ETF MARKET-PRICE HANDLER (Step 14.5) — the traded close of a listed fund.
//
// Sibling of reit-ingest.handler: same NSE udiff BhavCopy, the EQ-series rows instead of RR/IV.
// A SEPARATE job (not a flag on the trust lane) so the two fail and retry independently — an ETF
// pricing problem must never take REIT/InvIT identity down with it.
//
// HELD-NOT-SCORED: ETF_PRICES_DAILY is deliberately NOT a switch arm in scoring-triggers.ts, so a
// successful run hits `default: return null` → NO rescore is ever enqueued. An ETF is now held,
// VALUED (at its traded close) and shown — it is still never scored. Pricing something is not the
// same as judging it.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { EtfPricesDailyPayload } from "../types.js";
import { runEtfPriceIngest } from "../../ingestions/etf-prices/ingest-etf-prices.js";

export async function handleEtfPricesDaily(ctx: JobContext<EtfPricesDailyPayload>) {
  await ctx.reportProgress(1, "Fetching the NSE udiff BhavCopy (EQ-series ETF rows)");

  const r = await runEtfPriceIngest();
  const errs = r.errors.shape + r.errors.count + r.errors.validity;

  if (!r.ok) {
    await ctx.reportProgress(100, `ETF price ingest REJECTED (${r.abortReason}) — nothing written`);
    throw new Error(`ETF price ingest rejected: ${r.abortReason}`);
  }

  await ctx.reportProgress(
    100,
    `ETF prices complete (${r.priceDate}) — ${r.matched}/${r.catalogued} catalogued ETFs priced ` +
      `from the exchange; ${r.unlisted} not listed by NSE (honest NULL — they fall back to their AMFI NAV); ` +
      `${r.pricesInserted} price row(s) inserted, ${r.snapshotsUpdated} snapshot(s) advanced; ` +
      `${errs} fault(s) recorded [${r.durationMs}ms]`,
  );

  return r;
}
