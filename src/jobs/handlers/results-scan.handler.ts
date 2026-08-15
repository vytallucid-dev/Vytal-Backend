import type { JobContext } from "../context.js";
import type { ResultsScanPayload } from "../types.js";
import {
  scanSymbol,
  scanUniverse,
  scanUniverseRanged,
} from "../../ingestions/quaterly-results/scan.js";
import { nseClient } from "../../lib/client.js";

// Number of symbols processed between forced NSE session resets for
// universe/backfill runs. Keeps the shared singleton session fresh and
// avoids stale-cookie failures mid-way through a long crawl.
//
// ⚠ PER-SYMBOL PATH ONLY. The ranged path makes its NSE calls up front (a handful of paged
//   discovery requests) and then talks only to nsearchives, which carries no session — so a
//   mid-run reset there would cost an init for nothing.
const SESSION_RESET_EVERY_N = 3;

export async function handleResultsScan(
  ctx: JobContext<ResultsScanPayload>,
): Promise<object> {
  const { mode, symbol, fromQeDate, industries, limit, hoursBack, discovery } =
    ctx.payload;

  // ── Always start with a clean NSE session ─────────────────
  nseClient.resetSession();

  // ── Mode: symbol ─────────────────────────────────────────
  if (mode === "symbol") {
    if (!symbol) throw new Error(`mode=symbol requires payload.symbol`);

    if (await ctx.shouldCancel()) {
      return { mode, symbol, cancelled: true };
    }

    await ctx.reportProgress(1, `Scanning ${symbol}...`);
    const r = await scanSymbol(symbol);
    await ctx.reportProgress(100, `Done: ${symbol}`);

    return {
      mode,
      symbol,
      totalIngested: r.ingested,
      totalUpgraded: r.upgraded,
      totalRefreshed: r.refreshed,
      totalSkipped: r.skipped,
      totalFailed: r.failed,
      // A SCORE INPUT actually moved → trigger a rescore of this symbol's PG(s).
      // NOT "we wrote a row": the ingest rewrites on filingDate alone and blind-overwrites,
      // so a re-filing with identical numbers used to fan a full rescore out for nothing.
      // See scan.ts / score-relevant-diff.ts.
      totalScoreRelevantChanged: r.scoreRelevantChanged ? 1 : 0,
      changedSymbols: r.scoreRelevantChanged ? [symbol] : [],
    };
  }

  // ── Mode: universe or backfill ────────────────────────────
  const fromDate = fromQeDate ? new Date(fromQeDate) : undefined;

  // ── HOW THE CALLER CHOOSES ────────────────────────────────────────────────
  // Explicit `discovery` wins. Otherwise: a universe scan is RANGED (the recurring path), and a
  // backfill is PER-SYMBOL, because a backfill is explicitly asking for history and a window
  // cannot serve history — the window filters on BROADCAST date, so an old filing only appears in
  // the window in which it was actually broadcast.
  const discoveryMode: "ranged" | "per_symbol" =
    discovery ?? (mode === "universe" ? "ranged" : "per_symbol");

  if (mode === "universe" && discoveryMode === "ranged") {
    await ctx.reportProgress(1, "Starting ranged universe scan...");

    const summary = await scanUniverseRanged({
      hoursBack,
      industries,
      perSymbol: fromDate ? { fromQeDate: fromDate } : undefined,
      signal: ctx.signal,
      onProgress: async (sym, _r, progress) => {
        if (await ctx.shouldCancel()) return;
        const pct = 1 + Math.round((progress.current / progress.total) * 98);
        await ctx.reportProgress(
          pct,
          `${sym} (${progress.current}/${progress.total})`,
        );
      },
    });

    await ctx.reportProgress(100, "Scan complete");

    return {
      mode,
      discovery: discoveryMode,
      hoursBack: hoursBack ?? null,
      windowFrom: summary.windowFrom,
      windowTo: summary.windowTo,
      // What discovery actually cost, so a regression is visible in the job row itself rather than
      // inferred from wall-clock. The per-symbol path spent one request per symbol plus a forced
      // session re-init every 3 symbols; this reports the real number.
      discoveryRequests: summary.discoveryRequests,
      rowsReturned: summary.rowsReturned,
      financialsRows: summary.financialsRows,
      inUniverseRows: summary.inUniverseRows,
      symbolsWithFilings: summary.symbolsWithFilings,
      industries,
      totalSymbols: summary.totalSymbols,
      totalIngested: summary.totalIngested,
      totalUpgraded: summary.totalUpgraded,
      totalRefreshed: summary.totalRefreshed,
      totalSkipped: summary.totalSkipped,
      totalFailed: summary.totalFailed,
      failedSymbols: summary.symbolErrors.map((e) => e.symbol),
      changedSymbols: summary.changedSymbols,
    };
  }

  await ctx.reportProgress(1, `Starting ${mode} scan (per-symbol discovery)...`);

  const summary = await scanUniverse({
    industries,
    limit,
    delayMs: 1500,
    perSymbol: fromDate ? { fromQeDate: fromDate } : undefined,
    onProgress: async (sym, _r, progress) => {
      if (await ctx.shouldCancel()) return;
      const pct = 1 + Math.round((progress.current / progress.total) * 98);
      await ctx.reportProgress(
        pct,
        `${sym} (${progress.current}/${progress.total})`,
      );
      // Force-reset the NSE session after every SESSION_RESET_EVERY_N symbols
      // so long universe runs don't accumulate stale cookies.
      if (progress.current % SESSION_RESET_EVERY_N === 0) {
        nseClient.resetSession();
        console.log(
          `[results-scan] NSE session reset after ${progress.current} symbols`,
        );
      }
    },
  });

  await ctx.reportProgress(100, "Scan complete");

  return {
    mode,
    discovery: discoveryMode,
    fromQeDate,
    industries,
    limit,
    hoursBack,
    totalSymbols: summary.totalSymbols,
    totalIngested: summary.totalIngested,
    totalUpgraded: summary.totalUpgraded,
    totalRefreshed: summary.totalRefreshed,
    totalSkipped: summary.totalSkipped,
    totalFailed: summary.totalFailed,
    failedSymbols: summary.symbolErrors.map((e) => e.symbol),
    changedSymbols: summary.changedSymbols,
  };
}
