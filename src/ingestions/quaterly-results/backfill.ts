// File: src/ingestions/quaterly-results/backfill.ts (NEW)

import { prisma } from "../../db/prisma.js";
import { scanSymbol, scanUniverse, type ScanUniverseResult } from "./scan.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface BackfillOptions {
  fromQeDate?: Date;
  industries?: (
    | "non_financial"
    | "banking"
    | "nbfc"
    | "life_insurance"
    | "general_insurance"
  )[];
  limit?: number;
  delayMs?: number;
  onProgress?: (
    symbol: string,
    progress: {
      current: number;
      total: number;
      ingested: number;
      upgraded: number;
      refreshed: number;
      skipped: number;
      failed: number;
    },
  ) => void | Promise<void>;
}

/**
 * One-shot backfill across the universe for the v3 endpoint.
 *
 * Calls scanUniverse with going-forward source values
 * ("nse_xbrl_quarterly", "nse_xbrl_annual"). Defaults fromQeDate to
 * April 1, 2025.
 */
export async function backfillUniverse(
  options: BackfillOptions = {},
): Promise<ScanUniverseResult> {
  const fromQeDate = options.fromQeDate ?? new Date(Date.UTC(2025, 3, 1));

  console.log(
    `[backfill] starting going-forward backfill, fromQeDate=${fromQeDate.toISOString()}, ` +
      `industries=${options.industries?.join(",") ?? "all"}, limit=${options.limit ?? "none"}`,
  );

  const startedAt = Date.now();

  const result = await scanUniverse({
    industries: options.industries,
    limit: options.limit,
    delayMs: options.delayMs ?? 1500,
    perSymbol: { fromQeDate },
    onProgress: async (symbol, r, progress) => {
      console.log(
        `[backfill] ${progress.current}/${progress.total} ${symbol}: ` +
          `+${r.ingested} ingested, ${r.upgraded} upgraded, ${r.refreshed} refreshed, ` +
          `${r.skipped} skipped, ${r.failed} failed`,
      );
      if (options.onProgress) {
        await options.onProgress(symbol, {
          current: progress.current,
          total: progress.total,
          ingested: r.ingested,
          upgraded: r.upgraded,
          refreshed: r.refreshed,
          skipped: r.skipped,
          failed: r.failed,
        });
      }
    },
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[backfill] complete in ${(elapsedMs / 1000 / 60).toFixed(1)}min: ` +
      `${result.successfulSymbols}/${result.totalSymbols} symbols ok, ` +
      `${result.totalIngested} ingested, ${result.totalUpgraded} upgraded, ` +
      `${result.totalRefreshed} refreshed, ${result.failedSymbols} failed symbols`,
  );

  if (result.symbolErrors.length > 0) {
    console.log(`[backfill] failed symbols:`);
    for (const { symbol, error } of result.symbolErrors) {
      console.log(`  ${symbol}: ${error}`);
    }
  }

  return result;
}

/**
 * Backfill a specific list of symbols (e.g. for retrying failures from a previous run).
 */
export async function backfillSymbols(
  symbols: string[],
  options: BackfillOptions = {},
): Promise<ScanUniverseResult> {
  const fromQeDate = options.fromQeDate ?? new Date(Date.UTC(2025, 3, 1));
  const delayMs = options.delayMs ?? 1500;

  const result: ScanUniverseResult = {
    totalSymbols: symbols.length,
    successfulSymbols: 0,
    failedSymbols: 0,
    totalIngested: 0,
    totalUpgraded: 0,
    totalRefreshed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    symbolErrors: [],
    changedSymbols: [],
  };

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      const r = await scanSymbol(symbol, { fromQeDate });
      result.successfulSymbols++;
      result.totalIngested += r.ingested;
      result.totalUpgraded += r.upgraded;
      result.totalRefreshed += r.refreshed;
      result.totalSkipped += r.skipped;
      result.totalFailed += r.failed;
      // Same rule as scanUniverse: a rescore is warranted only when a column the SCORER
      // reads actually moved, not merely because a row was rewritten. See scan.ts.
      if (r.scoreRelevantChanged) result.changedSymbols.push(symbol);
      console.log(
        `[backfill] ${i + 1}/${symbols.length} ${symbol}: ok (+${r.ingested})`,
      );
    } catch (err) {
      result.failedSymbols++;
      result.symbolErrors.push({ symbol, error: String(err) });
      console.log(
        `[backfill] ${i + 1}/${symbols.length} ${symbol}: FAILED — ${err}`,
      );
    }
    if (i < symbols.length - 1) await sleep(delayMs);
  }

  return result;
}
