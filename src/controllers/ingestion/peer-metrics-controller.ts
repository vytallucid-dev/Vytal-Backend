import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { runManualPeerMetrics } from "../../ingestions/peer-metrics/peer-metrics.service.js";
import { ComputeBodySchema, PeerMetricsLogsQuerySchema } from "../../schema/schema.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

const fmt = (v: { toString(): string } | null) =>
  v != null ? parseFloat(v.toString()) : null;

export const getAllPeerGroupsList = async (req: Request, res: Response) => {
  try {
    const { sectorId, sectorName } = req.query as Record<string, string>;

    const groups = await prisma.peerGroup.findMany({
      where: {
        ...(sectorId ? { sectorId } : {}),
        ...(sectorName
          ? { sector: { name: { contains: sectorName, mode: "insensitive" } } }
          : {}),
      },
      include: {
        sector: { select: { name: true, displayName: true } },
        _count: { select: { stocks: true } },
      },
      orderBy: [{ sectorId: "asc" }, { buildOrder: "asc" }],
    });

    return res.json({
      success: true,
      data: groups.map((g) => ({
        id: g.id,
        name: g.name,
        displayName: g.displayName,
        sector: g.sector.displayName,
        stockCount: g._count.stocks,
        buildOrder: g.buildOrder,
        metricsUpdatedAt: g.metricsUpdatedAt?.toISOString() ?? null,
        hasMetrics: g.metricsUpdatedAt != null,
        metrics: {
          avgPeRatio: fmt(g.avgPeRatio),
          avgPbRatio: fmt(g.avgPbRatio),
          avgRoe: fmt(g.avgRoe),
          avgRoce: fmt(g.avgRoce),
          avgNetMargin: fmt(g.avgNetMargin),
          avgDebtToEquity: fmt(g.avgDebtToEquity),
          avgRevenueGrowth: fmt(g.avgRevenueGrowth),
        },
      })),
    });
  } catch (err) {
    console.error("[peer-groups]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch peer groups" });
  }
};

export const getSinglePeerGroupDetail = async (req: Request, res: Response) => {
  try {
    const group = await prisma.peerGroup.findUnique({
      where: { id: req.params.id as string },
      include: {
        sector: { select: { name: true, displayName: true } },
        _count: { select: { stocks: true } },
      },
    });

    if (!group) {
      return res
        .status(404)
        .json({ success: false, error: "Peer group not found" });
    }

    return res.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        displayName: group.displayName,
        sector: {
          name: group.sector.name,
          displayName: group.sector.displayName,
        },
        stockCount: group._count.stocks,
        buildOrder: group.buildOrder,
        metricsUpdatedAt: group.metricsUpdatedAt?.toISOString() ?? null,
        metrics: {
          avgPeRatio: fmt(group.avgPeRatio),
          avgPbRatio: fmt(group.avgPbRatio),
          avgRoe: fmt(group.avgRoe),
          avgRoce: fmt(group.avgRoce),
          avgNetMargin: fmt(group.avgNetMargin),
          avgDebtToEquity: fmt(group.avgDebtToEquity),
          avgRevenueGrowth: fmt(group.avgRevenueGrowth),
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed" });
  }
};

export const getALlStockInPeerGroupWithMetrics = async (
  req: Request,
  res: Response,
) => {
  try {
    const group = await prisma.peerGroup.findUnique({
      where: { id: req.params.id as string },
      select: {
        name: true,
        displayName: true,
        avgPeRatio: true,
        avgRoe: true,
        avgNetMargin: true,
      },
    });

    if (!group) {
      return res
        .status(404)
        .json({ success: false, error: "Peer group not found" });
    }

    // Get all stocks in this peer group
    const memberships = await prisma.stockPeerGroup.findMany({
      where: { peerGroupId: req.params.id as string },
      include: {
        stock: {
          select: {
            id: true,
            symbol: true,
            name: true,
            marketCapCategory: true,
          },
        },
      },
    });

    const stockIds = memberships.map((m) => m.stock.id);

    // Get latest fundamentals for each stock
    const fundamentals = await prisma.fundamental.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: { reportDate: "desc" },
      distinct: ["stockId"],
      select: {
        stockId: true,
        fiscalYear: true,
        revenue: true,
        netProfit: true,
        netMargin: true,
        operatingMargin: true,
        roe: true,
        roce: true,
        debtToEquity: true,
        revenueGrowthYoy: true,
        dilutedEps: true,
        basicEps: true,
        bookValuePerShare: true,
        ebitda: true,
        interestCoverage: true,
      },
    });

    const fundamentalMap = new Map(fundamentals.map((f) => [f.stockId, f]));

    // Get current prices
    const prices = await prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true },
    });
    const priceMap = new Map(prices.map((p) => [p.stockId, fmt(p.price)]));

    const stocks = memberships.map((m) => {
      const fund = fundamentalMap.get(m.stock.id);
      const currentPrice = priceMap.get(m.stock.id);

      const eps = fund ? (fmt(fund.dilutedEps) ?? fmt(fund.basicEps)) : null;
      const bvps = fund ? fmt(fund.bookValuePerShare) : null;
      const livePe =
        currentPrice && eps && eps > 0
          ? Math.round((currentPrice / eps) * 100) / 100
          : null;
      const livePb =
        currentPrice && bvps && bvps > 0
          ? Math.round((currentPrice / bvps) * 100) / 100
          : null;

      return {
        id: m.stock.id,
        symbol: m.stock.symbol,
        name: m.stock.name,
        marketCapCategory: m.stock.marketCapCategory,
        currentPrice,
        fiscalYear: fund?.fiscalYear ?? null,
        revenue: fund ? fmt(fund.revenue) : null,
        netProfit: fund ? fmt(fund.netProfit) : null,
        netMargin: fund ? fmt(fund.netMargin) : null,
        operatingMargin: fund ? fmt(fund.operatingMargin) : null,
        roe: fund ? fmt(fund.roe) : null,
        roce: fund ? fmt(fund.roce) : null,
        peRatio: livePe,
        pbRatio: livePb,
        debtToEquity: fund ? fmt(fund.debtToEquity) : null,
        revenueGrowthYoy: fund ? fmt(fund.revenueGrowthYoy) : null,
        eps,
        ebitda: fund ? fmt(fund.ebitda) : null,
        interestCoverage: fund ? fmt(fund.interestCoverage) : null,
        hasFundamentals: fund != null,
      };
    });

    return res.json({
      success: true,
      data: {
        peerGroup: {
          name: group.name,
          displayName: group.displayName,
          // Peer averages for relative comparison
          benchmarks: {
            avgPeRatio: fmt(group.avgPeRatio),
            avgRoe: fmt(group.avgRoe),
            avgNetMargin: fmt(group.avgNetMargin),
          },
        },
        stocks: stocks.sort((a, b) => {
          // Sort by revenue desc (largest first)
          const ra = a.revenue ?? 0;
          const rb = b.revenue ?? 0;
          return rb - ra;
        }),
      },
    });
  } catch (err) {
    console.error("[peer-groups/stocks]", err);
    return res.status(500).json({ success: false, error: "Failed" });
  }
};

export const computePeerGroupMetrics = async (req: Request, res: Response) => {
  const body = ComputeBodySchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid body",
      details: body.error.flatten(),
    });
  }

  const { scope, sectorId, peerGroupId } = body.data;

  // Validate scope + params
  if (scope === "sector" && !sectorId) {
    return res
      .status(400)
      .json({ success: false, error: "sectorId required for scope=sector" });
  }
  if (scope === "single" && !peerGroupId) {
    return res
      .status(400)
      .json({ success: false, error: "peerGroupId required for scope=single" });
  }

  // For 'all' — enqueue as a tracked job and return 202 with jobId
  // For 'sector' or 'single' — run synchronously (fast enough)
  if (scope === "all") {
    const job = await enqueueJob({
      type: JobTypes.PEER_METRICS_COMPUTE_ALL,
      payload: {},
      triggeredBy: "user:admin",
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        statusUrl: `/api/v1/admin/jobs/${job.id}`,
        message: "Peer metrics computation for all groups enqueued. Poll the status URL for progress.",
      },
    });
  }

  try {
    const result = await runManualPeerMetrics({ scope, sectorId, peerGroupId });
    return res.json({
      success: true,
      data: {
        scope,
        totalGroups: result.totalGroups,
        computed: result.computed,
        skipped: result.skipped,
        failed: result.failed,
        fiscalYear: result.fiscalYear,
        durationMs: result.durationMs,
        results: result.results.map((r) => ({
          peerGroupName: r.peerGroupName,
          skipped: r.skipped,
          reason: r.reason,
          metrics: r.metrics
            ? {
                fiscalYear: r.metrics.fiscalYear,
                stocksWithData: r.metrics.stocksWithData,
                stocksTotal: r.metrics.stocksTotal,
                avgPeRatio: r.metrics.avgPeRatio,
                avgPbRatio: r.metrics.avgPbRatio,
                avgRoe: r.metrics.avgRoe,
                avgRoce: r.metrics.avgRoce,
                avgNetMargin: r.metrics.avgNetMargin,
                avgDebtToEquity: r.metrics.avgDebtToEquity,
                avgRevenueGrowth: r.metrics.avgRevenueGrowth,
              }
            : null,
        })),
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

export const getPeerMetricsLogs = async (req: Request, res: Response) => {
  try {
    const query = PeerMetricsLogsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid query parameters",
        details: query.error.flatten(),
      });
    }

    const { page, limit, status, runType, triggerType } = query.data;
    const skip = (page - 1) * limit;

    const where = {
      ...(status !== "all" ? { status } : {}),
      ...(runType !== "all" ? { runType } : {}),
      ...(triggerType !== "all" ? { triggerType } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.peerGroupComputationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          runType: true,
          triggerType: true,
          fiscalYear: true,
          groupsComputed: true,
          groupsSkipped: true,
          status: true,
          error: true,
          durationMs: true,
          createdAt: true,
          // omit computedSnapshot — too large for list view
        },
      }),
      prisma.peerGroupComputationLog.count({ where }),
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed" });
  }
};
