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
      peRatio: true,
      pbRatio: true,
      roe: true,
      roce: true,
      netMargin: true,
      operatingMargin: true,
      debtToEquity: true,
      revenueGrowthYoy: true,
      interestCoverage: true,
      assetTurnover: true,
      eps: true,
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

  // Compute live P/E and P/B using current price + fundamentals
  // Fall back to stored peRatio/pbRatio from fundamentals tables if price unavailable
  const liveMetrics = fundamentals.map((f) => {
    const currentPrice = priceMap.get(f.stockId);
    const eps = toNum(f.eps);
    const bvps = toNum(f.bookValuePerShare);

    const livePe =
      currentPrice && eps && eps > 0 ? currentPrice / eps : toNum(f.peRatio);

    const livePb =
      currentPrice && bvps && bvps > 0 ? currentPrice / bvps : toNum(f.pbRatio);

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
      console.error(`[PeerMetrics] ✗ ${group.name}:`, (e as Error).message);
      results.push({
        success: false,
        peerGroupId: group.id,
        peerGroupName: group.name,
        metrics: null,
        skipped: false,
        reason: (e as Error).message,
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
