import { prisma } from "../../../db/prisma.js";
import { nseClient } from "../../../lib/client.js";
import {
  fetchFilingsList,
  fetchXbrlFile,
  groupFilingsByQuarter,
  parseNseFilingDate,
  pickBestFilingForQuarter,
} from "./discovery-legacy.js";
import {
  parseQuarterlyResultXbrl,
  parseAnnualResultXbrl,
} from "./parser-legacy-common.js";
import {
  adaptV2ToDispatchableQuarterly,
  adaptV2ToDispatchableAnnual,
} from "./adapter.js";
import {
  dispatchQuarterlyIngest,
  dispatchAnnualIngest,
} from "../ingesters/dispatch.js";

const QUARTERLY_LEGACY_SOURCE = "nse_xbrl_quarterly_legacy";
const ANNUAL_LEGACY_SOURCE = "nse_xbrl_annual_legacy";
const BATCH_SIZE = 3;
const SESSION_RESET_EVERY_N = 3;

type IndustryType =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

export interface LegacyBackfillOpts {
  fromDate?: string;
  toDate?: string;
  industries?: IndustryType[];
  limit?: number;
}

export interface SymbolBackfillOpts {
  fromDate?: string;
  toDate?: string;
}

export interface LegacyBackfillResult {
  totalSymbols: number;
  totalFilings: number;
  ingested: number;
  upgraded: number;
  refreshed: number;
  skipped: number;
  failed: number;
  errors: Array<{ symbol: string; filing: string; error: string }>;
}

export type BackfillProgressCallback = (
  done: number,
  total: number,
  symbol: string,
) => Promise<void> | void;

export async function backfillLegacyUniverse(
  opts: LegacyBackfillOpts = {},
  onProgress?: BackfillProgressCallback,
): Promise<LegacyBackfillResult> {
  let stocks = await prisma.stock.findMany({
    where: { isActive: true } as any,
    select: { id: true, symbol: true, industryType: true },
    orderBy: { symbol: "asc" },
  });

  if (opts.industries && opts.industries.length > 0) {
    stocks = stocks.filter((s) =>
      opts.industries!.includes(s.industryType as IndustryType),
    );
  }
  if (opts.limit && opts.limit > 0) {
    stocks = stocks.slice(0, opts.limit);
  }

  const summary: LegacyBackfillResult = {
    totalSymbols: stocks.length,
    totalFilings: 0,
    ingested: 0,
    upgraded: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Chunk into batches of BATCH_SIZE symbols each
  const batches: (typeof stocks)[] = [];
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    batches.push(stocks.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[legacy-backfill] Universe: ${stocks.length} symbols in ${batches.length} batches of ${BATCH_SIZE}`,
  );

  // Force-reset the NSE client before starting so we begin with a clean session
  nseClient.resetSession();

  let done = 0;
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    // Reset NSE client after every SESSION_RESET_EVERY_N batches
    if (batchIdx > 0 && batchIdx % SESSION_RESET_EVERY_N === 0) {
      console.log(
        `[legacy-backfill] Session reset after batch ${batchIdx} (every ${SESSION_RESET_EVERY_N} batches)`,
      );
      nseClient.resetSession();
    }

    const batch = batches[batchIdx];
    for (const stock of batch) {
      const r = await backfillLegacySymbol(stock.symbol, opts, stock);
      summary.totalFilings += r.totalFilings;
      summary.ingested += r.ingested;
      summary.upgraded += r.upgraded;
      summary.refreshed += r.refreshed;
      summary.skipped += r.skipped;
      summary.failed += r.failed;
      summary.errors.push(...r.errors);

      done++;
      if (onProgress) await onProgress(done, stocks.length, stock.symbol);
    }

    // Brief inter-batch pause to avoid hammering NSE
    if (batchIdx + 1 < batches.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(
    `[legacy-backfill] Done. ingested=${summary.ingested} ` +
      `refreshed=${summary.refreshed} skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return summary;
}

export async function backfillLegacySymbol(
  symbol: string,
  opts: SymbolBackfillOpts = {},
  preloadedStock?: {
    id: string;
    symbol: string;
    industryType: IndustryType | string;
  },
): Promise<LegacyBackfillResult> {
  const summary: LegacyBackfillResult = {
    totalSymbols: 1,
    totalFilings: 0,
    ingested: 0,
    upgraded: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const stock =
    preloadedStock ??
    (await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, industryType: true },
    }));
  if (!stock) {
    console.warn(`[legacy-backfill] ${symbol}: stock not in universe`);
    summary.skipped++;
    return summary;
  }
  const industryType = (stock.industryType ?? "non_financial") as IndustryType;

  // ── Process QUARTERLY filings ──
  await processOneLeg(
    "Quarterly",
    stock.id,
    symbol,
    industryType,
    opts,
    summary,
  );

  // ── Process ANNUAL filings ──
  await processOneLeg("Annual", stock.id, symbol, industryType, opts, summary);

  return summary;
}

async function processOneLeg(
  period: "Quarterly" | "Annual",
  stockId: string,
  symbol: string,
  industryType: IndustryType,
  opts: SymbolBackfillOpts,
  summary: LegacyBackfillResult,
): Promise<void> {
  let allFilings: any[];
  try {
    allFilings = await fetchFilingsList(symbol, period);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(
      `[legacy-backfill] ${symbol} ${period} discovery failed:`,
      msg,
    );
    summary.failed++;
    summary.errors.push({ symbol, filing: `${period}_discovery`, error: msg });
    await logLegacyFetch(
      stockId,
      symbol,
      null,
      null,
      "failed",
      `${period} discovery: ${msg}`,
      period,
    );
    return;
  }

  console.log(
    `[legacy-backfill] ${symbol} ${period}: discovered ${allFilings.length} raw filings`,
  );
  if (allFilings.length > 0) {
    console.log(
      `[legacy-backfill] ${symbol} ${period}: first filing:`,
      JSON.stringify(allFilings[0], null, 2),
    );
  }
  if (allFilings.length === 0) return;

  // Date filtering
  let filings = allFilings;

  // fromDate/toDate filter on the filing's FISCAL PERIOD END (NSE field: toDate).
  // This is "give me filings for periods ending in this window," NOT
  // "filings published in this window." For historical backfill that's what
  // we want: a fromDate of "2020-04-01" means "include FY21 onwards."
  //
  // NSE returns period-end dates as "DD-MMM-YYYY" e.g. "31-Mar-2024".
  const parseDdMmmYyyy = (s: string): number => {
    const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) return NaN;
    const months = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const mi = months.indexOf(m[2].toUpperCase());
    if (mi < 0) return NaN;
    return Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10));
  };

  if (opts.fromDate) {
    const fromMs = new Date(opts.fromDate).getTime();
    filings = filings.filter((f) => {
      const ms = parseDdMmmYyyy(f.toDate); // f.toDate = period-end
      return Number.isFinite(ms) && ms >= fromMs;
    });
  }
  if (opts.toDate) {
    const toMs = new Date(opts.toDate).getTime();
    filings = filings.filter((f) => {
      const ms = parseDdMmmYyyy(f.toDate); // f.toDate = period-end
      return Number.isFinite(ms) && ms <= toMs;
    });
  }

  console.log(
    `[legacy-backfill] ${symbol} ${period}: ${allFilings.length} discovered → ` +
      `${filings.length} after filter on period-end [${opts.fromDate ?? "*"}..${opts.toDate ?? "*"}]`,
  );

  const byPeriod = groupFilingsByQuarter(filings);
  console.log(
    `[legacy-backfill] ${symbol} ${period}: ${filings.length} after date filter, ${byPeriod.size} groups`,
  );

  for (const [, group] of byPeriod) {
    const best = pickBestFilingForQuarter(
      group,
      group[0].fromDate,
      group[0].toDate,
    );
    if (!best) continue;

    summary.totalFilings++;
    const filingLabel = `${best.fromDate}..${best.toDate}`;

    try {
      const xml = await fetchXbrlFile(best.xbrl);
      const filingMeta = {
        symbol: best.symbol,
        xbrl: best.xbrl,
        consolidated: best.consolidated,
      };

      if (period === "Quarterly") {
        const v2 = parseQuarterlyResultXbrl(xml, filingMeta);
        const v3 = adaptV2ToDispatchableQuarterly(v2, industryType);
        const result = await dispatchQuarterlyIngest(
          stockId,
          v3,
          QUARTERLY_LEGACY_SOURCE,
          "ingest",
        );

        await logLegacyFetch(
          stockId,
          symbol,
          v2.quarter,
          v2.fiscalYear,
          result.status,
          null,
          "Quarterly",
        );

        if (result.status === "upgraded") summary.upgraded++;
        else if (result.status === "refreshed") summary.refreshed++;
        else summary.ingested++;
      } else {
        const v2 = parseAnnualResultXbrl(xml, filingMeta);
        const v3 = adaptV2ToDispatchableAnnual(v2, industryType);
        const result = await dispatchAnnualIngest(
          stockId,
          v3,
          ANNUAL_LEGACY_SOURCE,
          "ingest",
        );

        await logLegacyFetch(
          stockId,
          symbol,
          "Y",
          v2.fiscalYear,
          result.status,
          null,
          "Annual",
        );

        if (result.status === "upgraded") summary.upgraded++;
        else if (result.status === "refreshed") summary.refreshed++;
        else summary.ingested++;
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(
        `[legacy-backfill] ${symbol} ${period} ${filingLabel} failed:`,
        msg,
      );
      summary.failed++;
      summary.errors.push({
        symbol,
        filing: `${period}:${filingLabel}`,
        error: msg,
      });
      await logLegacyFetch(stockId, symbol, null, null, "failed", msg, period);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ResultFetchLog helper — matches the actual schema (create-only, append)
// ─────────────────────────────────────────────────────────────

async function logLegacyFetch(
  stockId: string,
  symbol: string,
  quarter: string | null,
  fiscalYear: string | null,
  status: string,
  errorMessage: string | null,
  periodHint?: string,
): Promise<void> {
  const source =
    periodHint === "Annual" ? ANNUAL_LEGACY_SOURCE : QUARTERLY_LEGACY_SOURCE;
  try {
    await prisma.resultFetchLog.upsert({
      where: {
        stockId_quarter_fiscalYear: {
          stockId,
          quarter: quarter ?? "",
          fiscalYear: fiscalYear ?? "",
        },
      },
      create: {
        stockId,
        symbol,
        quarter: quarter ?? "",
        fiscalYear: fiscalYear ?? "",
        status,
        source,
        error: errorMessage ? errorMessage.slice(0, 500) : null,
      },
      update: {
        symbol,
        status,
        source,
        error: errorMessage ? errorMessage.slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error(`[legacy-backfill] Log write failed for ${symbol}:`, err);
  }
}
