// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESULTS FEED CACHE — one in-process, stale-while-revalidate slot holding the fully assembled
// cross-stock earnings feed that GET /api/v1/results pages over.
//
// ── WHY: THE FEED IS A WHOLE-UNIVERSE REDUCTION, NOT A PAGE READ ────────────────────────────────────
// "The latest filed quarter per active stock" cannot be answered by a LIMIT/OFFSET query. It needs
// every row of all five per-family quarterly_results tables, reduced to one row per stock (most-recent
// period, on the family's preferred basis) BEFORE anything can be ordered or sliced. That reduction is
// identical for every reader and changes only when an ingestion lands — so doing it per page request
// would mean re-reading five tables to hand back twelve cards.
//
// With the whole reduced feed in the slot, a page is an in-memory filter + keyset slice: the scroll
// pages of /api/v1/results cost a Map lookup, not a database round-trip.
//
// ── ★ IT HOLDS PUBLIC PRODUCT DATA AND CANNOT BECOME USER-SCOPED ───────────────────────────────────
// Asserted by SHAPE, exactly as universe-rows.cache.ts asserts it: `getResultsFeedRows()` TAKES NO
// ARGUMENTS. There is no key, no map, and nowhere for a userId to enter — a per-user variant would
// have to change the signature, which is a review-visible act rather than a quiet one. What it holds
// is the raw material behind an endpoint served unauthenticated to anyone.
// ⚠ Do not add a parameter to this function.
//
// ── ⚠ THE SLOT IS SHARED AND MUST STAY READ-ONLY ───────────────────────────────────────────────────
// Every caller receives THE SAME `reported` and `upcoming` arrays — not copies. Both are returned
// ALREADY SORTED in their canonical feed order (see below), so no consumer has any reason to sort, and
// none may: an in-place `.sort()` or `.reverse()` here would silently reorder every other reader's
// page. Filter and slice (both of which copy) are the only safe operations.
//
// ── TTL: 5 MINUTES, STALE-WHILE-REVALIDATE ─────────────────────────────────────────────────────────
// Same policy and the same code as universe-rows.cache.ts, deliberately — one cache pattern in this
// codebase means one failure mode to reason about. Results arrive in filing bursts a few times a day,
// never per request. A stale hit serves instantly while the rebuild runs behind it; a rebuild that
// FAILS keeps serving the last good feed rather than turning a transient DB blip into an error in
// front of a reader. It evaporates on process restart and is persisted nowhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { toNum, round } from "./fundamentals-normalize.js";
import { buildScoredStocksList } from "./stocks-list.service.js";
import { readVerdict } from "../../insight/quarter-brief/verdict.js";
import type { ReportedResultItem, UpcomingResultItem } from "./results-list.types.js";

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const money = (x: unknown): number | null => round(toNum(x)); // ₹ Cr pass-through
const pctPass = (x: unknown): number | null => round(toNum(x)); // already-percent pass-through

const DAY_MS = 86_400_000;

/** How far ahead the upcoming half is cached. Requests ask for a window inside this (default 60
 *  days) and get it by filtering the slot — a look-ahead beyond this is clamped by the controller,
 *  so no caller can ask for a date this build didn't cover. */
export const UPCOMING_HORIZON_DAYS = 365;

// Families whose preferred display basis is STANDALONE (mirrors fundamentals-view:
// the regulated/complete filing for banks & insurers). Everything else → consolidated.
const FINANCIAL_STANDALONE = new Set(["banking", "life_insurance", "general_insurance"]);
const preferredBasis = (family: string): string =>
  FINANCIAL_STANDALONE.has(family) ? "standalone" : "consolidated";

// ── Normalised pre-attach row (dates still Date for the latest-per-stock reduction) ──
interface RawReported {
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  industryType: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: string;
  revenue: number | null;
  revenueLabel: string;
  revenueYoy: number | null;
  revenueQoq: number | null;
  netProfit: number | null;
  profitYoy: number | null;
  profitQoq: number | null;
  margin: number | null;
  marginLabel: string;
  netMargin: number | null;
  xbrlUrl: string;
}

const stockSelect = {
  select: {
    symbol: true,
    name: true,
    sector: { select: { displayName: true } },
  },
} as const;

const sectorName = (s: { sector: { displayName: string } | null }): string | null =>
  s.sector?.displayName ?? null;

// ── Per-family fetchers — each returns its rows already normalised to RawReported ────

async function fetchNonFinancial(): Promise<RawReported[]> {
  const rows = await prisma.quarterlyResult.findMany({
    where: { stock: { isActive: true } },
    select: {
      stockId: true, quarter: true, fiscalYear: true, reportDate: true, filingDate: true,
      resultType: true, xbrlUrl: true,
      revenue: true, revenueYoy: true, revenueQoq: true,
      netProfit: true, profitYoy: true, profitQoq: true,
      operatingMargin: true, netMargin: true,
      stock: stockSelect,
    },
  });
  return rows.map((q) => ({
    stockId: q.stockId, symbol: q.stock.symbol, name: q.stock.name, sector: sectorName(q.stock),
    industryType: "non_financial",
    quarter: q.quarter, fiscalYear: q.fiscalYear, reportDate: q.reportDate, filingDate: q.filingDate,
    resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.revenue), revenueLabel: "Revenue",
    revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.profitYoy), profitQoq: pctPass(q.profitQoq),
    margin: pctPass(q.operatingMargin), marginLabel: "Op margin", netMargin: pctPass(q.netMargin),
  }));
}

async function fetchBanking(): Promise<RawReported[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stock: { isActive: true } },
    select: {
      stockId: true, quarter: true, fiscalYear: true, reportDate: true, filingDate: true,
      resultType: true, xbrlUrl: true,
      nii: true, niiYoy: true, niiQoq: true,
      netProfit: true, patYoy: true, patQoq: true,
      netMargin: true,
      stock: stockSelect,
    },
  });
  return rows.map((q) => ({
    stockId: q.stockId, symbol: q.stock.symbol, name: q.stock.name, sector: sectorName(q.stock),
    industryType: "banking",
    quarter: q.quarter, fiscalYear: q.fiscalYear, reportDate: q.reportDate, filingDate: q.filingDate,
    resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.nii), revenueLabel: "Net interest income",
    revenueYoy: pctPass(q.niiYoy), revenueQoq: pctPass(q.niiQoq),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    margin: pctPass(q.netMargin), marginLabel: "Net margin", netMargin: pctPass(q.netMargin),
  }));
}

async function fetchNbfc(): Promise<RawReported[]> {
  const rows = await prisma.nbfcQuarterlyResult.findMany({
    where: { stock: { isActive: true } },
    select: {
      stockId: true, quarter: true, fiscalYear: true, reportDate: true, filingDate: true,
      resultType: true, xbrlUrl: true,
      revenue: true, revenueYoy: true, revenueQoq: true,
      netProfit: true, patYoy: true, patQoq: true,
      netMargin: true,
      stock: stockSelect,
    },
  });
  return rows.map((q) => ({
    stockId: q.stockId, symbol: q.stock.symbol, name: q.stock.name, sector: sectorName(q.stock),
    industryType: "nbfc",
    quarter: q.quarter, fiscalYear: q.fiscalYear, reportDate: q.reportDate, filingDate: q.filingDate,
    resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.revenue), revenueLabel: "Revenue",
    revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    margin: pctPass(q.netMargin), marginLabel: "Net margin", netMargin: pctPass(q.netMargin),
  }));
}

async function fetchLifeInsurance(): Promise<RawReported[]> {
  const rows = await prisma.lifeInsuranceQuarterlyResult.findMany({
    where: { stock: { isActive: true } },
    select: {
      stockId: true, quarter: true, fiscalYear: true, reportDate: true, filingDate: true,
      resultType: true, xbrlUrl: true,
      netPremiumIncome: true, premiumYoy: true, premiumQoq: true,
      netProfit: true, patYoy: true, patQoq: true,
      netMargin: true,
      stock: stockSelect,
    },
  });
  return rows.map((q) => ({
    stockId: q.stockId, symbol: q.stock.symbol, name: q.stock.name, sector: sectorName(q.stock),
    industryType: "life_insurance",
    quarter: q.quarter, fiscalYear: q.fiscalYear, reportDate: q.reportDate, filingDate: q.filingDate,
    resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.netPremiumIncome), revenueLabel: "Net premium",
    revenueYoy: pctPass(q.premiumYoy), revenueQoq: pctPass(q.premiumQoq),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    margin: pctPass(q.netMargin), marginLabel: "Net margin", netMargin: pctPass(q.netMargin),
  }));
}

async function fetchGeneralInsurance(): Promise<RawReported[]> {
  const rows = await prisma.generalInsuranceQuarterlyResult.findMany({
    where: { stock: { isActive: true } },
    select: {
      stockId: true, quarter: true, fiscalYear: true, reportDate: true, filingDate: true,
      resultType: true, xbrlUrl: true,
      grossPremiumsWritten: true, gpwYoy: true, gpwQoq: true,
      netProfit: true, patYoy: true, patQoq: true,
      netMargin: true,
      stock: stockSelect,
    },
  });
  return rows.map((q) => ({
    stockId: q.stockId, symbol: q.stock.symbol, name: q.stock.name, sector: sectorName(q.stock),
    industryType: "general_insurance",
    quarter: q.quarter, fiscalYear: q.fiscalYear, reportDate: q.reportDate, filingDate: q.filingDate,
    resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.grossPremiumsWritten), revenueLabel: "Gross premium",
    revenueYoy: pctPass(q.gpwYoy), revenueQoq: pctPass(q.gpwQoq),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    margin: pctPass(q.netMargin), marginLabel: "Net margin", netMargin: pctPass(q.netMargin),
  }));
}

/** Reduce every (stock, period, basis) row to ONE card per stock: the most-recent
 *  period (by reportDate), on the family's preferred basis (falling back to whatever
 *  basis filed that period). */
function latestPerStock(rows: RawReported[]): RawReported[] {
  const byStock = new Map<string, RawReported[]>();
  for (const r of rows) {
    const arr = byStock.get(r.stockId) ?? [];
    arr.push(r);
    byStock.set(r.stockId, arr);
  }

  const out: RawReported[] = [];
  for (const arr of byStock.values()) {
    const maxTime = Math.max(...arr.map((r) => r.reportDate.getTime()));
    const latest = arr.filter((r) => r.reportDate.getTime() === maxTime);
    const pref = preferredBasis(latest[0].industryType);
    out.push(latest.find((r) => r.resultType === pref) ?? latest[0]);
  }
  return out;
}

/** THE canonical reported order: newest filing first, symbol breaking ties.
 *  ★ The tie-break is not cosmetic — (filingDate, symbol) is the KEYSET the feed pages on, so it has
 *  to be a total order. Same-day filings are the common case (results arrive in bursts), and without
 *  a stable second key a page boundary landing inside one of those days could repeat or skip a card. */
const byFilingDesc = (a: ReportedResultItem, b: ReportedResultItem): number =>
  a.filingDate === b.filingDate ? a.symbol.localeCompare(b.symbol) : a.filingDate < b.filingDate ? 1 : -1;

/** THE canonical upcoming order: soonest date first, symbol breaking ties — the same keyset
 *  reasoning as above, mirrored for an ascending feed. */
const byEventAsc = (a: UpcomingResultItem, b: UpcomingResultItem): number =>
  a.eventDate === b.eventDate ? a.symbol.localeCompare(b.symbol) : a.eventDate < b.eventDate ? -1 : 1;

async function loadReported(): Promise<ReportedResultItem[]> {
  const families = await Promise.all([
    fetchNonFinancial(),
    fetchBanking(),
    fetchNbfc(),
    fetchLifeInsurance(),
    fetchGeneralInsurance(),
  ]);

  const latest = latestPerStock(families.flat());
  if (latest.length === 0) return [];

  // Honest extras — health score (only scored stocks) + a real earnings_analysis headline
  // (only stocks that have one). Both keyed by symbol/stockId, null otherwise. Scores ride the
  // universe-rows cache, so this is a Map build, not a second universe read.
  const [scored, summaries] = await Promise.all([
    buildScoredStocksList(),
    // ⚠ PERIOD-KEYED. This previously fetched every earnings_analysis row universe-wide with NO period
    // filter and took the newest per stock — so a brief written for one quarter would have been
    // attached to whatever quarter the feed happened to show. Keyed on the full period identity now,
    // and only `live` rows: a stale brief is hidden, not shown.
    prisma.quarterBrief.findMany({
      where: { status: "live" },
      select: { stockId: true, quarter: true, fiscalYear: true, resultType: true, verdictKey: true, verdictLabel: true },
    }),
  ]);

  const scoreBySymbol = new Map(scored.map((s) => [s.symbol, s.composite]));
  const briefKey = (stockId: string, q: string, fy: string, rt: string) => `${stockId}|${q}|${fy}|${rt}`;
  // ⚠ A brief can exist with NO verdict (MMTC). The stored sentinel is resolved here so the feed never
  // hands the card an empty string to render an empty badge frame from — see verdict.ts's note.
  const verdictByPeriod = new Map<string, string>();
  for (const s of summaries) {
    const v = readVerdict(s.verdictKey, s.verdictLabel);
    if (v) verdictByPeriod.set(briefKey(s.stockId, s.quarter, s.fiscalYear, s.resultType), v.label);
  }

  return latest
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      industryType: r.industryType,
      quarter: r.quarter,
      fiscalYear: r.fiscalYear,
      periodLabel: `${r.quarter} ${r.fiscalYear}`,
      reportDate: ymd(r.reportDate),
      filingDate: ymd(r.filingDate),
      resultType: r.resultType,
      revenue: r.revenue,
      revenueLabel: r.revenueLabel,
      revenueYoy: r.revenueYoy,
      revenueQoq: r.revenueQoq,
      netProfit: r.netProfit,
      profitYoy: r.profitYoy,
      profitQoq: r.profitQoq,
      margin: r.margin,
      marginLabel: r.marginLabel,
      netMargin: r.netMargin,
      xbrlUrl: r.xbrlUrl,
      healthScore: scoreBySymbol.get(r.symbol) ?? null,
      quarterBriefVerdict: verdictByPeriod.get(briefKey(r.stockId, r.quarter, r.fiscalYear, r.resultType)) ?? null,
    }))
    .sort(byFilingDesc);
}

async function loadUpcoming(): Promise<UpcomingResultItem[]> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS);

  const events = await prisma.corporateEvent.findMany({
    where: { eventType: "earnings", eventDate: { gte: from, lte: to }, stock: { isActive: true } },
    orderBy: [{ eventDate: "asc" }, { symbol: "asc" }],
    select: {
      symbol: true,
      eventDate: true,
      isConfirmed: true,
      description: true,
      stock: { select: { name: true, sector: { select: { displayName: true } } } },
    },
  });

  // One card per (symbol, date): a stock filing two board-meeting rows for the same day is the
  // same event twice, and (symbol, date) is the page keyset — it has to be unique. Confirmed wins
  // over tentative; otherwise the first row in the query's order.
  const byKey = new Map<string, UpcomingResultItem>();
  for (const e of events) {
    const key = `${e.symbol}|${ymd(e.eventDate)}`;
    const prev = byKey.get(key);
    if (prev && (prev.isConfirmed || !e.isConfirmed)) continue;
    byKey.set(key, {
      symbol: e.symbol,
      name: e.stock.name,
      sector: e.stock.sector?.displayName ?? null,
      eventDate: ymd(e.eventDate),
      isConfirmed: e.isConfirmed,
      description: e.description,
    });
  }

  return [...byKey.values()].sort(byEventAsc);
}

/** The whole feed, both halves, in canonical order. ⚠ Read-only — see the header. */
export interface ResultsFeedRows {
  /** Latest filed quarter per active stock, filingDate DESC then symbol ASC. */
  reported: ReportedResultItem[];
  /** Earnings dates within UPCOMING_HORIZON_DAYS, eventDate ASC then symbol ASC. */
  upcoming: UpcomingResultItem[];
}

async function loadResultsFeedRows(): Promise<ResultsFeedRows> {
  const [reported, upcoming] = await Promise.all([loadReported(), loadUpcoming()]);
  return { reported, upcoming };
}

/** Serve-stale-and-revalidate boundary. See the header for why five minutes. */
export const RESULTS_FEED_TTL_MS = 5 * 60 * 1000;

let cache: { rows: ResultsFeedRows; builtAt: number } | null = null;
let rebuildInFlight: Promise<ResultsFeedRows> | null = null;

/** Start (or join) a rebuild. One in flight at a time — a burst of cold callers shares one read. */
function rebuild(): Promise<ResultsFeedRows> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = loadResultsFeedRows()
    .then((rows) => {
      cache = { rows, builtAt: Date.now() };
      return rows;
    })
    .finally(() => {
      rebuildInFlight = null;
    });
  return rebuildInFlight;
}

/**
 * The assembled results feed, cached. ★ NO PARAMETERS — see the header.
 *
 * Cold  → reads and waits (joining any read already running).
 * Warm  → returns the cached rows.
 * Stale → returns the cached rows NOW and re-reads behind it.
 */
export async function getResultsFeedRows(): Promise<ResultsFeedRows> {
  if (!cache) return rebuild();
  if (Date.now() - cache.builtAt > RESULTS_FEED_TTL_MS) {
    // A failed background rebuild must not reject an already-answered request.
    rebuild().catch(() => {
      /* the last good feed keeps serving; the next caller retries */
    });
  }
  return cache.rows;
}

/** Observability for a verification harness and for a future admin read. Carries no row data. */
export function resultsFeedCacheStats(): {
  warm: boolean;
  ageMs: number | null;
  rebuilding: boolean;
  reported: number | null;
  upcoming: number | null;
} {
  return {
    warm: cache !== null,
    ageMs: cache ? Date.now() - cache.builtAt : null,
    rebuilding: rebuildInFlight !== null,
    reported: cache ? cache.rows.reported.length : null,
    upcoming: cache ? cache.rows.upcoming.length : null,
  };
}

/** Test-only: drop the slot so a harness can measure a genuine cold path. Never called in product code. */
export function _clearResultsFeedCacheForVerification(): void {
  cache = null;
}
