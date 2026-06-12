// ─────────────────────────────────────────────────────────────
// JOB ENQUEUE API
//
// What callers use to schedule a job. Returns the created job
// with its id so the caller can return that to the frontend.
//
// Usage:
//   const job = await enqueueJob({
//     type: JobTypes.SCREENER_BULK_INGEST,
//     payload: { zipBase64, zipFilename, sectorId },
//     triggeredBy: "user:aman",
//     priority: 100,
//   })
//   return res.status(202).json({ jobId: job.id, statusUrl: `/api/jobs/${job.id}` })
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  JobStatus,
  JobTypes,
  RETRY_POLICIES,
  type JobType,
  type JobStatusValue,
} from "./types.js";

export interface EnqueueOptions<TData = unknown> {
  type: JobType;
  payload: TData;
  triggeredBy: string;
  /** Lower = sooner. Default 100. Use 10 for urgent. */
  priority?: number;
  /** Override retry policy for this specific job. Otherwise uses default for the type. */
  maxAttempts?: number;
}

export async function enqueueJob<TData = unknown>(opts: EnqueueOptions<TData>) {
  const policy = RETRY_POLICIES[opts.type];
  const maxAttempts = opts.maxAttempts ?? policy.maxAttempts;

  const job = await prisma.backgroundJob.create({
    data: {
      type: opts.type,
      status: JobStatus.PENDING,
      priority: opts.priority ?? 100,
      payload: opts.payload as unknown as Prisma.InputJsonValue,
      triggeredBy: opts.triggeredBy,
      maxAttempts,
    },
  });

  return job;
}

// ─────────────────────────────────────────────────────────────
// QUERY HELPERS
// Used by admin routes for status polling and the dashboard.
// ─────────────────────────────────────────────────────────────

export async function getJobById(id: string) {
  return prisma.backgroundJob.findUnique({ where: { id } });
}

export interface ListJobsFilters {
  type?: JobType;
  status?: JobStatusValue | JobStatusValue[];
  triggeredBy?: string;
  /** Created after this date */
  since?: Date;
  limit?: number;
  skip?: number;
}

export async function listJobs(filters: ListJobsFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 500);
  const skip = filters.skip ?? 0;
  const statuses = Array.isArray(filters.status)
    ? filters.status
    : filters.status
      ? [filters.status]
      : undefined;

  const where = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(filters.triggeredBy ? { triggeredBy: filters.triggeredBy } : {}),
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
  };

  const [jobs, total] = await Promise.all([
    prisma.backgroundJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.backgroundJob.count({ where }),
  ]);

  return { jobs, total };
}

/**
 * Mark a running or pending job as cancellation-requested.
 * Pending jobs are cancelled outright. Running jobs are flagged —
 * the handler must check `shouldCancel()` periodically and stop.
 */
export async function requestCancel(id: string) {
  const job = await prisma.backgroundJob.findUnique({ where: { id } });
  if (!job) throw new Error(`Job ${id} not found`);

  if (job.status === JobStatus.PENDING) {
    return prisma.backgroundJob.update({
      where: { id },
      data: {
        status: JobStatus.CANCELLED,
        finishedAt: new Date(),
      },
    });
  }

  if (job.status === JobStatus.RUNNING) {
    return prisma.backgroundJob.update({
      where: { id },
      data: { cancelRequested: true },
    });
  }

  // Already in a terminal state — no-op
  return job;
}
