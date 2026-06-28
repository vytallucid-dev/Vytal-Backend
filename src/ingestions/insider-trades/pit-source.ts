// PIT V2.0 fetch+parse pipeline.
//
// Turns a date range into a ParseResult (the shape the ingester consumes):
//   1. fetch the filing index (gg endpoint, one cheap call)
//   2. filter to our stock universe BEFORE any XBRL fetch
//   3. fetch + parse each in-universe filing's XBRL into disclosure rows
//   4. normalise every row into an InsiderTradeNormalized record
//
// One filing can yield multiple records (one per transaction context).

import { fetchFilingIndexForRange, fetchFilingXbrl } from "./nse-pit-fetcher.js";
import { parseFilingXbrlRows } from "./pit-xbrl-parser.js";
import { normaliseXbrlRow } from "./pit-parser.js";
import type { ParseResult } from "./pit-parser.js";
import type { InsiderTradeNormalized } from "./insider-types.js";

// How many XBRL documents to fetch in parallel from the nsearchives CDN.
const XBRL_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  const pool = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(pool);
  return results;
}

export async function fetchAndParseInsiderTrades(
  fromDate: Date,
  toDate: Date,
  stockMap: Map<string, string>, // symbol(upper) → stockId
  signal?: AbortSignal,
): Promise<ParseResult> {
  const { filings, malformed } = await fetchFilingIndexForRange(fromDate, toDate, signal);
  const totalRaw = filings.length;

  // Universe filter first — only fetch XBRL for stocks we track.
  const inUniverse = filings.filter((f) => f.symbol && stockMap.has(f.symbol.trim().toUpperCase()));
  const filteredCount = totalRaw - inUniverse.length;

  if (inUniverse.length > 0) {
    console.log(`[PitSource] ${inUniverse.length}/${totalRaw} filings in universe — fetching XBRL`);
  }

  let skippedCount = 0;
  const records: InsiderTradeNormalized[] = [];

  const perFiling = await mapWithConcurrency(
    inUniverse,
    XBRL_CONCURRENCY,
    async (filing): Promise<InsiderTradeNormalized[]> => {
      if (signal?.aborted) return [];
      const symbol = filing.symbol.trim().toUpperCase();
      const stockId = stockMap.get(symbol)!;
      try {
        const xml = await fetchFilingXbrl(filing.xmlFileName, signal);
        const rows = parseFilingXbrlRows(xml);
        if (rows.length === 0) {
          console.warn(`[PitSource] No disclosure rows in XBRL for ${symbol} (appId ${filing.appId})`);
          skippedCount++;
          return [];
        }
        const out: InsiderTradeNormalized[] = [];
        for (const row of rows) {
          const rec = normaliseXbrlRow(filing, row, stockId, symbol);
          if (rec) out.push(rec);
          else skippedCount++;
        }
        return out;
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        console.error(`[PitSource] XBRL fetch/parse failed for ${symbol} (appId ${filing.appId}): ${(err as Error).message}`);
        skippedCount++;
        return [];
      }
    },
  );

  for (const arr of perFiling) records.push(...arr);

  return { records, skippedCount, filteredCount, totalRaw, feedMalformed: malformed };
}
