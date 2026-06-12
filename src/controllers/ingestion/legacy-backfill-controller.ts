// ─────────────────────────────────────────────────────────────
// LEGACY BACKFILL — ADMIN CONTROLLER
//
// Handlers for manually triggering the v2 historical backfill pipeline.
//
// Endpoints:
//   POST /api/v1/admin/legacy-backfill/universe
//   POST /api/v1/admin/legacy-backfill/symbol
//
// Both enqueue a "legacy_backfill" job. Poll /api/v1/admin/jobs/:id for status.
//
// Job list / cancel / status are NOT duplicated here — they already
// exist at /api/v1/admin/jobs (src/routes/job-routes.ts).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

// ── Shared constants ─────────────────────────────────────────

const INDUSTRIES = [
  "non_financial",
  "banking",
  "nbfc",
  "life_insurance",
  "general_insurance",
] as const;

// ── POST /api/v1/admin/legacy-backfill/universe ───────────────
//
// Body: { fromDate?, toDate?, industries?, limit? }
// Returns: 202 { jobId, statusUrl }

const UniverseBodySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  industries: z.array(z.enum(INDUSTRIES)).optional(),
  limit: z.number().int().positive().optional(),
});

export const enqueueLegacyUniverseBackfill = async (
  req: Request,
  res: Response,
) => {
  const parsed = UniverseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { fromDate, toDate, industries, limit } = parsed.data;

  const job = await enqueueJob({
    type: JobTypes.LEGACY_BACKFILL,
    payload: { mode: "universe", fromDate, toDate, industries, limit },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message:
        "legacy_backfill (universe) enqueued. Poll statusUrl for progress.",
      mode: "universe",
      fromDate: fromDate ?? "unbounded",
      toDate: toDate ?? "unbounded",
      industries: industries ?? "all",
      limit: limit ?? "none",
    },
  });
};

// ── POST /api/v1/admin/legacy-backfill/symbol ─────────────────
//
// Body: { symbol: string, fromDate?, toDate? }
// Returns: 202 { jobId, statusUrl }

const SymbolBodySchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const enqueueLegacySymbolBackfill = async (
  req: Request,
  res: Response,
) => {
  const parsed = SymbolBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { symbol, fromDate, toDate } = parsed.data;

  const job = await enqueueJob({
    type: JobTypes.LEGACY_BACKFILL,
    payload: { mode: "symbol", symbol, fromDate, toDate },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `legacy_backfill (symbol=${symbol}) enqueued. Poll statusUrl for progress.`,
      mode: "symbol",
      symbol,
      fromDate: fromDate ?? "unbounded",
      toDate: toDate ?? "unbounded",
    },
  });
};
