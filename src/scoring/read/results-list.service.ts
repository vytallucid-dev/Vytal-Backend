// File: src/scoring/read/results-list.service.ts
//
// THE results-list assembler for GET /api/v1/results — a cross-stock earnings feed in
// two REAL, dense halves:
//
//   • REPORTED  — the latest filed quarterly result per active stock, read straight
//                 from the five per-family quarterly_results tables (the same dense
//                 source the Fundamentals view serves). Deduped to the family's
//                 preferred basis (consolidated for non-financials; standalone for
//                 banks/insurers), then the most-recent period per stock.
//   • UPCOMING  — corporate_events of eventType "earnings" across the active universe:
//                 real board-meeting/result dates, honest "pending" (no numbers yet).
//
// UNITS: money is ₹ Crore (pass-through — every source column is already Cr); the
// growth + headline-margin columns are ALREADY percent in the source (the fundamentals
// view's `passPct` fields), so they pass through unscaled. We deliberately do NOT read
// the fraction-stored ratios (gnpa/cet1/roe) here, so no family-aware ×100 is needed.
//
// NO market-reaction and NO estimate-relative "beat/miss" — both are absent from the
// data (reaction needs the price window = the viewer, build #2; estimates were dropped
// permanently). Every number is real or honest-null.

import { prisma } from "../../db/prisma.js";
import { toNum, round } from "./fundamentals-normalize.js";
import { buildScoredStocksList } from "./stocks-list.service.js";
import type {
  ReportedResultItem,
  UpcomingResultItem,
  ResultsListData,
} from "./results-list.types.js";

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const money = (x: unknown): number | null => round(toNum(x)); // ₹ Cr pass-through
const pctPass = (x: unknown): number | null => round(toNum(x)); // already-percent pass-through

// Families whose preferred display basis is STANDALONE (mirrors fundamentals-view:
// the regulated/complete filing for banks & insurers). Everything else → consolidated.
const FINANCIAL_STANDALONE = new Set(["banking", "life_insurance", "general_insurance"]);
const preferredBasis = (family: string): string =>
  FINANCIAL_STANDALONE.has(family) ? "standalone" : "consolidated";

const DAY_MS = 86_400_000;

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

async function fetchNonFinancial(since?: Date): Promise<RawReported[]> {
  const rows = await prisma.quarterlyResult.findMany({
    where: { stock: { isActive: true }, ...(since ? { filingDate: { gte: since } } : {}) },
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

async function fetchBanking(since?: Date): Promise<RawReported[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stock: { isActive: true }, ...(since ? { filingDate: { gte: since } } : {}) },
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

async function fetchNbfc(since?: Date): Promise<RawReported[]> {
  const rows = await prisma.nbfcQuarterlyResult.findMany({
    where: { stock: { isActive: true }, ...(since ? { filingDate: { gte: since } } : {}) },
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

async function fetchLifeInsurance(since?: Date): Promise<RawReported[]> {
  const rows = await prisma.lifeInsuranceQuarterlyResult.findMany({
    where: { stock: { isActive: true }, ...(since ? { filingDate: { gte: since } } : {}) },
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

async function fetchGeneralInsurance(since?: Date): Promise<RawReported[]> {
  const rows = await prisma.generalInsuranceQuarterlyResult.findMany({
    where: { stock: { isActive: true }, ...(since ? { filingDate: { gte: since } } : {}) },
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

async function buildReported(since: Date | undefined, limit: number): Promise<ReportedResultItem[]> {
  const families = await Promise.all([
    fetchNonFinancial(since),
    fetchBanking(since),
    fetchNbfc(since),
    fetchLifeInsurance(since),
    fetchGeneralInsurance(since),
  ]);

  const latest = latestPerStock(families.flat())
    .sort((a, b) => b.filingDate.getTime() - a.filingDate.getTime())
    .slice(0, limit);

  if (latest.length === 0) return [];

  // Honest extras — health score (only scored stocks) + a real earnings_analysis
  // headline (only stocks that have one). Both keyed by symbol/stockId, null otherwise.
  const stockIds = latest.map((r) => r.stockId);
  const [scored, summaries] = await Promise.all([
    buildScoredStocksList(),
    prisma.aiSummary.findMany({
      where: { stockId: { in: stockIds }, summaryType: "earnings_analysis" },
      orderBy: { generatedAt: "desc" },
      select: { stockId: true, headline: true },
    }),
  ]);

  const scoreBySymbol = new Map(scored.map((s) => [s.symbol, s.composite]));
  const aiByStock = new Map<string, string>();
  for (const s of summaries)
    if (s.headline && !aiByStock.has(s.stockId)) aiByStock.set(s.stockId, s.headline);

  return latest.map((r) => ({
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
    aiHeadline: aiByStock.get(r.stockId) ?? null,
  }));
}

async function buildUpcoming(days: number, limit: number): Promise<UpcomingResultItem[]> {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const to = new Date(now.getTime() + days * DAY_MS);

  const events = await prisma.corporateEvent.findMany({
    where: { eventType: "earnings", eventDate: { gte: now, lte: to }, stock: { isActive: true } },
    orderBy: { eventDate: "asc" },
    take: limit,
    select: {
      symbol: true,
      eventDate: true,
      isConfirmed: true,
      description: true,
      stock: { select: { name: true, sector: { select: { displayName: true } } } },
    },
  });

  return events.map((e) => ({
    symbol: e.symbol,
    name: e.stock.name,
    sector: e.stock.sector?.displayName ?? null,
    eventDate: ymd(e.eventDate),
    isConfirmed: e.isConfirmed,
    description: e.description,
  }));
}

export interface ResultsListOpts {
  /** "reported" | "upcoming" | "all" — which halves to build (default "all"). */
  filter?: "reported" | "upcoming" | "all";
  /** Reported window: only results filed within the last `days`. Omit → latest per
   *  stock regardless of age (the default landing feed). */
  days?: number;
  /** Upcoming look-ahead window in days (default 60). */
  upcomingDays?: number;
  /** Max items per half (default 250). */
  limit?: number;
}

export async function buildResultsList(opts: ResultsListOpts = {}): Promise<ResultsListData> {
  const { filter = "all", days, upcomingDays = 60, limit = 250 } = opts;
  const since = days != null ? new Date(Date.now() - days * DAY_MS) : undefined;

  const [reported, upcoming] = await Promise.all([
    filter === "upcoming" ? Promise.resolve([]) : buildReported(since, limit),
    filter === "reported" ? Promise.resolve([]) : buildUpcoming(upcomingDays, limit),
  ]);

  const weekAgoMs = Date.now() - 7 * DAY_MS;
  const reportedThisWeek = reported.filter(
    (r) => new Date(r.filingDate).getTime() >= weekAgoMs,
  ).length;

  return {
    reported,
    upcoming,
    counts: {
      reported: reported.length,
      upcoming: upcoming.length,
      reportedThisWeek,
    },
  };
}
