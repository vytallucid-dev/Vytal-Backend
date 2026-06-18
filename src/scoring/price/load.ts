// File: src/scoring/price/load.ts
//
// GATING price loader for the Market pillar. This is the SINGLE chokepoint through
// which every Market sub-component obtains prices: it loads the raw daily closes and
// runs them through the §7.2 split/bonus pre-clean (clean.ts) before returning. No
// Market computation may read daily_prices directly — they call getCleanedCloses(),
// so un-cleaned prices can NEVER reach a sub-component (the spec's GATING guard).

import { prisma } from "../../db/prisma.js";
import { cleanPriceSeries, type CleanResult } from "./clean.js";
import type { DailyClose } from "./range.js";

export interface CleanedSeries {
  symbol: string;
  closes: DailyClose[];   // split/bonus-adjusted closes, ascending — the ONLY series Market sees
  report: CleanResult;    // decomposable clean report (events, corrections, quarantine)
}

/** Load raw daily closes for a stock and return the split/bonus-cleaned series. */
export async function getCleanedCloses(stockId: string, symbol: string): Promise<CleanedSeries> {
  const rows = await prisma.dailyPrice.findMany({
    where: { stockId },
    orderBy: { date: "asc" },
    select: { date: true, close: true },
  });
  const raw = rows.map((r) => ({ date: r.date, close: Number(r.close) }));
  const report = cleanPriceSeries(symbol, raw);
  return { symbol, closes: report.cleaned.map((c) => ({ date: c.date, close: c.close })), report };
}
