import type { Request, Response } from "express";
import { BackfillSchema, DealsQuerySchema, FetchLogsQuerySchema } from "../../schema/schema.js";
import { prisma } from "../../db/prisma.js";
import {
  runDailyDealIngest,
} from "../../ingestions/block-deals/ingest-deals.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

export const getDealsForSymbol = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();

    const query = DealsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid query params",
        details: query.error.flatten(),
      });
    }

    const { type, side, days, page, limit } = query.data;
    const skip = (page - 1) * limit;

    // Build date range
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    // Find stock
    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, name: true, symbol: true },
    });
    if (!stock) {
      return res.status(404).json({
        success: false,
        error: `Stock ${symbol} not found in universe`,
      });
    }

    // Build filter
    const where: NonNullable<
      Parameters<typeof prisma.blockDeal.findMany>[0]
    >["where"] = {
      stockId: stock.id,
      dealDate: { gte: since },
      ...(type !== "all" ? { dealType: type } : {}),
      ...(side !== "all" ? { transactionType: side } : {}),
    };

    const [deals, total] = await prisma.$transaction([
      prisma.blockDeal.findMany({
        where,
        orderBy: { dealDate: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          dealDate: true,
          dealType: true,
          clientName: true,
          transactionType: true,
          quantity: true,
          price: true,
          valueCr: true,
          remarks: true,
        },
      }),
      prisma.blockDeal.count({ where }),
    ]);

    // Compute summary stats
    const buyCount = deals.filter((d) => d.transactionType === "buy").length;
    const sellCount = deals.length - buyCount;
    const totalValueCr = deals.reduce(
      (sum, d) => sum + parseFloat(d.valueCr?.toString() ?? "0"),
      0,
    );

    return res.json({
      success: true,
      data: {
        stock: { symbol: stock.symbol, name: stock.name },
        summary: {
          total,
          buyCount,
          sellCount,
          totalValueCr: Math.round(totalValueCr * 100) / 100,
        },
        deals: deals.map((d) => ({
          ...d,
          quantity: d.quantity.toString(), // BigInt → string for JSON
          price: parseFloat(d.price.toString()),
          valueCr: parseFloat(d.valueCr?.toString() ?? "0"),
          dealDate: d.dealDate.toISOString().split("T")[0],
        })),
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error("[deals/symbol] error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch deals" });
  }
};

export const getDealLogs = async (req: Request, res: Response) => {
  const query = FetchLogsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query params",
      details: query.error.flatten(),
    });
  }

  const { status, fetchType, page, limit } = query.data;
  const skip = (page - 1) * limit;

  const where = {
    ...(status !== "all" ? { status } : {}),
    ...(fetchType !== "all" ? { fetchType } : {}),
  };

  const [logs, total] = await prisma.$transaction([
    prisma.dealFetchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        fetchDate: true,
        fetchType: true,
        status: true,
        totalFetched: true,
        totalInserted: true,
        totalSkipped: true,
        durationMs: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.dealFetchLog.count({ where }),
  ]);

  return res.json({
    success: true,
    data: {
      logs: logs.map((l) => ({
        ...l,
        fetchDate: l.fetchDate.toISOString().split("T")[0],
        createdAt: l.createdAt.toISOString(),
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    },
  });
};

export const triggerDailyIngest = async (_req: Request, res: Response) => {
  try {
    console.log("[Admin] Manual deal ingest triggered");
    const result = await runDailyDealIngest();
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

export const triggerBackfillIngest = async (req: Request, res: Response) => {
  const body = BackfillSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ success: false, error: "Invalid body" });
  }

  const job = await enqueueJob({
    type: JobTypes.DEALS_BACKFILL,
    payload: { days: body.data.days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Deals backfill for last ${body.data.days} days enqueued. Poll the status URL for progress.`,
    },
  });
};
