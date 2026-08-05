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

const DAY_MS = 86_400_000;

/** Page size when a caller sends `cursor` but no `limit`. */
const DEFAULT_PAGE_SIZE = 40;

/** Ceiling for an UNPAGED read (neither `limit` nor `cursor`). The default forward window is
 *  ~155 rows and a single month of history a few hundred, so this only bites on an open-ended
 *  historical window asked for without paging — and then it truncates honestly: `hasMore` is
 *  true and `total` still describes the whole window, not the slice. */
const MAX_UNPAGED_ROWS = 1000;

/** A YYYY-MM-DD param → the UTC midnight Postgres stores for a `@db.Date` column. */
const parseYmd = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const utcToday = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// ── cursors ──────────────────────────────────────────────────────────────────────────
// The cursor is the sort key of the last row on the page — (eventDate, id) — base64url'd so
// no caller is tempted to construct one. A malformed cursor decodes to null and the request is
// served as an unpaged first page rather than as a 400: a stale link should show the calendar.
const encodeCursor = (date: string, id: string): string =>
  Buffer.from(`${date}|${id}`, "utf8").toString("base64url");

function decodeCursor(raw: string | undefined): { date: string; id: string } | null {
  if (!raw) return null;
  try {
    const [date, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!date || !id) return null;
    return { date, id };
  } catch {
    return null;
  }
}

export const getAllCalendarEvents = async (req: Request, res: Response) => {
  try {
    const q = CalendarQuerySchema.safeParse(req.query);
    if (!q.success) {
      return res.status(400).json({ success: false, error: "Invalid query" });
    }

    const { days, types, sector, limit, cursor } = q.data;

    // ── the window ──────────────────────────────────────────────────────────────────
    // An explicit `from`/`to` REPLACES the forward `days` window — that is how the month grid
    // reads history. Either end may be omitted (open-ended in that direction); with neither,
    // this is byte-for-byte the original [today, today+days] look-ahead.
    const explicitWindow = q.data.from != null || q.data.to != null;
    const from = q.data.from
      ? parseYmd(q.data.from)
      : explicitWindow
        ? null
        : utcToday();
    const to = q.data.to
      ? parseYmd(q.data.to)
      : explicitWindow
        ? null
        : new Date(utcToday().getTime() + days * DAY_MS);

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
    const windowWhere = {
      ...(from || to
        ? {
            eventDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(typeFilter?.length ? { eventType: { in: typeFilter } } : {}),
      stock: {
        isActive: true,
        ...(sector
          ? {
              sector: {
                name: { contains: sector, mode: "insensitive" as const },
              },
            }
          : {}),
      },
    };

    // ── paging ──────────────────────────────────────────────────────────────────────
    // Paged ⇔ the caller sent `limit` or `cursor`. The keyset predicate is "strictly after the
    // last row the reader SAW": a later date, or the same date and a later id. Which forces the
    // paged ORDER BY to be (eventDate, id) — the unpaged path keeps its original (eventDate,
    // impactLevel) tiebreak, and nothing is lost visually because every consumer re-sorts within
    // a day anyway (held-first, then impact).
    const paged = limit != null || cursor != null;
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const after = decodeCursor(cursor);
    const keyset = after
      ? {
          OR: [
            { eventDate: { gt: parseYmd(after.date) } },
            { eventDate: parseYmd(after.date), id: { gt: after.id } },
          ],
        }
      : null;

    // `total` describes the WHOLE window (cursor excluded) so a paged reader can say "40 of 312"
    // rather than "40 of 40". One indexed count, run alongside the page.
    const [rows, total] = await Promise.all([
      prisma.corporateEvent.findMany({
        where: keyset ? { AND: [windowWhere, keyset] } : windowWhere,
        // +1 sentinel row → hasMore without a second round trip.
        take: (paged ? pageSize : MAX_UNPAGED_ROWS) + 1,
        orderBy: paged
          ? [{ eventDate: "asc" as const }, { id: "asc" as const }]
          : [{ eventDate: "asc" as const }, { impactLevel: "asc" as const }],
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
      }),
      prisma.corporateEvent.count({ where: windowWhere }),
    ]);

    const size = paged ? pageSize : MAX_UNPAGED_ROWS;
    const hasMore = rows.length > size;
    const events = hasMore ? rows.slice(0, size) : rows;
    const last = events[events.length - 1];

    return res.json({
      success: true,
      data: {
        total,
        hasMore,
        // Only a paged read gets a cursor — an unpaged truncation at MAX_UNPAGED_ROWS reports
        // hasMore so the caller knows it was cut, but the fix there is to send `limit`.
        cursor:
          paged && hasMore && last
            ? encodeCursor(ymd(last.eventDate), last.id)
            : null,
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

/**
 * GET /api/v1/events/calendar/bounds — how far the calendar actually reaches.
 *
 * The month grid has to know where history STOPS before it can let a reader walk backwards:
 * hardcoding "no past months" was the old answer and it hid every event we hold, while an
 * unbounded picker would offer years of guaranteed-empty months. Two indexed aggregates over the
 * same active-universe filter the calendar itself uses, so the nav limits and the grid always
 * agree. Honest-null when the table is empty — the caller then falls back to the current month.
 */
export const getCalendarBounds = async (_req: Request, res: Response) => {
  try {
    const agg = await prisma.corporateEvent.aggregate({
      where: { stock: { isActive: true } },
      _min: { eventDate: true },
      _max: { eventDate: true },
      _count: { _all: true },
    });

    return res.json({
      success: true,
      data: {
        earliest: agg._min.eventDate ? ymd(agg._min.eventDate) : null,
        latest: agg._max.eventDate ? ymd(agg._max.eventDate) : null,
        total: agg._count._all,
      },
    });
  } catch (err) {
    console.error("[events/calendar/bounds]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch calendar bounds" });
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
