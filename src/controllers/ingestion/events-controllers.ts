import type { Request, Response } from "express";
import { CalendarQuerySchema, FetchLogsQuerySchema } from "../../schema/schema.js";
import { prisma } from "../../db/prisma.js";
import {
  runDailyEventRefresh,
  runWeeklyEventIngest,
} from "../../ingestions/corporate-events/ingest-events.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

export const getAllCalendarEvents = async (req: Request, res: Response) => {
  try {
    const q = CalendarQuerySchema.safeParse(req.query);
    if (!q.success) {
      return res.status(400).json({ success: false, error: "Invalid query" });
    }

    const { days, types, sector } = q.data;
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + days);

    const typeFilter = types
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const events = await prisma.corporateEvent.findMany({
      where: {
        eventDate: { gte: from, lte: to },
        ...(typeFilter?.length ? { eventType: { in: typeFilter } } : {}),
        stock: {
          isActive: true,
          ...(sector
            ? { sector: { name: { contains: sector, mode: "insensitive" } } }
            : {}),
        },
      },
      orderBy: [{ eventDate: "asc" }, { impactLevel: "asc" }],
      include: {
        stock: {
          select: {
            symbol: true,
            name: true,
            sector: { select: { displayName: true } },
          },
        },
      },
    });

    // Group by date for calendar view
    const grouped: Record<string, typeof events> = {};
    for (const event of events) {
      const dateKey = event.eventDate.toISOString().split("T")[0];
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(event);
    }

    return res.json({
      success: true,
      data: {
        total: events.length,
        calendar: grouped,
        // Flat list for simpler consumption
        events: events.map((e) => ({
          id: e.id,
          symbol: e.symbol,
          companyName: e.stock.name,
          sector: e.stock.sector?.displayName ?? null,
          eventType: e.eventType,
          eventDate: e.eventDate.toISOString().split("T")[0],
          exDate: e.exDate?.toISOString().split("T")[0] ?? null,
          recordDate: e.recordDate?.toISOString().split("T")[0] ?? null,
          impactLevel: e.impactLevel,
          dividendAmount: e.dividendAmount
            ? parseFloat(e.dividendAmount.toString())
            : null,
          dividendType: e.dividendType,
          bonusRatio: e.bonusRatio,
          splitRatio: e.splitRatio,
          description: e.description,
        })),
      },
    });
  } catch (err) {
    console.error("[events/calendar]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch calendar" });
  }
};

export const getEventsBySymbol = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const { upcoming = "true", days = "365" } = req.query as Record<
      string,
      string
    >;
    const isUpcoming = upcoming === "true";
    const windowDays = Math.min(parseInt(days) || 365, 730);

    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, name: true },
    });
    if (!stock) {
      return res
        .status(404)
        .json({ success: false, error: `${symbol} not in universe` });
    }

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    const dateFilter = isUpcoming
      ? { gte: now, lte: new Date(now.getTime() + windowDays * 86400_000) }
      : { lte: now, gte: new Date(now.getTime() - windowDays * 86400_000) };

    const events = await prisma.corporateEvent.findMany({
      where: { stockId: stock.id, eventDate: dateFilter },
      orderBy: { eventDate: isUpcoming ? "asc" : "desc" },
    });

    return res.json({
      success: true,
      data: {
        symbol: stock.symbol,
        name: stock.name,
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          eventDate: e.eventDate.toISOString().split("T")[0],
          exDate: e.exDate?.toISOString().split("T")[0] ?? null,
          recordDate: e.recordDate?.toISOString().split("T")[0] ?? null,
          impactLevel: e.impactLevel,
          isConfirmed: e.isConfirmed,
          dividendAmount: e.dividendAmount
            ? parseFloat(e.dividendAmount.toString())
            : null,
          dividendType: e.dividendType,
          bonusRatio: e.bonusRatio,
          splitRatio: e.splitRatio,
          description: e.description,
        })),
      },
    });
  } catch (err) {
    console.error("[events/symbol]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch events" });
  }
};

export const getEventLogs = async (req: Request, res: Response) => {
  const q = FetchLogsQuerySchema.safeParse(req.query);
  if (!q.success) {
    return res.status(400).json({ success: false, error: "Invalid query" });
  }

  const { status, fetchType, page, limit } = q.data;
  const skip = (page - 1) * limit;

  const where = {
    ...(status !== "all" ? { status } : {}),
    ...(fetchType !== "all" ? { fetchType } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.eventFetchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.eventFetchLog.count({ where }),
  ]);

  return res.json({
    success: true,
    data: {
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    },
  });
};

export const triggerWeeklyEventIngest = async (
  _req: Request,
  res: Response,
) => {
  try {
    const result = await runWeeklyEventIngest();
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

export const triggerDailyEventRefresh = async (
  _req: Request,
  res: Response,
) => {
  try {
    const result = await runDailyEventRefresh();
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

export const backfillEvents = async (req: Request, res: Response) => {
  const days = parseInt(req.body?.days ?? "365");

  const job = await enqueueJob({
    type: JobTypes.EVENTS_BACKFILL,
    payload: { days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Event backfill for last ${days} days enqueued. Poll the status URL for progress.`,
    },
  });
};
