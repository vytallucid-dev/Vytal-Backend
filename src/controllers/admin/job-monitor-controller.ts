// ─────────────────────────────────────────────────────────────
// JOB MONITOR — READ-ONLY endpoints for the (not-yet-built) admin panel.
//
//   GET /api/v1/admin/jobs/running   — what is executing right now, ALIVE or STALE
//   GET /api/v1/admin/jobs/history   — per-type outcomes, durations, abandon + reclaim rate
//   GET /api/v1/admin/jobs/health    — the latest nightly health report
//
// All three sit behind requireAdmin, mounted with the rest of /api/v1/admin/jobs.
//
// ── WHAT THIS SURFACE EXISTS TO NOT DO ─────────────────────────────────────────────
// The pipelines card was the monitoring surface on 11–13 August, and it read "succeeded,
// minutes ago" for all three dead nights. Two reasons, both structural:
//   · latestJobRun filters `finishedAt IS NOT NULL`, so a job stuck in `running` is
//     invisible BY CONSTRUCTION — the exact state that needed showing was the one state
//     the query could not return;
//   · the `mf` card covers four job types, and reported the newest finished run among
//     them — so instrument_corporate_actions being dead was masked by mf_analytics being
//     healthy.
// Every endpoint below is built against those two failures: running jobs are first-class,
// and nothing is ever aggregated across job types without also being broken out per type.
//
// ── SHAPED FOR A PANEL THAT DOES NOT EXIST YET ─────────────────────────────────────
// Every row carries its own `severity` and a human `detail`, so a table renders without
// the client re-deriving judgement; every list is `{ data, meta }` so pagination or a
// generatedAt can be added without moving anything; and every job row carries
// `cancellation` so a Cancel button can be disabled rather than lying (see 3d).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import {
  JobStatus,
  JobTypes,
  cancellationSupportFor,
  restartPolicyFor,
  type CancellationSupport,
} from "../../jobs/types.js";
import {
  STALE_AFTER_MS,
  JOB_HEARTBEAT_INTERVAL_MS,
  MAX_RECLAIMS,
  RECLAIM_PREFIX,
  INTERRUPT_PREFIX,
} from "../../jobs/reaper.js";
import type { HealthReport } from "../../jobs/health/check.js";

// ── GET /api/v1/admin/jobs/running ───────────────────────────

export type Liveness = "alive" | "stale" | "unknown";

export interface RunningJobRow {
  id: string;
  type: string;
  startedAt: string | null;
  runningForMs: number | null;
  progress: number;
  progressNote: string | null;
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  /** ALIVE vs STALE — the question the old surface could not answer. */
  liveness: Liveness;
  attempts: number;
  maxAttempts: number;
  reclaimCount: number;
  restartPolicy: "requeue" | "fail";
  cancellation: CancellationSupport;
  cancelRequested: boolean;
  triggeredBy: string;
  severity: "ok" | "warn" | "critical";
  detail: string;
}

export const listRunningJobs = async (_req: Request, res: Response) => {
  const now = Date.now();
  const rows = await prisma.backgroundJob.findMany({
    where: { status: { in: [JobStatus.RUNNING, JobStatus.PENDING] } },
    orderBy: [{ status: "asc" }, { startedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, type: true, status: true, startedAt: true, createdAt: true,
      progress: true, progressNote: true, lastHeartbeatAt: true,
      attempts: true, maxAttempts: true, reclaimCount: true,
      cancelRequested: true, triggeredBy: true, errorMessage: true, priority: true,
    },
  });

  const running: RunningJobRow[] = [];
  const pending: {
    id: string; type: string; createdAt: string; priority: number; triggeredBy: string;
    waitingMs: number; requeuedByReaper: boolean; reclaimCount: number;
  }[] = [];

  for (const r of rows) {
    if (r.status === JobStatus.PENDING) {
      pending.push({
        id: r.id, type: r.type,
        createdAt: r.createdAt.toISOString(),
        priority: r.priority,
        triggeredBy: r.triggeredBy,
        waitingMs: now - r.createdAt.getTime(),
        // A pending row that a reaper or a shutdown put back is NOT the same thing as fresh
        // work, and a panel that renders them identically hides a reclaim loop.
        requeuedByReaper:
          (r.errorMessage ?? "").startsWith(RECLAIM_PREFIX) ||
          (r.errorMessage ?? "").startsWith(INTERRUPT_PREFIX),
        reclaimCount: r.reclaimCount,
      });
      continue;
    }

    const hbAge = r.lastHeartbeatAt ? now - r.lastHeartbeatAt.getTime() : null;
    // ⚠ NULL heartbeat is "unknown", never "stale". A pre-migration row cannot be told
    //   apart from a live one, and calling it dead is how a monitor invents an incident.
    const liveness: Liveness = hbAge === null ? "unknown" : hbAge > STALE_AFTER_MS ? "stale" : "alive";
    const cancellation = cancellationSupportFor(r.type);
    running.push({
      id: r.id, type: r.type,
      startedAt: r.startedAt?.toISOString() ?? null,
      runningForMs: r.startedAt ? now - r.startedAt.getTime() : null,
      progress: r.progress, progressNote: r.progressNote,
      lastHeartbeatAt: r.lastHeartbeatAt?.toISOString() ?? null,
      heartbeatAgeMs: hbAge,
      liveness,
      attempts: r.attempts, maxAttempts: r.maxAttempts,
      reclaimCount: r.reclaimCount,
      restartPolicy: restartPolicyFor(r.type),
      cancellation,
      cancelRequested: r.cancelRequested,
      triggeredBy: r.triggeredBy,
      severity: liveness === "stale" ? "critical" : liveness === "unknown" ? "warn" : "ok",
      detail:
        liveness === "stale"
          ? `No heartbeat for ${Math.round((hbAge ?? 0) / 60_000)}m (threshold ${STALE_AFTER_MS / 60_000}m). ` +
            `The reaper reclaims this within ~12m; if it is still here, the reaper is not running.`
          : liveness === "unknown"
            ? `Claimed before the liveness column existed — liveness cannot be determined. Boot recovery ` +
              `handles it on the old 30-minute rule.`
            : `Alive — last heartbeat ${Math.round((hbAge ?? 0) / 1000)}s ago (beat every ` +
              `${JOB_HEARTBEAT_INTERVAL_MS / 1000}s).` +
              (r.cancelRequested
                ? ` ⚠ A cancel has been requested and this type is "${cancellation}".`
                : ""),
    });
  }

  return res.json({
    success: true,
    data: { running, pending },
    meta: {
      generatedAt: new Date().toISOString(),
      heartbeatIntervalMs: JOB_HEARTBEAT_INTERVAL_MS,
      staleAfterMs: STALE_AFTER_MS,
      maxReclaims: MAX_RECLAIMS,
      counts: {
        running: running.length,
        pending: pending.length,
        stale: running.filter((r) => r.liveness === "stale").length,
        unknownLiveness: running.filter((r) => r.liveness === "unknown").length,
      },
    },
  });
};

// ── GET /api/v1/admin/jobs/history?days=7 ────────────────────

const HistoryQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });

export interface TypeHistoryRow {
  type: string;
  total: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  cancelled: number;
  running: number;
  pending: number;
  reclaimed: number;
  abandonRatePct: number;
  reclaimRatePct: number;
  successRatePct: number;
  durationMs: { p50: number | null; p95: number | null; max: number | null };
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSuccessAt: string | null;
  cancellation: CancellationSupport;
  restartPolicy: "requeue" | "fail";
}

export const getJobHistory = async (req: Request, res: Response) => {
  const parsed = HistoryQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid query", details: parsed.error.flatten().fieldErrors });
  }
  const { days } = parsed.data;
  const from = new Date(Date.now() - days * 86_400_000);

  // One grouped pass. Percentiles need SQL, so the whole row is built there rather than
  // pulling every job into memory to sort.
  const rows = await prisma.$queryRaw<
    {
      type: string; total: bigint; succeeded: bigint; failed: bigint; abandoned: bigint;
      cancelled: bigint; running: bigint; pending: bigint; reclaimed: bigint;
      p50: number | null; p95: number | null; max_ms: number | null;
      last_run: Date | null; last_success: Date | null;
    }[]
  >`
    SELECT type,
           COUNT(*)                                                   AS total,
           COUNT(*) FILTER (WHERE status = 'succeeded')               AS succeeded,
           COUNT(*) FILTER (WHERE status = 'failed')                  AS failed,
           COUNT(*) FILTER (WHERE status = 'abandoned')               AS abandoned,
           COUNT(*) FILTER (WHERE status = 'cancelled')               AS cancelled,
           COUNT(*) FILTER (WHERE status = 'running')                 AS running,
           COUNT(*) FILTER (WHERE status = 'pending')                 AS pending,
           COUNT(*) FILTER (WHERE reclaim_count > 0)                  AS reclaimed,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)  AS p50,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)  AS p95,
           MAX(duration_ms)                                           AS max_ms,
           MAX(created_at)                                            AS last_run,
           MAX(finished_at) FILTER (WHERE status = 'succeeded')       AS last_success
    FROM background_jobs
    WHERE created_at >= ${from}
    GROUP BY type
    ORDER BY type
  `;

  // lastRunStatus needs the row, not an aggregate — one small query rather than a join
  // that would make the aggregate above harder to read.
  const lastRuns = await prisma.backgroundJob.findMany({
    where: { createdAt: { gte: from } },
    orderBy: { createdAt: "desc" },
    distinct: ["type"],
    select: { type: true, status: true, createdAt: true },
  });
  const lastByType = new Map(lastRuns.map((r) => [r.type, r]));

  const n = (v: bigint | number | null) => (v === null ? 0 : Number(v));
  const data: TypeHistoryRow[] = rows.map((r) => {
    const total = n(r.total);
    const abandoned = n(r.abandoned);
    const reclaimed = n(r.reclaimed);
    const succeeded = n(r.succeeded);
    const last = lastByType.get(r.type);
    return {
      type: r.type,
      total, succeeded,
      failed: n(r.failed), abandoned, cancelled: n(r.cancelled),
      running: n(r.running), pending: n(r.pending), reclaimed,
      abandonRatePct: total ? Math.round((abandoned / total) * 1000) / 10 : 0,
      reclaimRatePct: total ? Math.round((reclaimed / total) * 1000) / 10 : 0,
      successRatePct: total ? Math.round((succeeded / total) * 1000) / 10 : 0,
      durationMs: {
        p50: r.p50 === null ? null : Math.round(r.p50),
        p95: r.p95 === null ? null : Math.round(r.p95),
        max: r.max_ms === null ? null : Math.round(r.max_ms),
      },
      lastRunAt: last?.createdAt.toISOString() ?? (r.last_run ? new Date(r.last_run).toISOString() : null),
      lastRunStatus: last?.status ?? null,
      lastSuccessAt: r.last_success ? new Date(r.last_success).toISOString() : null,
      cancellation: cancellationSupportFor(r.type),
      restartPolicy: restartPolicyFor(r.type),
    };
  });

  return res.json({
    success: true,
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      windowFrom: from.toISOString(),
      // Stated so a panel can show "no history before this" rather than implying a
      // 30-day-old type simply never ran.
      retentionNote: "background_jobs is pruned at 30 days (terminal rows only); history cannot exceed that.",
    },
  });
};

// ── GET /api/v1/admin/jobs/health ────────────────────────────

export const getLatestHealthCheck = async (_req: Request, res: Response) => {
  const row = await prisma.backgroundJob.findFirst({
    where: { type: JobTypes.JOB_HEALTH_CHECK, status: JobStatus.SUCCEEDED, result: { not: undefined } },
    orderBy: { finishedAt: "desc" },
    select: { id: true, finishedAt: true, durationMs: true, result: true },
  });

  if (!row?.result) {
    // ⚠ AN HONEST EMPTY, NOT A 404. "The health check has not produced a report yet" and
    //   "this endpoint does not exist" are different facts, and a panel must be able to
    //   render the first one as a state rather than an error.
    return res.json({
      success: true,
      data: null,
      meta: {
        generatedAt: new Date().toISOString(),
        reason:
          "No successful job_health_check run on record. It runs nightly at 22:00 UTC; if this " +
          "persists past one night, the health check itself is not running.",
      },
    });
  }

  return res.json({
    success: true,
    data: row.result as unknown as HealthReport,
    meta: { jobId: row.id, finishedAt: row.finishedAt?.toISOString() ?? null, durationMs: row.durationMs },
  });
};
