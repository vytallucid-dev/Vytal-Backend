// File: src/ingestions/quaterly-results/scan.ts (NEW — replaces v2's quarterly + annual scanners)

import { prisma } from "../../db/prisma.js";
import { fetchFilingsList, groupFilingsByPeriod } from "./results/discovery.js";
// import { fetchXbrlFile } from "./xbrl/fetcher.js";
import { parseQuarterly, parseAnnual } from "./xbrl/parser.js";
import { pickFilingsPerBasis, decideIngest } from "./picker.js";
import {
  dispatchQuarterlyIngest,
  dispatchAnnualIngest,
  pickerTableFor,
} from "./ingesters/dispatch.js";
import {
  detectTaxonomy,
  expectedTaxonomyForIndustry,
  industryForTaxonomy,
} from "./xbrl/taxonomy.js";
import type { NseFilingEntry } from "./xbrl/types.js";
import type { Stock } from "../../generated/prisma/client.js";
import { fetchXbrlFile } from "./legacy/discovery-legacy.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ScanSymbolOptions {
  /**
   * Cap on number of (qeDate, filingType) groups to process per symbol.
   * Default: process all available. Useful for testing.
   */
  maxGroups?: number;

  /**
   * If set, only process filings whose qeDate is on or after this date.
   * Useful for incremental scans (e.g. "only since last successful sync").
   */
  fromQeDate?: Date;

  /**
   * If true, refresh ALL existing rows that are older than the discovered
   * filing. Default: false (skip if same consolidation and filingDate <= existing).
   * Used by manual admin "refresh" actions.
   */
  forceRefresh?: boolean;
}

export interface ScanSymbolResult {
  symbol: string;
  totalFilings: number;
  totalGroups: number;
  ingested: number;
  upgraded: number;
  refreshed: number;
  skipped: number;
  failed: number;
  errors: { qeDate: string; filingType: string; error: string }[];
}

/**
 * Scan a single symbol: discover, pick, parse, ingest, and log every filing.
 *
 * Order of operations per (qeDate, filingType) group:
 *   1. Pick best filing (industry-aware)
 *   2. Decide whether to ingest (no-op / fresh / upgrade / refresh)
 *   3. If ingest needed: fetch XBRL → parse → dispatch ingest
 *   4. Log to ResultFetchLog at every decision point
 */
export async function scanSymbol(
  symbol: string,
  options: ScanSymbolOptions = {},
): Promise<ScanSymbolResult> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, industryType: true, fiscalYearEnd: true },
  });
  if (!stock) {
    throw new Error(`Stock not found: ${symbol}`);
  }

  const result: ScanSymbolResult = {
    symbol,
    totalFilings: 0,
    totalGroups: 0,
    ingested: 0,
    upgraded: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // ── Step 1: Discovery ──
  let filings: NseFilingEntry[];
  try {
    filings = await fetchFilingsList(symbol, stock.fiscalYearEnd);
  } catch (err) {
    await logFetch(
      stock.id,
      symbol,
      null,
      null,
      null,
      "failed",
      "nse_filings_api",
      String(err),
    );
    result.failed++;
    result.errors.push({
      qeDate: "(discovery)",
      filingType: "(n/a)",
      error: String(err),
    });
    return result;
  }

  result.totalFilings = filings.length;
  await logFetch(
    stock.id,
    symbol,
    null,
    null,
    null,
    "success",
    "nse_filings_api",
    `${filings.length} filings discovered`,
  );

  if (options.fromQeDate) {
    const cutoff = options.fromQeDate.getTime();
    filings = filings.filter((f) => parseQeDate(f.qeDate).getTime() >= cutoff);
  }

  const groups = groupFilingsByPeriod(filings);
  result.totalGroups = groups.size;

  // ── NEW: sort group keys chronologically (oldest first) so QoQ/YoY
  //         lookups find the prior-period rows already ingested.
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const [aDate, aType] = a.split("|");
    const [bDate, bType] = b.split("|");
    const aTime = parseQeDate(aDate).getTime();
    const bTime = parseQeDate(bDate).getTime();
    if (aTime !== bTime) return aTime - bTime;
    // Same date, e.g. unaudited Q4 + audited annual on Mar 31:
    // ingest quarterly first so the annual upgrade can read prior Q4.
    return aType === "quarterly" ? -1 : 1;
  });

  let groupsProcessed = 0;
  for (const groupKey of sortedKeys) {
    const candidates = groups.get(groupKey)!;
    if (options.maxGroups !== undefined && groupsProcessed >= options.maxGroups)
      break;
    groupsProcessed++;

    const [qeDate, filingTypeStr] = groupKey.split("|");
    const filingType = filingTypeStr as "quarterly" | "annual";

    try {
      const outcome = await processGroup(
        stock,
        candidates,
        filingType,
        options,
      );
      // Dual-basis: a group can store up to two rows (standalone + consolidated),
      // so processGroup returns per-basis tallies rather than a single status.
      result.ingested += outcome.ingested;
      result.refreshed += outcome.refreshed;
      result.skipped += outcome.skipped;
      // result.upgraded is retained for API/UI back-compat but is always 0 now —
      // the "upgrade-and-discard" path no longer exists (both bases are stored).
    } catch (err) {
      result.failed++;
      result.errors.push({ qeDate, filingType, error: String(err) });
      await logFetch(
        stock.id,
        symbol,
        qeDate,
        filingType,
        null,
        "failed",
        filingType === "annual" ? "nse_xbrl_annual" : "nse_xbrl_quarterly",
        String(err),
      );
    }
  }

  return result;
}

interface ProcessGroupOutcome {
  ingested: number; // basis rows newly inserted
  refreshed: number; // basis rows replaced by a newer-dated revision
  skipped: number; // basis already present, industry mismatch, or no pick
}

type BasisOutcome = "ingested" | "refreshed" | "skipped";

interface BasisIngestResult {
  outcome: BasisOutcome;
  quarter: string; // "Q1".."Q4" for quarterly; "Y" for annual fundamentals
  resultType: string; // basis actually parsed/written
  rowId?: string;
}

/**
 * Process one (qeDate, filingType) group. DUAL-BASIS: store EVERY basis that
 * was filed (Standalone and/or Consolidated) — nothing is discarded for being
 * the non-preferred basis. Each basis is a distinct XBRL document, so we
 * fetch / detect taxonomy / parse once per basis.
 */
async function processGroup(
  stock: Pick<Stock, "id" | "symbol" | "industryType">,
  candidates: NseFilingEntry[],
  filingType: "quarterly" | "annual",
  options: ScanSymbolOptions,
): Promise<ProcessGroupOutcome> {
  const picks = pickFilingsPerBasis(candidates);
  if (picks.length === 0) {
    return { ingested: 0, refreshed: 0, skipped: 1 };
  }

  const tally: ProcessGroupOutcome = { ingested: 0, refreshed: 0, skipped: 0 };

  // One ResultFetchLog row exists per (stock, quarter, fiscalYear) — its unique
  // key has no resultType — so we aggregate both bases into a single status
  // ("both_stored") instead of letting the second basis overwrite the first.
  const logBuckets = new Map<string, { bases: string[]; outcomes: string[] }>();
  const addLog = (quarter: string, basis: string, outcome: string) => {
    const b = logBuckets.get(quarter) ?? { bases: [], outcomes: [] };
    b.bases.push(basis);
    b.outcomes.push(outcome);
    logBuckets.set(quarter, b);
  };
  const bump = (outcome: BasisOutcome) => {
    if (outcome === "ingested") tally.ingested++;
    else if (outcome === "refreshed") tally.refreshed++;
    else tally.skipped++;
  };

  for (const pick of picks) {
    const filing = pick.filing;

    const xml = await fetchXbrlFile(filing.xbrl);
    const taxonomy = detectTaxonomy(xml, filing.xbrl);
    const detectedIndustry = industryForTaxonomy(taxonomy);
    if (detectedIndustry !== stock.industryType) {
      tally.skipped++;
      await logFetch(
        stock.id,
        stock.symbol,
        filing.qeDate,
        filingType,
        null,
        "skipped",
        filingType === "annual" ? "nse_xbrl_annual" : "nse_xbrl_quarterly",
        `Industry mismatch (${pick.basis}): stock=${stock.industryType}, xbrl=${detectedIndustry}`,
        pick.basis,
      );
      continue;
    }

    const ctx = {
      symbol: stock.symbol,
      xbrl: filing.xbrl,
      consolidated: filing.consolidated,
    };

    if (filingType === "quarterly") {
      const r = await ingestQuarterly(stock, filing, xml, taxonomy, ctx, options);
      bump(r.outcome);
      addLog(r.quarter, pick.basis, r.outcome);
      continue;
    }

    // ── Annual: write BOTH fundamentals AND derived Q4 quarterly, per basis ──
    // The same Mar-31 XBRL contains both annual (FourD) and Q4 (OneD) data.
    const annual = await ingestAnnual(stock, filing, xml, taxonomy, ctx, options);
    bump(annual.outcome);
    addLog("Y", pick.basis, annual.outcome);

    // Derive Q4 from the same Mar-31 filing. Log only (don't double-count in the
    // tally) and never fail the whole group if Q4 P&L is absent.
    try {
      const q4 = await ingestQuarterly(stock, filing, xml, taxonomy, ctx, options);
      addLog("Q4", pick.basis, q4.outcome);
    } catch (err) {
      addLog("Q4", pick.basis, "skipped");
      await logFetch(
        stock.id,
        stock.symbol,
        filing.qeDate,
        "quarterly",
        "Q4",
        "skipped",
        "nse_xbrl_quarterly",
        `Q4 derivation (${pick.basis}) from Mar-31 failed (annual write ok): ${String(
          err,
        ).slice(0, 160)}`,
        pick.basis,
      );
    }
  }

  // ── Flush aggregated per-period logs (one row per quarter label) ──
  for (const [quarter, bucket] of logBuckets) {
    const isDerivedQ4 = filingType === "annual" && quarter !== "Y";
    const source =
      filingType === "annual" && !isDerivedQ4
        ? "nse_xbrl_annual"
        : "nse_xbrl_quarterly";
    const resultTypeLabel =
      bucket.bases.length >= 2 ? "both" : (bucket.bases[0] ?? null);
    await logFetch(
      stock.id,
      stock.symbol,
      picks[0].filing.qeDate,
      isDerivedQ4 ? "quarterly" : filingType,
      quarter,
      aggregateStatus(bucket.outcomes),
      source,
      `bases=[${bucket.bases.join(",")}] outcomes=[${bucket.outcomes.join(",")}]` +
        (isDerivedQ4 ? " (Q4 derived from Mar-31 annual)" : ""),
      resultTypeLabel,
    );
  }

  return tally;
}

/**
 * Roll up per-basis outcomes for one period into a single ResultFetchLog status:
 *   "both_stored"      — both bases present after this run (≥1 newly stored)
 *   "stored"           — a single basis newly stored (only one basis was filed)
 *   "refreshed"        — a revision replaced an existing basis row
 *   "already_ingested" — every basis was already present (idempotent no-op)
 */
function aggregateStatus(outcomes: string[]): string {
  if (outcomes.some((o) => o === "refreshed")) return "refreshed";
  if (outcomes.some((o) => o === "ingested")) {
    return outcomes.length >= 2 ? "both_stored" : "stored";
  }
  return "already_ingested";
}

// Split-out helpers
async function ingestQuarterly(
  stock: Pick<Stock, "id" | "symbol" | "industryType">,
  filing: NseFilingEntry,
  xml: string,
  taxonomy: ReturnType<typeof detectTaxonomy>,
  ctx: {
    symbol: string;
    xbrl: string;
    consolidated: NseFilingEntry["consolidated"];
  },
  options: ScanSymbolOptions,
): Promise<BasisIngestResult> {
  const source = "nse_xbrl_quarterly";
  const parsed = parseQuarterly(xml, ctx, stock.industryType);
  const period = {
    quarter: parsed.data.quarter,
    fiscalYear: parsed.data.fiscalYear,
  };
  const table = pickerTableFor(taxonomy, "quarterly");
  const decision = options.forceRefresh
    ? { decision: "refresh" as const, reason: "forceRefresh" }
    : await decideIngest(stock.id, table, period, filing);

  if (decision.decision === "skip") {
    // This basis already stored at same-or-later filingDate — idempotent no-op.
    return {
      outcome: "skipped",
      quarter: parsed.data.quarter,
      resultType: parsed.data.resultType,
    };
  }

  const ingest = await dispatchQuarterlyIngest(
    stock.id,
    parsed,
    source,
    decision.decision,
  );
  return {
    outcome: ingest.status === "refreshed" ? "refreshed" : "ingested",
    quarter: parsed.data.quarter,
    resultType: parsed.data.resultType,
    rowId: ingest.rowId,
  };
}

async function ingestAnnual(
  stock: Pick<Stock, "id" | "symbol" | "industryType">,
  filing: NseFilingEntry,
  xml: string,
  taxonomy: ReturnType<typeof detectTaxonomy>,
  ctx: {
    symbol: string;
    xbrl: string;
    consolidated: NseFilingEntry["consolidated"];
  },
  options: ScanSymbolOptions,
): Promise<BasisIngestResult> {
  const source = "nse_xbrl_annual";
  const parsed = parseAnnual(xml, ctx, stock.industryType);
  const period = { fiscalYear: parsed.data.fiscalYear };
  const table = pickerTableFor(taxonomy, "annual");
  const decision = options.forceRefresh
    ? { decision: "refresh" as const, reason: "forceRefresh" }
    : await decideIngest(stock.id, table, period, filing);

  if (decision.decision === "skip") {
    return {
      outcome: "skipped",
      quarter: "Y",
      resultType: parsed.data.resultType,
    };
  }

  const ingest = await dispatchAnnualIngest(
    stock.id,
    parsed,
    source,
    decision.decision,
  );
  return {
    outcome: ingest.status === "refreshed" ? "refreshed" : "ingested",
    quarter: "Y",
    resultType: parsed.data.resultType,
    rowId: ingest.rowId,
  };
}

async function logFetch(
  stockId: string,
  symbol: string,
  qeDate: string | null,
  filingType: string | null,
  quarter: string | null,
  status: string,
  source: string,
  notes: string,
  resultType: string | null = null, // "standalone" | "consolidated" | "both"
): Promise<void> {
  const fiscalYear = qeDate ? deriveFiscalYearFromQeDate(qeDate) : null;
  await prisma.resultFetchLog.upsert({
    where: {
      stockId_quarter_fiscalYear: {
        stockId,
        quarter: quarter ?? "",
        fiscalYear: fiscalYear ?? "",
      },
    },
    update: {
      status,
      source,
      resultType,
      filingDate: qeDate ? parseQeDate(qeDate) : null,
      error: notes ? notes.slice(0, 500) : null,
    },
    create: {
      stockId,
      symbol,
      quarter: quarter ?? "",
      fiscalYear: fiscalYear ?? "",
      resultType,
      filingDate: qeDate ? parseQeDate(qeDate) : null,
      status,
      source,
      error: notes ? notes.slice(0, 500) : null,
    },
  });
}

const MONTH_NAMES = [
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

function parseQeDate(s: string): Date {
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (!m) throw new Error(`Invalid qeDate: ${s}`);
  return new Date(
    Date.UTC(+m[3], MONTH_NAMES.indexOf(m[2].toUpperCase()), +m[1]),
  );
}

function deriveFiscalYearFromQeDate(qeDate: string): string {
  const d = parseQeDate(qeDate);
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  // Months 4-12 → FY = year + 1; months 1-3 → FY = year
  const fyEndYear = month >= 4 ? year + 1 : year;
  return `FY${String(fyEndYear).slice(-2)}`;
}

export interface ScanUniverseOptions {
  /**
   * Delay in milliseconds between symbol scans. Default 1500 (NSE rate limit).
   */
  delayMs?: number;

  /**
   * If set, only scan stocks whose industryType is in this list.
   */
  industries?: (
    | "non_financial"
    | "banking"
    | "nbfc"
    | "life_insurance"
    | "general_insurance"
  )[];

  /**
   * Limit on number of stocks to scan. Default: all active stocks.
   */
  limit?: number;

  /**
   * Per-symbol options forwarded to scanSymbol.
   */
  perSymbol?: ScanSymbolOptions;

  /**
   * Optional progress callback called after every symbol.
   */
  onProgress?: (
    symbol: string,
    result: ScanSymbolResult,
    progress: { current: number; total: number },
  ) => void | Promise<void>;
}

export interface ScanUniverseResult {
  totalSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  totalIngested: number;
  totalUpgraded: number;
  totalRefreshed: number;
  totalSkipped: number;
  totalFailed: number;
  symbolErrors: { symbol: string; error: string }[];
  /** Symbols that ACTUALLY had fundamentals/quarterly rows written this scan
   *  (ingested + upgraded + refreshed > 0). "changed" = wrote-something, not merely
   *  scanned — the scoring-trigger layer fans these out to their PGs. */
  changedSymbols: string[];
}

export async function scanUniverse(
  options: ScanUniverseOptions = {},
): Promise<ScanUniverseResult> {
  const delayMs = options.delayMs ?? 1500;
  const stocks = await prisma.stock.findMany({
    where: {
      isActive: true,
      ...(options.industries
        ? { industryType: { in: options.industries } }
        : {}),
    },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  });

  const result: ScanUniverseResult = {
    totalSymbols: stocks.length,
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

  for (let i = 0; i < stocks.length; i++) {
    const { symbol } = stocks[i];
    try {
      const r = await scanSymbol(symbol, options.perSymbol);
      result.successfulSymbols++;
      result.totalIngested += r.ingested;
      result.totalUpgraded += r.upgraded;
      result.totalRefreshed += r.refreshed;
      result.totalSkipped += r.skipped;
      result.totalFailed += r.failed;
      // "Changed" = this symbol actually had rows written (not merely scanned/skipped).
      if (r.ingested + r.upgraded + r.refreshed > 0) result.changedSymbols.push(symbol);

      if (options.onProgress) {
        await options.onProgress(symbol, r, {
          current: i + 1,
          total: stocks.length,
        });
      }
    } catch (err) {
      result.failedSymbols++;
      result.symbolErrors.push({ symbol, error: String(err) });
    }

    if (i < stocks.length - 1) {
      await sleep(delayMs);
    }
  }

  return result;
}
