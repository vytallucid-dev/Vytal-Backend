// ─────────────────────────────────────────────────────────────
// LEGACY BACKFILL JOB HANDLER
//
// Handles JobTypes.LEGACY_BACKFILL.
//
// Supports two modes:
//   mode="universe" — backfill all active stocks (with optional date/industry filters)
//   mode="symbol"   — backfill a single symbol
//
// Retry policy: maxAttempts=3 (see types.ts)
//
// DO NOT schedule on a cron. Trigger only via admin endpoint:
//   POST /api/v1/admin/legacy-backfill/universe
//   POST /api/v1/admin/legacy-backfill/symbol
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import type { LegacyBackfillPayload } from "../types.js";
import { JobCancelledError } from "../context.js";
import {
  backfillLegacyUniverse,
  backfillLegacySymbol,
} from "../../ingestions/quaterly-results/legacy/backfill-legacy.js";

export async function handleLegacyBackfill(
  ctx: JobContext<LegacyBackfillPayload>,
): Promise<object> {
  const { mode, symbol, fromDate, toDate, industries, limit } = ctx.payload;

  await ctx.reportProgress(1, `Starting legacy_backfill mode=${mode}`);

  if (mode === "symbol") {
    if (!symbol) {
      throw new Error(`mode=symbol requires payload.symbol`);
    }

    if (await ctx.shouldCancel()) {
      return { mode, symbol, cancelled: true };
    }

    await ctx.reportProgress(5, `Backfilling ${symbol}…`);

    const result = await backfillLegacySymbol(symbol, { fromDate, toDate });

    await ctx.reportProgress(100, `Done: ${symbol}`);

    return {
      mode,
      symbol,
      totalFilings: result.totalFilings,
      ingested: result.ingested,
      upgraded: result.upgraded,
      refreshed: result.refreshed,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
    };
  }

  // ── mode="universe" ──────────────────────────────────────

  const result = await backfillLegacyUniverse(
    { fromDate, toDate, industries, limit },
    async (done, total, sym) => {
      if (await ctx.shouldCancel()) {
        throw new JobCancelledError();
      }
      const pct = 1 + Math.round((done / total) * 98);
      await ctx.reportProgress(pct, `${sym} (${done}/${total})`);
    },
  );

  await ctx.reportProgress(100, "Scan complete");

  return {
    mode,
    fromDate,
    toDate,
    industries: industries ?? "all",
    limit: limit ?? "none",
    totalSymbols: result.totalSymbols,
    totalFilings: result.totalFilings,
    ingested: result.ingested,
    upgraded: result.upgraded,
    refreshed: result.refreshed,
    skipped: result.skipped,
    failed: result.failed,
    failedDetails: result.errors.slice(0, 50), // cap to avoid oversized job result
  };
}
