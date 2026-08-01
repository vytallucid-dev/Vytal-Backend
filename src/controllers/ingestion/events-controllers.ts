import type { Request, Response } from "express";
import { CalendarQuerySchema, FetchLogsQuerySchema } from "../../schema/schema.js";
import { prisma } from "../../db/prisma.js";
import {
  runDailyEventRefresh,
  runWeeklyEventIngest,
} from "../../ingestions/corporate-events/ingest-events.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { buildCorporateEventsView } from "../../scoring/read/corporate-events.service.js";

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

    // ── ⚠ `select:`, NOT `include:` — AND THE PROJECTION IS THE WHOLE RESPONSE ────────────────────
    // This endpoint used to send the same 155 events TWICE: `data.calendar` (the raw rows, every
    // column, with a joined stock object, grouped by date) and `data.events` (the 14-field projection
    // below). Nothing has ever read `data.calendar` — the only consumer in either repo is
    // Vytal-Frontend/lib/api/hooks/use-events-calendar.ts, which reads `r.data.events` and whose
    // response type does not even declare a `calendar` key. The duplicate was pure transfer cost,
    // and on an Indian 4G link transfer is the budget that matters, not server time.
    //
    // `include:` also meant every scalar came back whether or not the projection used it —
    // stockId, isConfirmed, purpose, source, createdAt, updatedAt are six columns per row that
    // reached the wire and were then thrown away by the map. `select:` lists exactly the fields the
    // projection reads, so adding a field to the response is a deliberate act rather than a default.
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
      select: {
        id: true,
        // ★ stockId IS BACK, AND ONLY stockId. It was dropped with the five other unread scalars in
        // the byte fix; it comes back because it turned out to be READ — every reminder row on the
        // calendar needs it, and the only other way to get it was for the client to download the
        // 504-row universe list (22.0 KB gzip) and .find() through it. Measured: carrying it costs
        // +3.5 KB gzip across 155 events (a scalar column, no join — CorporateEvent denormalises it),
        // so the calendar nets ~18.5 KB gzip smaller AND loses a whole request. A per-symbol resolver
        // endpoint would have been N calls for N rows; a batch resolver would have been a new endpoint
        // shape with a cap to argue about. This is neither.
        //
        // A symbol→id map sent once was also measured and is WORSE (+4.0 KB gzip): the repeated UUIDs
        // in-row compress better than a map's extra symbol keys do.
        stockId: true,
        symbol: true,
        eventType: true,
        eventDate: true,
        exDate: true,
        recordDate: true,
        impactLevel: true,
        dividendAmount: true,
        dividendType: true,
        bonusRatio: true,
        splitRatio: true,
        description: true,
        stock: {
          select: {
            name: true,
            sector: { select: { displayName: true } },
          },
        },
      },
    });

    return res.json({
      success: true,
      data: {
        total: events.length,
        events: events.map((e) => ({
          id: e.id,
          stockId: e.stockId,
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

// The read itself lives in buildCorporateEventsView (scoring/read/corporate-events.service.ts) — moved
// there verbatim so the chat tool and this endpoint share ONE query. This handler now only parses the
// query string and shapes the envelope.
export const getEventsBySymbol = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const { upcoming = "true", days = "365" } = req.query as Record<
      string,
      string
    >;

    const view = await buildCorporateEventsView(symbol, {
      upcoming: upcoming === "true",
      days: parseInt(days) || 365,
    });
    if (!view) {
      return res
        .status(404)
        .json({ success: false, error: `${symbol} not in universe` });
    }

    return res.json({ success: true, data: view });
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
