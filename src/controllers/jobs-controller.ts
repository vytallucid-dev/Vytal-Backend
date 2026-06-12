// ─────────────────────────────────────────────────────────────
// JOBS ADMIN CONTROLLER
//
// Endpoints for the frontend to poll job status and for an admin
// dashboard to inspect what's running / queued / recent.
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { getJobById, listJobs, requestCancel } from "../jobs/enqueue.js";
import {
  JobStatus,
  JobTypes,
  type JobStatusValue,
  type JobType,
} from "../jobs/types.js";

// ── GET /api/jobs/:id — single-job status ────────────────────

export const getJob = async (req: Request, res: Response) => {
  const job = await getJobById(req.params.id as string);
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }

  // Strip the payload from the default response — payloads can be huge
  // (think 50MB base64 ZIPs). Frontend doesn't need it for polling.
  const { payload: _payload, ...lean } = job;

  return res.json({ success: true, data: lean });
};

// ── GET /api/jobs/:id?include=payload — full job (admin only) ──

export const getJobFull = async (req: Request, res: Response) => {
  const job = await getJobById(req.params.id as string);
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }
  return res.json({ success: true, data: job });
};

// ── GET /api/jobs — list with filters ────────────────────────

const ListJobsQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(), // single status or comma-separated list
  triggeredBy: z.string().optional(),
  since: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const listJobsHandler = async (req: Request, res: Response) => {
  const parsed = ListJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query parameters",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { type, status, triggeredBy, since, page, limit } = parsed.data;

  // Validate type and status against known values to avoid SQL surprises
  const validTypes = Object.values(JobTypes) as string[];
  const validStatuses = Object.values(JobStatus) as string[];

  if (type && !validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `Unknown job type. Valid: ${validTypes.join(", ")}`,
    });
  }

  let statusFilter: JobStatusValue | JobStatusValue[] | undefined;
  if (status) {
    const parts = status.split(",").map((s) => s.trim());
    for (const p of parts) {
      if (!validStatuses.includes(p)) {
        return res.status(400).json({
          success: false,
          error: `Unknown job status: ${p}. Valid: ${validStatuses.join(", ")}`,
        });
      }
    }
    statusFilter = parts as JobStatusValue[];
  }

  const skip = (page - 1) * limit;

  const { jobs, total } = await listJobs({
    type: type as JobType | undefined,
    status: statusFilter,
    triggeredBy,
    since,
    limit,
    skip,
  });

  // Strip payloads from list view — they bloat the response and the
  // dashboard never displays them inline.
  const lean = jobs.map(({ payload: _payload, ...rest }) => rest);

  return res.json({
    success: true,
    data: lean,
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

// ── GET /api/jobs/active — convenience: pending + running ─────

export const listActiveJobs = async (_req: Request, res: Response) => {
  const { jobs } = await listJobs({
    status: [JobStatus.PENDING, JobStatus.RUNNING],
    limit: 100,
  });
  const lean = jobs.map(({ payload: _payload, ...rest }) => rest);
  return res.json({ success: true, data: lean });
};

// ── POST /api/jobs/:id/cancel ────────────────────────────────

export const cancelJob = async (req: Request, res: Response) => {
  try {
    const job = await requestCancel(req.params.id as string);
    return res.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        cancelRequested: job.cancelRequested,
        message:
          job.status === JobStatus.CANCELLED
            ? "Job cancelled."
            : job.status === JobStatus.RUNNING
              ? "Cancellation requested. Will stop at next safe point."
              : "Job is already in a terminal state — nothing to cancel.",
      },
    });
  } catch (e) {
    if ((e as Error).message?.includes("not found")) {
      return res
        .status(404)
        .json({ success: false, error: (e as Error).message });
    }
    return res
      .status(500)
      .json({ success: false, error: (e as Error).message });
  }
};
