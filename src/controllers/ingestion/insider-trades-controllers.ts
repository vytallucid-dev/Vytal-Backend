import type { Request, Response } from "express";
import {
  InsiderTradesQuerySchema,
  InsiderTradeLogsQuerySchema,
  InsiderBackfillSchema,
} from "../../schema/schema.js";
import { prisma } from "../../db/prisma.js";
import {
  runDailyJob,
} from "../../ingestions/insider-trades/pit-jobs.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

export const getInsiderTradesForSymbol = async (
  req: Request,
  res: Response,
) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();

    const query = InsiderTradesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid query params",
        details: query.error.flatten(),
      });
    }

    const { category, type, days, page, limit } = query.data;
    const skip = (page - 1) * limit;

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

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

    const where: NonNullable<
      Parameters<typeof prisma.insiderTrade.findMany>[0]
    >["where"] = {
      stockId: stock.id,
      // Rows with null intimationDate (bad-source, nulled on backfill) fall back
      // to tradeDate for the window filter so they still appear in results.
      OR: [
        { intimationDate: { gte: since } },
        { intimationDate: null, tradeDate: { gte: since } },
      ],
      ...(category !== "all" ? { personCategory: category } : {}),
      ...(type !== "all" ? { transactionType: type } : {}),
    };

    const [trades, total] = await prisma.$transaction([
      prisma.insiderTrade.findMany({
        where,
        orderBy: { intimationDate: { sort: "desc", nulls: "last" } },
        take: limit,
        skip,
        select: {
          id: true,
          regulation: true,
          intimationDate: true,
          personName: true,
          personCategory: true,
          transactionType: true,
          securityType: true,
          tradeDate: true,
          securitiesPre: true,
          securitiesTraded: true,
          securitiesPost: true,
          holdingPctPre: true,
          holdingPctPost: true,
          holdingPctDelta: true,
          tradePrice: true,
          tradeValueCr: true,
          acquisitionMode: true,
          remarks: true,
        },
      }),
      prisma.insiderTrade.count({ where }),
    ]);

    const buyCount = trades.filter((t) => t.transactionType === "buy").length;
    const sellCount = trades.filter((t) => t.transactionType === "sell").length;
    const pledgeCount = trades.filter(
      (t) => t.transactionType === "pledge",
    ).length;

    return res.json({
      success: true,
      data: {
        stock: { symbol: stock.symbol, name: stock.name },
        summary: { total, buyCount, sellCount, pledgeCount },
        trades: trades.map((t) => ({
          ...t,
          securitiesPre: t.securitiesPre?.toString() ?? null,
          securitiesTraded: t.securitiesTraded?.toString() ?? null,
          securitiesPost: t.securitiesPost?.toString() ?? null,
          holdingPctPre: t.holdingPctPre
            ? parseFloat(t.holdingPctPre.toString())
            : null,
          holdingPctPost: t.holdingPctPost
            ? parseFloat(t.holdingPctPost.toString())
            : null,
          holdingPctDelta: t.holdingPctDelta
            ? parseFloat(t.holdingPctDelta.toString())
            : null,
          tradePrice: t.tradePrice
            ? parseFloat(t.tradePrice.toString())
            : null,
          tradeValueCr: t.tradeValueCr
            ? parseFloat(t.tradeValueCr.toString())
            : null,
          intimationDate: t.intimationDate?.toISOString().split("T")[0] ?? null,
          tradeDate: t.tradeDate?.toISOString().split("T")[0] ?? null,
        })),
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error("[insider-trades/symbol] error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch insider trades" });
  }
};

export const getInsiderTradeLogs = async (req: Request, res: Response) => {
  const query = InsiderTradeLogsQuerySchema.safeParse(req.query);
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

  try {
    const [logs, total] = await prisma.$transaction([
      prisma.insiderTradeFetchLog.findMany({
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
          totalFiltered: true,
          durationMs: true,
          error: true,
          createdAt: true,
        },
      }),
      prisma.insiderTradeFetchLog.count({ where }),
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
  } catch (err) {
    console.error("[insider-trades/logs] error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch insider trade logs" });
  }
};

export const triggerDailyIngest = async (_req: Request, res: Response) => {
  try {
    console.log("[Admin] Manual insider trades daily ingest triggered");
    await runDailyJob();
    return res.json({ success: true, message: "Daily insider trades job completed." });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

export const triggerBackfillIngest = async (req: Request, res: Response) => {
  const body = InsiderBackfillSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ success: false, error: "Invalid body" });
  }

  const toDate = new Date();
  toDate.setHours(0, 0, 0, 0);

  const fromDate = new Date(toDate);
  fromDate.setMonth(fromDate.getMonth() - body.data.months);

  const job = await enqueueJob({
    type: JobTypes.INSIDER_TRADES_BACKFILL,
    payload: {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
    },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Insider trades backfill for last ${body.data.months} month(s) enqueued. Poll the status URL for progress.`,
    },
  });
};
