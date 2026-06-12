import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import {
  DailyPricesQuerySchema,
  PriceBackfillSchema,
  PriceLogsQuerySchema,
} from "../../schema/schema.js";
import {
  runEodPriceIngest,
} from "../../ingestions/prices/ingest-prices.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

// ── GET /api/v1/prices/price-logs ─────────────────────────────
// Returns paginated PriceFetchLog rows for monitoring.

export const getPriceFetchLogs = async (req: Request, res: Response) => {
  const query = PriceLogsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query params",
      details: query.error.flatten(),
    });
  }

  const { status, provider, page, limit } = query.data;
  const skip = (page - 1) * limit;

  const where = {
    ...(status !== "all" ? { status } : {}),
    ...(provider ? { provider } : {}),
  };

  const [logs, total] = await prisma.$transaction([
    prisma.priceFetchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        priceDate: true,
        provider: true,
        status: true,
        totalFetched: true,
        totalInserted: true,
        totalSkipped: true,
        durationMs: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.priceFetchLog.count({ where }),
  ]);

  return res.json({
    success: true,
    data: {
      logs: logs.map((l) => ({
        ...l,
        priceDate: l.priceDate.toISOString().split("T")[0],
        createdAt: l.createdAt.toISOString(),
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    },
  });
};

// ── GET /api/v1/prices/:symbol ────────────────────────────────
// Returns daily OHLCV history for a stock, newest first.

export const getDailyPricesForSymbol = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();

    const query = DailyPricesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid query params",
        details: query.error.flatten(),
      });
    }

    const { days, page, limit } = query.data;
    const skip = (page - 1) * limit;

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, name: true },
    });
    if (!stock) {
      return res.status(404).json({
        success: false,
        error: `Stock ${symbol} not found in universe`,
      });
    }

    const where = { stockId: stock.id, date: { gte: since } };

    const [prices, total, snapshot] = await prisma.$transaction([
      prisma.dailyPrice.findMany({
        where,
        orderBy: { date: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          date: true,
          open: true,
          high: true,
          low: true,
          close: true,
          prevClose: true,
          volume: true,
          tradedValue: true,
          provider: true,
        },
      }),
      prisma.dailyPrice.count({ where }),
      prisma.stockPrice.findUnique({
        where: { stockId: stock.id },
        select: {
          price: true,
          open: true,
          high: true,
          low: true,
          prevClose: true,
          dayChangePct: true,
          volume: true,
          week52High: true,
          week52Low: true,
          return1m: true,
          return3m: true,
          return6m: true,
          return1y: true,
          sparkline: true,
          priceDate: true,
          provider: true,
        },
      }),
    ]);

    const dec = (v: { toString(): string } | null | undefined) =>
      v != null ? parseFloat(v.toString()) : null;

    return res.json({
      success: true,
      data: {
        stock: { symbol: stock.symbol, name: stock.name },
        snapshot: snapshot
          ? {
              price: dec(snapshot.price),
              open: dec(snapshot.open),
              high: dec(snapshot.high),
              low: dec(snapshot.low),
              prevClose: dec(snapshot.prevClose),
              dayChangePct: dec(snapshot.dayChangePct),
              volume: snapshot.volume?.toString() ?? null,
              week52High: dec(snapshot.week52High),
              week52Low: dec(snapshot.week52Low),
              return1m: dec(snapshot.return1m),
              return3m: dec(snapshot.return3m),
              return6m: dec(snapshot.return6m),
              return1y: dec(snapshot.return1y),
              sparkline: snapshot.sparkline ?? [],
              priceDate:
                snapshot.priceDate?.toISOString().split("T")[0] ?? null,
              provider: snapshot.provider,
            }
          : null,
        prices: prices.map((p) => ({
          id: p.id,
          date: p.date.toISOString().split("T")[0],
          open: dec(p.open),
          high: dec(p.high),
          low: dec(p.low),
          close: dec(p.close),
          prevClose: dec(p.prevClose),
          volume: p.volume.toString(),
          tradedValue: dec(p.tradedValue),
          provider: p.provider,
        })),
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error("[prices/symbol] error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch prices" });
  }
};

// ── POST /api/v1/admin/prices/trigger ─────────────────────────
// Manually trigger EOD price ingest for today (or a specific date).
// Body: { date?: "YYYY-MM-DD" }

export const triggerEodIngest = async (req: Request, res: Response) => {
  try {
    let targetDate: Date | undefined;

    if (req.body?.date) {
      const parsed = new Date(req.body.date);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD.",
        });
      }
      targetDate = parsed;
    }

    console.log("[Admin] Manual EOD price ingest triggered");
    const result = await runEodPriceIngest(targetDate);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

// ── POST /api/v1/admin/prices/backfill ────────────────────────
// Backfill historical EOD prices.
// Body: { days: 365 }

export const triggerPriceBackfill = async (req: Request, res: Response) => {
  const body = PriceBackfillSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: body.error.flatten(),
    });
  }

  const job = await enqueueJob({
    type: JobTypes.PRICE_BACKFILL,
    payload: { days: body.data.days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Price backfill for last ${body.data.days} days enqueued. Poll the status URL for progress.`,
    },
  });
};
