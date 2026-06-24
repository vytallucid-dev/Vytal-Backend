import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import {
  IndexBackfillSchema,
  IndexLogsQuerySchema,
} from "../../schema/schema.js";
import { runIndexIngest } from "../../ingestions/indices/ingest-indices.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

// ── GET /api/v1/indices/index-logs ────────────────────────────
// Returns paginated IndexFetchLog rows for monitoring (mirrors the
// price-logs endpoint so the admin UI renders both identically).

export const getIndexFetchLogs = async (req: Request, res: Response) => {
  const query = IndexLogsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query params",
      details: query.error.flatten(),
    });
  }

  const { status, source, page, limit } = query.data;
  const skip = (page - 1) * limit;

  const where = {
    ...(status !== "all" ? { status } : {}),
    ...(source ? { source } : {}),
  };

  const [logs, total] = await prisma.$transaction([
    prisma.indexFetchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        indexDate: true,
        source: true,
        status: true,
        totalFetched: true,
        totalInserted: true,
        totalSkipped: true,
        durationMs: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.indexFetchLog.count({ where }),
  ]);

  return res.json({
    success: true,
    data: {
      logs: logs.map((l) => ({
        ...l,
        indexDate: l.indexDate.toISOString().split("T")[0],
        createdAt: l.createdAt.toISOString(),
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    },
  });
};

// ── POST /api/v1/admin/indices/trigger ────────────────────────
// Manually trigger EOD index ingest for today (or a specific date).
// Synchronous (mirrors prices/trigger): awaits the ingest result.
// Body: { date?: "YYYY-MM-DD" }

export const triggerIndexIngest = async (req: Request, res: Response) => {
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

    console.log("[Admin] Manual EOD index ingest triggered");
    const result = await runIndexIngest(targetDate);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

// ── POST /api/v1/admin/indices/backfill ───────────────────────
// Backfill historical EOD index values. Async (mirrors prices/backfill):
// enqueues a job, returns 202 + jobId. Idempotent via (indexName, date).
// Body: { days: 365 }

export const triggerIndexBackfill = async (req: Request, res: Response) => {
  const body = IndexBackfillSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: body.error.flatten(),
    });
  }

  const job = await enqueueJob({
    type: JobTypes.INDEX_PRICES_BACKFILL,
    payload: { days: body.data.days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Index backfill for last ${body.data.days} days enqueued. Poll the status URL for progress.`,
    },
  });
};
