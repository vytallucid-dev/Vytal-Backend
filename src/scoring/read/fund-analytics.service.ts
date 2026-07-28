// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FUND ANALYTICS — the per-scheme MF/ETF analytics read, EXTRACTED VERBATIM from the controller.
//
// ★ THIS IS A MOVE, NOT A REWRITE. The two lookups (mf_analytics by scheme code + the instrument
// identity fenced to mutual_fund|etf), the rank-bucket parse, the whole response projection and the
// `explainOmissions` expansion are lifted unchanged from `getFundAnalytics`
// (controllers/ingestion/mf-controllers.ts), which now calls this and only shapes the HTTP envelope.
//
// ⚠ WHAT IS NOT HERE IS NOT AN OVERSIGHT. `MfAnalytics` carries returns, risk, rolling-1y, rank and
// benchmark — it does NOT carry portfolio HOLDINGS or the EXPENSE RATIO, because neither is ingested.
// Callers must render those as honestly absent rather than implying the data exists (the chat tool
// states it in words). Every null that IS here already ships with its reason in `omissions`.
//
// CONVENTION MATCH: returns null when no analytics row exists (the endpoint's 404) — the same
// "null ⇔ nothing to read" signal the other read services give.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { parseBucket } from "../../ingestions/amfi/mf-category.js";
import { explainOmissions } from "../../ingestions/amfi/mf-omissions.js";

/** Named in the risk-free omission text so the reader knows WHICH series fell short. */
const RISK_FREE_INDEX_HINT = "Nifty 1D Rate Index";

/** The analytics payload, exactly as the endpoint has always shaped it. */
export interface FundAnalyticsView {
  schemeCode: string;
  scheme: {
    name: string | null;
    symbol: string | null;
    assetClass: string;
    fundHouse: string | null;
    category: string | null;
    planType: string | null;
    currentNav: unknown;
    navDate: Date | null;
    isActive: boolean;
  } | null;
  asOfDate: Date | null;
  navPoints: number | null;
  returns: Record<string, unknown>;
  risk: Record<string, unknown>;
  rolling1y: Record<string, unknown>;
  rank: Record<string, unknown> | null;
  benchmark: Record<string, unknown>;
  omissions: unknown;
  computedAt: Date | null;
}

/** Computed analytics for one AMFI scheme code. null ⇔ no analytics row folded yet. */
export async function buildFundAnalyticsView(schemeCode: string): Promise<FundAnalyticsView | null> {
  const row = await prisma.mfAnalytics.findUnique({ where: { schemeCode } });
  if (!row) return null;

  // ETFs are AMFI funds too — fencing to 'mutual_fund' would serve metrics with a NULL identity block.
  const inst = await prisma.instrument.findFirst({
    where: { amfiSchemeCode: schemeCode, assetClass: { in: ["mutual_fund", "etf"] } },
    select: { symbol: true, assetClass: true, schemeName: true, fundHouse: true, category: true, planType: true, currentNav: true, navDate: true, isActive: true },
  });

  const bucket = row.rankBucket ? parseBucket(row.rankBucket) : null;

  return {
    schemeCode,
    scheme: inst
      ? {
          name: inst.schemeName,
          symbol: inst.symbol,
          assetClass: inst.assetClass,
          fundHouse: inst.fundHouse,
          category: inst.category,
          planType: inst.planType,
          currentNav: inst.currentNav,
          navDate: inst.navDate,
          isActive: inst.isActive,
        }
      : null,
    asOfDate: row.asOfDate,
    navPoints: row.navPoints,
    returns: {
      m1: row.ret1m, m3: row.ret3m, m6: row.ret6m, y1: row.ret1y,
      y3Cagr: row.ret3yCagr, y5Cagr: row.ret5yCagr,
    },
    risk: {
      vol1y: row.vol1y, vol3y: row.vol3y,
      sharpe1y: row.sharpe1y, sharpe3y: row.sharpe3y, sharpe5y: row.sharpe5y,
      sortino1y: row.sortino1y, sortino3y: row.sortino3y,
      maxDrawdown1y: row.maxDrawdown1y, maxDrawdown3y: row.maxDrawdown3y, maxDrawdown5y: row.maxDrawdown5y,
    },
    rolling1y: {
      n: row.roll1yN, min: row.roll1yMin, max: row.roll1yMax,
      avg: row.roll1yAvg, pctPositive: row.roll1yPctPositive,
    },
    rank: bucket
      ? {
          category: bucket.leaf,
          planType: bucket.planType,
          bucketSize: row.rankBucketSize,
          y1: row.rank1y, y3: row.rank3y, y5: row.rank5y,
          pool1y: row.rankPool1y, pool3y: row.rankPool3y, pool5y: row.rankPool5y,
          pct1y: row.pct1y, pct3y: row.pct3y, pct5y: row.pct5y,
        }
      : null,
    benchmark: {
      index: row.benchmarkIndex,
      via: row.benchmarkVia,
      beta1y: row.beta1y, beta3y: row.beta3y, beta5y: row.beta5y,
      alpha1y: row.alpha1y, alpha3y: row.alpha3y, alpha5y: row.alpha5y,
      trackingError1y: row.trackingError1y, trackingError3y: row.trackingError3y, trackingError5y: row.trackingError5y,
    },
    omissions: explainOmissions(row.omissions, {
      navPoints: row.navPoints,
      windowFrom: row.windowFrom,
      asOfDate: row.asOfDate,
      rankBucketSize: row.rankBucketSize,
      riskFreeIndex: RISK_FREE_INDEX_HINT,
    }),
    computedAt: row.computedAt,
  };
}
