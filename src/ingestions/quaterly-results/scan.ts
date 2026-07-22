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
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  RESULTS_CRON,
  RESULTS_SOURCE,
  CORE_NULL_MAX,
  BS_NULL_MAX,
  classifyFailedRate,
  checkBatchNullRate,
  resultsRunRef,
} from "./fundamentals-guards.js";

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
  /**
   * Did this symbol's scan change a value the SCORER actually reads?
   *
   * DELIBERATELY SEPARATE FROM ingested/refreshed. Those say what we did to the ROW
   * ("refreshed" = we rewrote it, decided on filingDate alone). This says whether any
   * score-relevant COLUMN moved — the only thing that can move a Health Score. The rescore
   * trigger keys off THIS; the run logs keep reporting the other two unchanged.
   */
  scoreRelevantChanged: boolean;
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
    scoreRelevantChanged: false,
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
      // OR across groups: one real change anywhere in the symbol warrants the rescore.
      if (outcome.scoreRelevantChanged) result.scoreRelevantChanged = true;
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
  /** A score-relevant column actually moved on at least one basis in this group. */
  scoreRelevantChanged: boolean;
}

type BasisOutcome = "ingested" | "refreshed" | "skipped";

interface BasisIngestResult {
  outcome: BasisOutcome;
  quarter: string; // "Q1".."Q4" for quarterly; "Y" for annual fundamentals
  resultType: string; // basis actually parsed/written
  rowId?: string;
  /** Did a score-relevant column move? Absent ⇒ nothing was written (skip/reject). */
  scoreRelevantChanged?: boolean;
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
    return { ingested: 0, refreshed: 0, skipped: 1, scoreRelevantChanged: false };
  }

  const tally: ProcessGroupOutcome = { ingested: 0, refreshed: 0, skipped: 0, scoreRelevantChanged: false };

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
  const bump = (outcome: BasisOutcome, scoreRelevantChanged?: boolean) => {
    if (outcome === "ingested") tally.ingested++;
    else if (outcome === "refreshed") tally.refreshed++;
    else tally.skipped++;
    // The flag is ORed in HERE rather than at each call site, so a future basis path
    // cannot forget it and silently stop triggering rescores.
    if (scoreRelevantChanged) tally.scoreRelevantChanged = true;
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
      bump(r.outcome, r.scoreRelevantChanged);
      addLog(r.quarter, pick.basis, r.outcome);
      continue;
    }

    // ── Annual: write BOTH fundamentals AND derived Q4 quarterly, per basis ──
    // The same Mar-31 XBRL contains both annual (FourD) and Q4 (OneD) data.
    const annual = await ingestAnnual(stock, filing, xml, taxonomy, ctx, options);
    bump(annual.outcome, annual.scoreRelevantChanged);
    addLog("Y", pick.basis, annual.outcome);

    // Derive Q4 from the same Mar-31 filing. Log only (don't double-count in the
    // tally) and never fail the whole group if Q4 P&L is absent.
    try {
      const q4 = await ingestQuarterly(stock, filing, xml, taxonomy, ctx, options);
      // Deliberately not bumped into the tally (it would double-count the group), but a
      // real Q4 change is still a real change — OR it in, or a Q4-only revision would
      // silently never rescore.
      if (q4.scoreRelevantChanged) tally.scoreRelevantChanged = true;
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
    // A SHAPE-rejected basis stored nothing → treat as skipped (not ingested).
    outcome:
      ingest.status === "refreshed"
        ? "refreshed"
        : ingest.status === "rejected"
          ? "skipped"
          : "ingested",
    quarter: parsed.data.quarter,
    resultType: parsed.data.resultType,
    rowId: ingest.rowId,
    scoreRelevantChanged: ingest.scoreRelevantChanged,
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
    // A SHAPE-rejected basis stored nothing → treat as skipped (not ingested).
    outcome:
      ingest.status === "refreshed"
        ? "refreshed"
        : ingest.status === "rejected"
          ? "skipped"
          : "ingested",
    quarter: "Y",
    resultType: parsed.data.resultType,
    rowId: ingest.rowId,
    scoreRelevantChanged: ingest.scoreRelevantChanged,
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
  const scanStart = new Date();
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
      // ── WHAT "CHANGED" MEANS, AND WHY IT IS NO LONGER "WE WROTE A ROW". ──
      //
      // This used to be `r.ingested + r.upgraded + r.refreshed > 0`, i.e. "an upsert ran".
      // But decideIngest decides to rewrite on filingDate ALONE and the ingesters
      // blind-overwrite (`create: data, update: data`), so a re-filing carrying identical
      // numbers counted as "changed" and fanned a full rescore out to every PG the symbol
      // sits in. Measured: rows rewritten ~19x each, and 158 of 168 resulting rescores
      // (94%) moved no score at all — the fingerprint guard caught them only AFTER paying
      // the whole read-heavy compute.
      //
      // scoreRelevantChanged asks the honest question instead: did a column the SCORER
      // ACTUALLY READS move? It is computed per row by comparing the stored values before
      // and after the write (score-relevant-diff.ts), against a per-table manifest derived
      // from the loaders themselves (score-input-columns.ts).
      //
      // ingested/refreshed are UNCHANGED and still reported — they still mean "what we did
      // to the row", which is what the run logs and result_fetch_logs should keep saying.
      if (r.scoreRelevantChanged) result.changedSymbols.push(symbol);

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

  await runResultsCoverageGuards(scanStart, result);

  return result;
}

// ── Run-level guards (GUARDS 2 + 3) for the Ind-AS path ───────
// Called once at the end of a universe scan. COUNT keys off the scan's
// own failure tally; NULL-RATE keys off the rows actually touched this run
// (updatedAt ≥ scanStart) — no need to thread parsed data up the call
// stack. Scoped to the non-financial fundamentals/quarterly_results tables.
async function runResultsCoverageGuards(
  scanStart: Date,
  result: ScanUniverseResult,
): Promise<void> {
  const runRef = resultsRunRef("universe");
  const base = {
    source: RESULTS_SOURCE,
    cron: RESULTS_CRON,
    runRef,
  } as const;

  // ── GUARD 2: COUNT / coverage (PROVISIONAL) ──
  const attempted =
    result.totalIngested +
    result.totalRefreshed +
    result.totalSkipped +
    result.totalFailed;
  const failVerdict = classifyFailedRate(result.totalFailed, attempted);
  if (failVerdict) {
    await reportIngestionError({
      ...base,
      guardType: "count",
      targetTable: "Fundamental",
      severity: failVerdict.severity,
      resolutionPath: "source_code",
      expected: "≤25% of group attempts fail",
      observed: failVerdict.note,
      detail: "Results scan failure-rate spike — source/session cascade.",
    });
  }

  // ── GUARD 3: NULL-RATE on core raw lines over rows touched this run ──
  // (the workhorse: a tag-rename cascade shows as revenue/netProfit nulls
  // spiking from the ~0% norm). A null balance sheet is normal (24.4%) —
  // BS fields only flag a SPIKE past 50%.
  const [f] = await prisma.$queryRaw<
    Array<{ n: number; rev: number; np: number; ta: number; te: number }>
  >`SELECT COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE revenue IS NULL)::int AS rev,
      COUNT(*) FILTER (WHERE net_profit IS NULL)::int AS np,
      COUNT(*) FILTER (WHERE total_assets IS NULL)::int AS ta,
      COUNT(*) FILTER (WHERE total_equity IS NULL)::int AS te
    FROM fundamentals WHERE updated_at >= ${scanStart}`;
  const [q] = await prisma.$queryRaw<
    Array<{ n: number; rev: number; np: number }>
  >`SELECT COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE revenue IS NULL)::int AS rev,
      COUNT(*) FILTER (WHERE net_profit IS NULL)::int AS np
    FROM quarterly_results WHERE updated_at >= ${scanStart}`;

  const checks: Array<{
    table: string;
    field: string;
    nulls: number;
    n: number;
    max: number;
    normal: string;
  }> = [
    { table: "Fundamental", field: "revenue", nulls: f.rev, n: f.n, max: CORE_NULL_MAX, normal: "0%" },
    { table: "Fundamental", field: "netProfit", nulls: f.np, n: f.n, max: CORE_NULL_MAX, normal: "0%" },
    { table: "Fundamental", field: "totalAssets", nulls: f.ta, n: f.n, max: BS_NULL_MAX, normal: "24%" },
    { table: "Fundamental", field: "totalEquity", nulls: f.te, n: f.n, max: BS_NULL_MAX, normal: "24%" },
    { table: "QuarterlyResult", field: "revenue", nulls: q.rev, n: q.n, max: CORE_NULL_MAX, normal: "0%" },
    { table: "QuarterlyResult", field: "netProfit", nulls: q.np, n: q.n, max: CORE_NULL_MAX, normal: "0%" },
  ];

  for (const c of checks) {
    const rate = checkBatchNullRate(c.nulls, c.n, c.max);
    if (rate == null) continue;
    await reportIngestionError({
      ...base,
      guardType: "null_rate",
      targetTable: c.table,
      targetField: c.field,
      severity: "medium",
      resolutionPath: "source_code",
      expected: `${c.field} null-rate ≤ ${(c.max * 100).toFixed(0)}% (normal ${c.normal})`,
      observed: `${(rate * 100).toFixed(1)}% null (${c.nulls}/${c.n})`,
      detail: "Core line nulled across the run — likely an XBRL tag rename cascade.",
    });
  }

  // ── Financial-industry core-P&L null-rate (same updatedAt window) ──
  // Core KPI + netProfit only (both ~0% null). GNPA/CET1/solvency are
  // sparsely disclosed (banking ~70% null) and are NOT null-rate-guarded.
  const FIN_TABLES: Array<{
    table: string;
    model: string;
    kpi: string;
    kpiLabel: string;
  }> = [
    { table: "banking_fundamentals", model: "BankingFundamental", kpi: "interest_earned", kpiLabel: "interestEarned" },
    { table: "banking_quarterly_results", model: "BankingQuarterlyResult", kpi: "interest_earned", kpiLabel: "interestEarned" },
    { table: "nbfc_fundamentals", model: "NbfcFundamental", kpi: "revenue", kpiLabel: "revenue" },
    { table: "nbfc_quarterly_results", model: "NbfcQuarterlyResult", kpi: "revenue", kpiLabel: "revenue" },
    { table: "life_insurance_fundamentals", model: "LifeInsuranceFundamental", kpi: "gross_premium_income", kpiLabel: "grossPremiumIncome" },
    { table: "life_insurance_quarterly_results", model: "LifeInsuranceQuarterlyResult", kpi: "gross_premium_income", kpiLabel: "grossPremiumIncome" },
    { table: "general_insurance_fundamentals", model: "GeneralInsuranceFundamental", kpi: "gross_premiums_written", kpiLabel: "grossPremiumsWritten" },
    { table: "general_insurance_quarterly_results", model: "GeneralInsuranceQuarterlyResult", kpi: "gross_premiums_written", kpiLabel: "grossPremiumsWritten" },
  ];
  for (const t of FIN_TABLES) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE ${t.kpi} IS NULL)::int AS kpi,
         COUNT(*) FILTER (WHERE net_profit IS NULL)::int AS np
       FROM ${t.table} WHERE updated_at >= $1`,
      scanStart,
    )) as Array<{ n: number; kpi: number; np: number }>;
    const r = rows[0];
    for (const [field, nulls] of [
      [t.kpiLabel, r.kpi],
      ["netProfit", r.np],
    ] as const) {
      const rate = checkBatchNullRate(nulls, r.n, CORE_NULL_MAX);
      if (rate == null) continue;
      await reportIngestionError({
        ...base,
        guardType: "null_rate",
        targetTable: t.model,
        targetField: field,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `${field} null-rate ≤ 5% (normal 0%)`,
        observed: `${(rate * 100).toFixed(1)}% null (${nulls}/${r.n})`,
        detail: "Core line nulled across the run — likely an XBRL tag rename cascade.",
      });
    }
  }
}
