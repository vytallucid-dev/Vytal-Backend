// ─────────────────────────────────────────────────────────────
// Peer group metrics computation engine.
//
// What it computes (per peer group):
//   avgPeRatio, avgPbRatio, avgRoe, avgRoce,
//   avgNetMargin, avgDebtToEquity, avgRevenueGrowth
//
// Source of data:
//   - fundamentals table (latest fiscal year per stock)
//   - stock_prices table (current price for live P/E, P/B)
//
// Averaging strategy:
//   - Uses MEDIAN not mean for P/E, P/B, EV/EBITDA
//     Reason: a single outlier (loss-making stock with P/E = 0
//     or extreme P/E of 200x) distorts the mean badly.
//   - Uses MEAN for ROE, ROCE, margins, growth
//     Reason: these are bounded and normally distributed
//     within a peer group.
//   - Excludes null values from all calculations
//   - Requires minimum 2 stocks with valid data to compute
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";

// ── Types ─────────────────────────────────────────────────────

/**
 * Called after each peer group is computed.
 * Return false to abort the remaining groups (cooperative cancellation).
 */
export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export interface PeerMetrics {
  peerGroupId: string;
  peerGroupName: string;
  fiscalYear: string;
  stocksWithData: number;
  stocksTotal: number;

  avgPeRatio: number | null;
  avgPbRatio: number | null;
  avgRoe: number | null;
  avgRoce: number | null;
  avgNetMargin: number | null;
  avgDebtToEquity: number | null;
  avgRevenueGrowth: number | null;

  // Additional metrics useful for health score engine
  avgOperatingMargin: number | null;
  avgInterestCoverage: number | null;
  avgAssetTurnover: number | null;
  avgRevenueGrowth3y: number | null; // 3-year CAGR where available
}

export interface ComputeResult {
  success: boolean;
  peerGroupId: string;
  peerGroupName: string;
  metrics: PeerMetrics | null;
  skipped: boolean; // true if < 2 stocks had valid data
  reason?: string;
}

export interface BulkComputeResult {
  totalGroups: number;
  computed: number;
  skipped: number;
  failed: number;
  fiscalYear: string;
  results: ComputeResult[];
  durationMs: number;
  /** Per-group failure reasons (throws), for diagnostics. */
  errors?: { name: string; reason: string }[];
}

// ── Math helpers ──────────────────────────────────────────────

function median(values: number[]): number | null {
  const valid = values.filter((v) => v != null && isFinite(v) && v > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function round4(v: number | null): number | null {
  if (v == null) return null;
  return Math.round(v * 10000) / 10000;
}

function toNum(v: Prisma.Decimal | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v.toString());
  return isNaN(n) ? null : n;
}

// ── Latest fiscal year detector ───────────────────────────────
// Find the most recent fiscal year that has data for
// at least half the stocks in this peer group.
// This handles cases where some stocks report later than others.

async function detectLatestFiscalYear(
  stockIds: string[],
): Promise<string | null> {
  // Get all fiscal years present for these stocks
  const records = await prisma.fundamental.findMany({
    where: { stockId: { in: stockIds } },
    select: { fiscalYear: true, stockId: true },
    orderBy: { reportDate: "desc" },
  });

  if (records.length === 0) return null;

  // Count how many stocks have data for each fiscal year
  const yearCoverage = new Map<string, Set<string>>();
  for (const r of records) {
    if (!yearCoverage.has(r.fiscalYear)) {
      yearCoverage.set(r.fiscalYear, new Set());
    }
    yearCoverage.get(r.fiscalYear)!.add(r.stockId);
  }

  // Find the most recent fiscal year with at least 50% coverage
  const threshold = Math.max(2, Math.floor(stockIds.length / 2));
  const sortedYears = Array.from(yearCoverage.entries())
    .filter(([, stocks]) => stocks.size >= threshold)
    .sort(([a], [b]) => b.localeCompare(a)); // FY26 > FY25 > FY24

  return sortedYears[0]?.[0] ?? null;
}

// ── Core computation for a single peer group ──────────────────

export async function computePeerGroupMetrics(
  peerGroupId: string,
): Promise<ComputeResult> {
  // Load peer group + its stocks
  const peerGroup = await prisma.peerGroup.findUnique({
    where: { id: peerGroupId },
    include: {
      stocks: {
        include: {
          stock: {
            select: {
              id: true,
              symbol: true,
              isActive: true,
              industryType: true,
            },
          },
        },
      },
    },
  });

  if (!peerGroup) {
    return {
      success: false,
      peerGroupId,
      peerGroupName: "Unknown",
      metrics: null,
      skipped: false,
      reason: "Peer group not found",
    };
  }

  const activeStocks = peerGroup.stocks
    .filter((s) => s.stock.isActive)
    .map((s) => s.stock);

  if (activeStocks.length < 2) {
    return {
      success: true,
      peerGroupId,
      peerGroupName: peerGroup.name,
      metrics: null,
      skipped: true,
      reason: "Less than 2 active stocks in peer group",
    };
  }

  // ── Financial-sector branch ────────────────────────────────
  // Banks / NBFCs / insurers store fundamentals in their own tables
  // (banking_fundamentals, nbfc_fundamentals, *_insurance_fundamentals),
  // NOT in `fundamentals`. The non-financial path below would find no
  // rows for them and skip. Route those groups to the financial engine,
  // which reads the right table and normalises ratio→percent scales.
  const family = dominantFinancialFamily(activeStocks);
  if (family) {
    return computeFinancialPeerGroupMetrics(
      peerGroupId,
      peerGroup.name,
      activeStocks,
      family,
    );
  }

  const stockIds = activeStocks.map((s) => s.id);

  // Determine which fiscal year to use
  const fiscalYear = await detectLatestFiscalYear(stockIds);
  if (!fiscalYear) {
    return {
      success: true,
      peerGroupId,
      peerGroupName: peerGroup.name,
      metrics: null,
      skipped: true,
      reason: "No fundamental data found for any stock in peer group",
    };
  }

  // Fetch fundamentals for all stocks in this fiscal year
  const fundamentals = await prisma.fundamental.findMany({
    where: {
      stockId: { in: stockIds },
      fiscalYear,
    },
    select: {
      stockId: true,
      roe: true,
      roce: true,
      netMargin: true,
      operatingMargin: true,
      debtToEquity: true,
      revenueGrowthYoy: true,
      interestCoverage: true,
      assetTurnover: true,
      dilutedEps: true,
      basicEps: true,
      bookValuePerShare: true,
      revenue: true,
    },
  });

  if (fundamentals.length < 2) {
    return {
      success: true,
      peerGroupId,
      peerGroupName: peerGroup.name,
      metrics: null,
      skipped: true,
      reason: `Only ${fundamentals.length} stock(s) have data for ${fiscalYear}`,
    };
  }

  // Fetch current prices to compute live P/E and P/B
  // (more accurate than the EOY price baked into fundamentals)
  const stockPrices = await prisma.stockPrice.findMany({
    where: { stockId: { in: stockIds } },
    select: { stockId: true, price: true },
  });
  const priceMap = new Map(stockPrices.map((p) => [p.stockId, toNum(p.price)]));

  // Compute live P/E and P/B using current price + per-share fundamentals.
  // eps/peRatio/pbRatio were dropped from the fundamentals table in May 2026;
  // P/E and P/B are now always derived from current price + dilutedEps/bvps.
  const liveMetrics = fundamentals.map((f) => {
    const currentPrice = priceMap.get(f.stockId);
    const eps = toNum(f.dilutedEps) ?? toNum(f.basicEps);
    const bvps = toNum(f.bookValuePerShare);

    const livePe = currentPrice && eps && eps > 0 ? currentPrice / eps : null;

    const livePb = currentPrice && bvps && bvps > 0 ? currentPrice / bvps : null;

    return {
      peRatio: livePe,
      pbRatio: livePb,
      roe: toNum(f.roe),
      roce: toNum(f.roce),
      netMargin: toNum(f.netMargin),
      operatingMargin: toNum(f.operatingMargin),
      debtToEquity: toNum(f.debtToEquity),
      revenueGrowthYoy: toNum(f.revenueGrowthYoy),
      interestCoverage: toNum(f.interestCoverage),
      assetTurnover: toNum(f.assetTurnover),
    };
  });

  // ── Compute aggregates ────────────────────────────────────
  // P/E and P/B: median (outlier-resistant)
  const avgPeRatio = round4(
    median(liveMetrics.map((m) => m.peRatio ?? 0).filter((v) => v > 0)),
  );
  const avgPbRatio = round4(
    median(liveMetrics.map((m) => m.pbRatio ?? 0).filter((v) => v > 0)),
  );

  // Profitability: mean (normally distributed within peer groups)
  const avgRoe = round4(mean(liveMetrics.map((m) => m.roe)));
  const avgRoce = round4(mean(liveMetrics.map((m) => m.roce)));
  const avgNetMargin = round4(mean(liveMetrics.map((m) => m.netMargin)));
  const avgOperatingMargin = round4(
    mean(liveMetrics.map((m) => m.operatingMargin)),
  );

  // Stability: D/E mean (exclude negative equity edge cases)
  const deValues = liveMetrics
    .map((m) => m.debtToEquity)
    .filter((v): v is number => v != null && v >= 0);
  const avgDebtToEquity = round4(mean(deValues));

  // Growth: mean (YoY revenue growth)
  const avgRevenueGrowth = round4(
    mean(liveMetrics.map((m) => m.revenueGrowthYoy)),
  );

  // Efficiency
  const avgInterestCoverage = round4(
    mean(
      liveMetrics
        .map((m) => m.interestCoverage)
        .filter((v): v is number => v != null && v > 0 && v < 1000), // cap extreme values
    ),
  );
  const avgAssetTurnover = round4(
    mean(liveMetrics.map((m) => m.assetTurnover)),
  );

  const metrics: PeerMetrics = {
    peerGroupId,
    peerGroupName: peerGroup.name,
    fiscalYear,
    stocksWithData: fundamentals.length,
    stocksTotal: activeStocks.length,
    avgPeRatio,
    avgPbRatio,
    avgRoe,
    avgRoce,
    avgNetMargin,
    avgDebtToEquity,
    avgRevenueGrowth,
    avgOperatingMargin,
    avgInterestCoverage,
    avgAssetTurnover,
    avgRevenueGrowth3y: null, // computed separately when 3Y data available
  };

  // ── Write to DB ───────────────────────────────────────────
  await prisma.peerGroup.update({
    where: { id: peerGroupId },
    data: {
      avgPeRatio: avgPeRatio != null ? new Prisma.Decimal(avgPeRatio) : null,
      avgPbRatio: avgPbRatio != null ? new Prisma.Decimal(avgPbRatio) : null,
      avgRoe: avgRoe != null ? new Prisma.Decimal(avgRoe) : null,
      avgRoce: avgRoce != null ? new Prisma.Decimal(avgRoce) : null,
      avgNetMargin:
        avgNetMargin != null ? new Prisma.Decimal(avgNetMargin) : null,
      avgDebtToEquity:
        avgDebtToEquity != null ? new Prisma.Decimal(avgDebtToEquity) : null,
      avgRevenueGrowth:
        avgRevenueGrowth != null ? new Prisma.Decimal(avgRevenueGrowth) : null,
      metricsUpdatedAt: new Date(),
    },
  });

  return {
    success: true,
    peerGroupId,
    peerGroupName: peerGroup.name,
    metrics,
    skipped: false,
  };
}

// ──────────────────────────────────────────────────────────────
// FINANCIAL-SECTOR PEER METRICS
//
// Banks, NBFCs, and insurers keep their fundamentals in dedicated
// tables with sector-specific schemas. We compute the subset of
// peer averages that are universally comparable across a financial
// peer group and store them in the SAME PeerGroup columns the
// non-financial engine uses (no schema change):
//
//   avgPeRatio        — live median, price / dilutedEps
//   avgPbRatio        — live median, price / bookValuePerShare
//   avgRoe            — mean ROE, normalised ratio→percent (×100)
//   avgNetMargin      — mean netProfit/totalIncome (banks & NBFCs only)
//   avgRevenueGrowth  — mean of the family's top-line YoY growth (percent)
//   avgDebtToEquity   — mean borrowings/equity ×100 (NBFC/HFC only; banks
//                       and insurers stay NULL — deposits/float ≠ debt)
//
// Deliberately left NULL for financials (not meaningful / no clean
// shared definition): avgRoce (lenders don't report it), and
// avgDebtToEquity for banks & insurers.
//
// Scale note (verified against the ingesters):
//   - financial `roe` is stored as a RATIO (0.15); non-financial as
//     PERCENT (15.0). We ×100 here so avgRoe is consistent percent.
//   - all *GrowthYoy fields are stored as PERCENT in both worlds — no
//     scaling applied.
// ──────────────────────────────────────────────────────────────

export type FinancialFamily =
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

/** Normalised per-stock row used by the financial aggregation. */
interface FinRow {
  stockId: string;
  fiscalYear: string;
  reportDate: Date;
  resultType: string; // "consolidated" | "standalone"
  eps: number | null; // diluted, falling back to basic
  bvps: number | null;
  roe: number | null; // RATIO as stored (×100 applied at aggregation)
  netProfit: number | null;
  income: number | null; // denominator for netMargin (null where N/A)
  growth: number | null; // family-appropriate top-line YoY growth (percent)
  leverage: number | null; // borrowings/equity RATIO (NBFC/HFC only; ×100 at aggregation)
}

/**
 * The financial family of a peer group, or null if it's non-financial
 * (→ caller uses the existing `fundamentals` path). Uses the modal
 * industryType among active stocks so a single stray misclassified
 * member can't flip the whole group.
 */
function dominantFinancialFamily(
  stocks: { industryType: string }[],
): FinancialFamily | null {
  const counts = new Map<string, number>();
  for (const s of stocks) {
    counts.set(s.industryType, (counts.get(s.industryType) ?? 0) + 1);
  }
  let modal = "non_financial";
  let best = -1;
  for (const [type, n] of counts) {
    if (n > best) {
      best = n;
      modal = type;
    }
  }
  return modal === "banking" ||
    modal === "nbfc" ||
    modal === "life_insurance" ||
    modal === "general_insurance"
    ? (modal as FinancialFamily)
    : null;
}

/** Fetch + normalise every available annual row (all years, all bases)
 *  for the given stocks from the family's fundamentals table. */
async function fetchFinancialRows(
  family: FinancialFamily,
  stockIds: string[],
): Promise<FinRow[]> {
  const common = {
    where: { stockId: { in: stockIds } },
    orderBy: { reportDate: "desc" as const },
  };

  if (family === "banking") {
    const rows = await prisma.bankingFundamental.findMany({
      ...common,
      select: {
        stockId: true,
        fiscalYear: true,
        reportDate: true,
        resultType: true,
        dilutedEps: true,
        basicEps: true,
        bookValuePerShare: true,
        roe: true,
        netProfit: true,
        totalIncome: true,
        niiGrowthYoy: true,
      },
    });
    return rows.map((r) => ({
      stockId: r.stockId,
      fiscalYear: r.fiscalYear,
      reportDate: r.reportDate,
      resultType: r.resultType,
      eps: toNum(r.dilutedEps) ?? toNum(r.basicEps),
      bvps: toNum(r.bookValuePerShare),
      roe: toNum(r.roe),
      netProfit: toNum(r.netProfit),
      income: toNum(r.totalIncome),
      growth: toNum(r.niiGrowthYoy),
      leverage: null, // banks: deposits ≠ debt → no D/E
    }));
  }

  if (family === "nbfc") {
    const rows = await prisma.nbfcFundamental.findMany({
      ...common,
      select: {
        stockId: true,
        fiscalYear: true,
        reportDate: true,
        resultType: true,
        dilutedEps: true,
        basicEps: true,
        bookValuePerShare: true,
        roe: true,
        netProfit: true,
        totalIncome: true,
        revenueGrowthYoy: true,
        borrowingsToEquity: true,
      },
    });
    return rows.map((r) => ({
      stockId: r.stockId,
      fiscalYear: r.fiscalYear,
      reportDate: r.reportDate,
      resultType: r.resultType,
      eps: toNum(r.dilutedEps) ?? toNum(r.basicEps),
      bvps: toNum(r.bookValuePerShare),
      roe: toNum(r.roe),
      netProfit: toNum(r.netProfit),
      income: toNum(r.totalIncome),
      growth: toNum(r.revenueGrowthYoy),
      leverage: toNum(r.borrowingsToEquity), // NBFC/HFC: borrowings/equity ratio
    }));
  }

  if (family === "life_insurance") {
    const rows = await prisma.lifeInsuranceFundamental.findMany({
      ...common,
      select: {
        stockId: true,
        fiscalYear: true,
        reportDate: true,
        resultType: true,
        dilutedEps: true,
        basicEps: true,
        bookValuePerShare: true,
        roe: true,
        netProfit: true,
        premiumGrowthYoy: true,
      },
    });
    return rows.map((r) => ({
      stockId: r.stockId,
      fiscalYear: r.fiscalYear,
      reportDate: r.reportDate,
      resultType: r.resultType,
      eps: toNum(r.dilutedEps) ?? toNum(r.basicEps),
      bvps: toNum(r.bookValuePerShare),
      roe: toNum(r.roe),
      netProfit: toNum(r.netProfit),
      income: null, // no clean shared revenue base → netMargin omitted
      growth: toNum(r.premiumGrowthYoy),
      leverage: null,
    }));
  }

  // general_insurance
  const rows = await prisma.generalInsuranceFundamental.findMany({
    ...common,
    select: {
      stockId: true,
      fiscalYear: true,
      reportDate: true,
      resultType: true,
      dilutedEps: true,
      basicEps: true,
      bookValuePerShare: true,
      roe: true,
      netProfit: true,
      gpwGrowthYoy: true,
    },
  });
  return rows.map((r) => ({
    stockId: r.stockId,
    fiscalYear: r.fiscalYear,
    reportDate: r.reportDate,
    resultType: r.resultType,
    eps: toNum(r.dilutedEps) ?? toNum(r.basicEps),
    bvps: toNum(r.bookValuePerShare),
    roe: toNum(r.roe),
    netProfit: toNum(r.netProfit),
    income: null,
    growth: toNum(r.gpwGrowthYoy),
    leverage: null,
  }));
}

/** Most recent fiscal year with data for at least half the stocks
 *  (min 2). Mirrors detectLatestFiscalYear but operates on already-
 *  fetched rows so the financial path needs only one query. */
function detectLatestFiscalYearFromRows(
  rows: FinRow[],
  stockCount: number,
): string | null {
  const yearCoverage = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!yearCoverage.has(r.fiscalYear)) {
      yearCoverage.set(r.fiscalYear, new Set());
    }
    yearCoverage.get(r.fiscalYear)!.add(r.stockId);
  }
  const threshold = Math.max(2, Math.floor(stockCount / 2));
  const sortedYears = Array.from(yearCoverage.entries())
    .filter(([, stocks]) => stocks.size >= threshold)
    .sort(([a], [b]) => b.localeCompare(a));
  return sortedYears[0]?.[0] ?? null;
}

export async function computeFinancialPeerGroupMetrics(
  peerGroupId: string,
  peerGroupName: string,
  activeStocks: { id: string }[],
  family: FinancialFamily,
): Promise<ComputeResult> {
  const stockIds = activeStocks.map((s) => s.id);

  const allRows = await fetchFinancialRows(family, stockIds);
  if (allRows.length === 0) {
    return {
      success: true,
      peerGroupId,
      peerGroupName,
      metrics: null,
      skipped: true,
      reason: `No ${family} fundamental data found for any stock in peer group`,
    };
  }

  const fiscalYear = detectLatestFiscalYearFromRows(allRows, activeStocks.length);
  if (!fiscalYear) {
    return {
      success: true,
      peerGroupId,
      peerGroupName,
      metrics: null,
      skipped: true,
      reason: `No ${family} fundamental data found for any stock in peer group`,
    };
  }

  // One row per stock for the chosen year, preferring consolidated basis
  // (matches the scoring read layer's convention) to avoid double-counting
  // the dual-basis rows.
  const byStock = new Map<string, FinRow>();
  for (const r of allRows) {
    if (r.fiscalYear !== fiscalYear) continue;
    const existing = byStock.get(r.stockId);
    if (!existing || (r.resultType === "consolidated" && existing.resultType !== "consolidated")) {
      byStock.set(r.stockId, r);
    }
  }
  const perStock = Array.from(byStock.values());

  if (perStock.length < 2) {
    return {
      success: true,
      peerGroupId,
      peerGroupName,
      metrics: null,
      skipped: true,
      reason: `Only ${perStock.length} stock(s) have ${family} data for ${fiscalYear}`,
    };
  }

  // Current prices for live P/E and P/B
  const stockPrices = await prisma.stockPrice.findMany({
    where: { stockId: { in: stockIds } },
    select: { stockId: true, price: true },
  });
  const priceMap = new Map(stockPrices.map((p) => [p.stockId, toNum(p.price)]));

  const peValues: number[] = [];
  const pbValues: number[] = [];
  const roeValues: number[] = [];
  const marginValues: number[] = [];
  const growthValues: number[] = [];
  const deValues: number[] = [];

  for (const r of perStock) {
    const price = priceMap.get(r.stockId);
    if (price && r.eps && r.eps > 0) peValues.push(price / r.eps);
    if (price && r.bvps && r.bvps > 0) pbValues.push(price / r.bvps);
    if (r.roe != null) roeValues.push(r.roe * 100); // ratio → percent
    if (r.netProfit != null && r.income != null && r.income > 0) {
      marginValues.push((r.netProfit / r.income) * 100);
    }
    if (r.growth != null) growthValues.push(r.growth);
    // NBFC/HFC leverage (borrowings/equity) → percent, to match the
    // non-financial avg_debt_to_equity scale (which stores ratio×100).
    if (r.leverage != null && r.leverage >= 0) deValues.push(r.leverage * 100);
  }

  const avgPeRatio = round4(median(peValues));
  const avgPbRatio = round4(median(pbValues));
  const avgRoe = round4(mean(roeValues));
  const avgNetMargin = marginValues.length ? round4(mean(marginValues)) : null;
  const avgRevenueGrowth = growthValues.length
    ? round4(mean(growthValues))
    : null;
  const avgDebtToEquity = deValues.length ? round4(mean(deValues)) : null;

  const metrics: PeerMetrics = {
    peerGroupId,
    peerGroupName,
    fiscalYear,
    stocksWithData: perStock.length,
    stocksTotal: activeStocks.length,
    avgPeRatio,
    avgPbRatio,
    avgRoe,
    avgRoce: null, // N/A for financials (lenders don't report ROCE)
    avgNetMargin,
    avgDebtToEquity, // NBFC/HFC: borrowings/equity; banks & insurers: null
    avgRevenueGrowth,
    avgOperatingMargin: null,
    avgInterestCoverage: null,
    avgAssetTurnover: null,
    avgRevenueGrowth3y: null,
  };

  await prisma.peerGroup.update({
    where: { id: peerGroupId },
    data: {
      avgPeRatio: avgPeRatio != null ? new Prisma.Decimal(avgPeRatio) : null,
      avgPbRatio: avgPbRatio != null ? new Prisma.Decimal(avgPbRatio) : null,
      avgRoe: avgRoe != null ? new Prisma.Decimal(avgRoe) : null,
      avgRoce: null,
      avgNetMargin:
        avgNetMargin != null ? new Prisma.Decimal(avgNetMargin) : null,
      avgDebtToEquity:
        avgDebtToEquity != null ? new Prisma.Decimal(avgDebtToEquity) : null,
      avgRevenueGrowth:
        avgRevenueGrowth != null ? new Prisma.Decimal(avgRevenueGrowth) : null,
      metricsUpdatedAt: new Date(),
    },
  });

  return {
    success: true,
    peerGroupId,
    peerGroupName,
    metrics,
    skipped: false,
  };
}

// ── Bulk compute: all peer groups ─────────────────────────────

export async function computeAllPeerGroupMetrics(
  onBatchComplete?: BatchProgressFn,
): Promise<BulkComputeResult> {
  const start = Date.now();

  const allGroups = await prisma.peerGroup.findMany({
    select: { id: true, name: true },
    orderBy: { buildOrder: "asc" },
  });

  console.log(
    `[PeerMetrics] Computing metrics for ${allGroups.length} peer groups…`,
  );

  const results: ComputeResult[] = [];
  const errors: { name: string; reason: string }[] = [];
  let computed = 0;
  let skipped = 0;
  let failed = 0;
  let fiscalYear = "unknown";

  for (let idx = 0; idx < allGroups.length; idx++) {
    const group = allGroups[idx];
    try {
      const result = await computePeerGroupMetrics(group.id);
      results.push(result);

      if (result.skipped) {
        skipped++;
        console.log(`[PeerMetrics] Skipped: ${group.name} — ${result.reason}`);
      } else if (result.success) {
        computed++;
        fiscalYear = result.metrics?.fiscalYear ?? fiscalYear;
        console.log(
          `[PeerMetrics] ✓ ${group.name} | ` +
            `PE: ${result.metrics?.avgPeRatio ?? "n/a"} | ` +
            `ROE: ${result.metrics?.avgRoe ?? "n/a"} | ` +
            `stocks: ${result.metrics?.stocksWithData}/${result.metrics?.stocksTotal}`,
        );
      }
    } catch (e) {
      failed++;
      const reason = (e as Error).message;
      console.error(`[PeerMetrics] ✗ ${group.name}:`, reason);
      errors.push({ name: group.name, reason });
      results.push({
        success: false,
        peerGroupId: group.id,
        peerGroupName: group.name,
        metrics: null,
        skipped: false,
        reason,
      });
    }

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        idx + 1,
        allGroups.length,
        group.name,
      );
      if (!shouldContinue) break;
    }
  }

  const durationMs = Date.now() - start;

  console.log(
    `[PeerMetrics] Done — computed: ${computed}, skipped: ${skipped}, failed: ${failed}, took ${durationMs}ms`,
  );

  return {
    totalGroups: allGroups.length,
    computed,
    skipped,
    failed,
    fiscalYear,
    results,
    durationMs,
    errors,
  };
}

// ── Compute for a single sector ────────────────────────────────

export async function computeSectorPeerGroupMetrics(
  sectorId: string,
): Promise<BulkComputeResult> {
  const start = Date.now();

  const groups = await prisma.peerGroup.findMany({
    where: { sectorId },
    select: { id: true, name: true },
    orderBy: { buildOrder: "asc" },
  });

  const results: ComputeResult[] = [];
  let computed = 0;
  let skipped = 0;
  let failed = 0;
  let fiscalYear = "unknown";

  for (const group of groups) {
    try {
      const result = await computePeerGroupMetrics(group.id);
      results.push(result);
      if (result.skipped) skipped++;
      else if (result.success) {
        computed++;
        fiscalYear = result.metrics?.fiscalYear ?? fiscalYear;
      }
    } catch (e) {
      failed++;
      results.push({
        success: false,
        peerGroupId: group.id,
        peerGroupName: group.name,
        metrics: null,
        skipped: false,
        reason: (e as Error).message,
      });
    }
  }

  return {
    totalGroups: groups.length,
    computed,
    skipped,
    failed,
    fiscalYear,
    results,
    durationMs: Date.now() - start,
  };
}
