import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import {
  ingestShareholdingForStock,
} from "../../ingestions/shareholdings/ingest-shareholding.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

// ── Format helper ─────────────────────────────────────────────

function fmt(v: { toString(): string } | null) {
  return v != null ? parseFloat(v.toString()) : null;
}

function formatPattern(
  p: Awaited<ReturnType<typeof prisma.shareholdingPattern.findMany>>[0],
) {
  return {
    id: p.id,
    quarter: p.quarter,
    fiscalYear: p.fiscalYear,
    asOnDate: p.asOnDate.toISOString().split("T")[0],

    promoterPct: fmt(p.promoterPct),
    publicPct: fmt(p.publicPct),
    employeeTrustPct: fmt(p.employeeTrustPct),

    fiiPct: fmt(p.fiiPct),
    diiPct: fmt(p.diiPct),
    retailPct: fmt(p.retailPct),
    othersPct: fmt(p.othersPct),

    mutualFundPct: fmt(p.mutualFundPct),
    insurancePct: fmt(p.insurancePct),
    banksFisPct: fmt(p.banksFisPct),

    promoterPledgedPct: fmt(p.promoterPledgedPct),
    promoterPledgedSharesPct: fmt(p.promoterPledgedSharesPct),

    totalShares: p.totalShares?.toString() ?? null,
    promoterShares: p.promoterShares?.toString() ?? null,
    pledgedShares: p.pledgedShares?.toString() ?? null,
  };
}

export const getShareHoldingForStock = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const quarters = Math.min(parseInt(req.query.quarters as string) || 8, 20);

    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, name: true },
    });
    if (!stock) {
      return res
        .status(404)
        .json({ success: false, error: `${symbol} not in universe` });
    }

    const patterns = await prisma.shareholdingPattern.findMany({
      where: { stockId: stock.id },
      orderBy: { asOnDate: "desc" },
      take: quarters,
    });

    // Compute QoQ trends for institutional category
    const withTrends = patterns.map((p, i) => {
      const prev = patterns[i + 1];
      return {
        ...formatPattern(p),
        trends: prev
          ? {
              promoterQoQ:
                fmt(p.promoterPct) != null && fmt(prev.promoterPct) != null
                  ? Math.round(
                      (fmt(p.promoterPct)! - fmt(prev.promoterPct)!) * 100,
                    ) / 100
                  : null,
              fiiQoQ:
                fmt(p.fiiPct) != null && fmt(prev.fiiPct) != null
                  ? Math.round((fmt(p.fiiPct)! - fmt(prev.fiiPct)!) * 100) / 100
                  : null,
              pledgedQoQ:
                fmt(p.promoterPledgedPct) != null &&
                fmt(prev.promoterPledgedPct) != null
                  ? Math.round(
                      (fmt(p.promoterPledgedPct)! -
                        fmt(prev.promoterPledgedPct)!) *
                        100,
                    ) / 100
                  : null,
            }
          : null,
      };
    });

    return res.json({
      success: true,
      data: {
        symbol: stock.symbol,
        name: stock.name,
        patterns: withTrends,
      },
    });
  } catch (err) {
    console.error("[shareholding/symbol]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch shareholding" });
  }
};

export const getLatestShareHoldingForStock = async (
  req: Request,
  res: Response,
) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();

    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true },
    });
    if (!stock) {
      return res
        .status(404)
        .json({ success: false, error: `${symbol} not in universe` });
    }

    const latest = await prisma.shareholdingPattern.findFirst({
      where: { stockId: stock.id },
      orderBy: { asOnDate: "desc" },
    });

    if (!latest) {
      return res
        .status(404)
        .json({ success: false, error: "No shareholding data yet" });
    }

    return res.json({ success: true, data: formatPattern(latest) });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed" });
  }
};

export const getShareholdingLogs = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit as string) || 50),
  );
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    prisma.shareholdingFetchLog.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.shareholdingFetchLog.count(),
  ]);

  return res.json({
    success: true,
    data: logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
};

export const triggerQuarterlyShareholdingIngest = async (
  _req: Request,
  res: Response,
) => {
  try {
    const job = await enqueueJob({
      type: JobTypes.SHAREHOLDING_QUARTERLY,
      payload: {},
      triggeredBy: "user:admin",
    });
    return res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        statusUrl: `/api/v1/admin/jobs/${job.id}`,
        message: "Quarterly shareholding ingest enqueued. Poll the status URL for progress.",
      },
    });
  } catch (err) {
    console.error("Quarterly shareholding ingest enqueue failed:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to enqueue quarterly shareholding ingest",
      errorDetails: err instanceof Error ? err.message : String(err),
    });
  }
};

export const triggerSmartShareholdingRefresh = async (
  _req: Request,
  res: Response,
) => {
  try {
    const job = await enqueueJob({
      type: JobTypes.SHAREHOLDING_SMART_REFRESH,
      payload: {},
      triggeredBy: "user:admin",
    });
    return res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        statusUrl: `/api/v1/admin/jobs/${job.id}`,
        message: "Smart shareholding refresh enqueued. Poll the status URL for progress.",
      },
    });
  } catch (err) {
    console.error("Smart shareholding refresh enqueue failed:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to enqueue smart shareholding refresh",
      errorDetails: err instanceof Error ? err.message : String(err),
    });
  }
};

export const backfillShareholding = async (req: Request, res: Response) => {
  const quartersBack = Math.min(parseInt(req.body?.quarters ?? "12"), 40);

  try {
    const job = await enqueueJob({
      type: JobTypes.SHAREHOLDING_BACKFILL,
      payload: { quartersBack },
      triggeredBy: "user:admin",
    });
    return res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        statusUrl: `/api/v1/admin/jobs/${job.id}`,
        message: `Shareholding backfill for last ${quartersBack} quarters enqueued. Poll the status URL for progress.`,
      },
    });
  } catch (err) {
    console.error("Shareholding backfill enqueue failed:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to enqueue shareholding backfill",
      errorDetails: err instanceof Error ? err.message : String(err),
    });
  }
};

export const triggerManualShareholdingIngestForStock = async (
  req: Request,
  res: Response,
) => {
  const symbol = (req.params.symbol as string).toUpperCase();
  const quarters = Math.min(parseInt(req.body?.quarters ?? "8"), 20);

  try {
    const result = await ingestShareholdingForStock(symbol, quarters);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};
