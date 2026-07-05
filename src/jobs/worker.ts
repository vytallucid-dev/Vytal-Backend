// ─────────────────────────────────────────────────────────────
// JOB WORKER
//
// Long-lived loop that polls the DB for pending jobs and runs them.
// Lives inside the API process (Phase 1). Move to a separate process
// when you outgrow this — the worker module is self-contained, the
// switch is `node worker.js` instead of importing from server.ts.
//
// Single-worker assumption — DO NOT run two worker processes against
// the same DB until the claim logic is upgraded to use SELECT FOR
// UPDATE SKIP LOCKED. Two workers will pick up the same job and you'll
// have race conditions.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { makeJobContext, JobCancelledError } from "./context.js";
import { getHandler } from "./dispatcher.js";
import { JobStatus } from "./types.js";
import { maybeEnqueueRescoresForJob } from "./scoring-triggers.js";
import { maybeRefreshPortfolioHealthForScoringJob } from "../portfolio/phs/refresh.js";
import { surfaceFailedScoringJobById, resolveHealedScoringErrors } from "../scoring/errors/failed-job-guard.js";

interface WorkerOptions {
  /** How often to poll when no jobs are pending. Default 3000ms. */
  pollIntervalMs?: number;
  /** Mark jobs stuck in RUNNING for this long as ABANDONED. Default 30 min. */
  abandonAfterMs?: number;
}

class JobWorker {
  private running = false;
  private currentJobId: string | null = null;
  private options: Required<WorkerOptions>;

  constructor(options: WorkerOptions = {}) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 3000,
      abandonAfterMs: options.abandonAfterMs ?? 30 * 60 * 1000,
    };
  }

  /** Start the worker loop. Returns immediately; loop runs in background. */
  async start() {
    if (this.running) {
      console.warn("[worker] already running");
      return;
    }
    this.running = true;
    console.log("[worker] starting");

    // First, recover any jobs that were RUNNING when the server died last time.
    await this.recoverAbandonedJobs();

    // Run the loop without awaiting — it's a long-lived background task.
    void this.loop();
  }

  /** Signal the loop to exit after the current job. Does not kill the running job. */
  stop() {
    console.log("[worker] stop requested");
    this.running = false;
  }

  /** Returns the ID of the currently-executing job, or null. */
  currentJob(): string | null {
    return this.currentJobId;
  }

  // ── Internals ──────────────────────────────────────────────

  private async loop() {
    while (this.running) {
      try {
        const job = await this.claimNextJob();
        if (!job) {
          await sleep(this.options.pollIntervalMs);
          continue;
        }

        this.currentJobId = job.id;
        await this.runJob(job);
        this.currentJobId = null;
      } catch (err) {
        // Don't let an unexpected error in the loop kill the worker
        console.error("[worker] loop error:", err);
        this.currentJobId = null;
        await sleep(this.options.pollIntervalMs);
      }
    }

    console.log("[worker] stopped");
  }

  /**
   * Atomically claim the next pending job.
   *
   * Phase 1: simple findFirst + update. Safe because we run a single
   * worker. If you ever run multiple workers, replace this with a raw
   * `SELECT ... FOR UPDATE SKIP LOCKED` query.
   */
  private async claimNextJob() {
    const job = await prisma.backgroundJob.findFirst({
      where: { status: JobStatus.PENDING },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (!job) return null;

    const claimed = await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return claimed;
  }

  private async runJob(job: {
    id: string;
    type: string;
    payload: Prisma.JsonValue;
    attempts: number;
    maxAttempts: number;
  }) {
    const handler = getHandler(job.type);
    if (!handler) {
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: `No handler registered for job type "${job.type}"`,
        },
      });
      // Scoring-error guard (Stage 1): a missing handler is a terminal failure too
      // (the rescore never ran → the score is stale). No-op for non-scoring types.
      await surfaceFailedScoringJobById(job.id);
      return;
    }

    const { ctx, abort } = makeJobContext(job.id, job.payload);
    const start = Date.now();

    // ── Cancel polling ────────────────────────────────────────────────────────
    // Handlers that wrap a single long-running async call (most daily-ops
    // handlers) have no natural checkpoint to call ctx.shouldCancel(). We
    // poll the DB every 2 s instead. On detection we immediately flip the row
    // to CANCELLED so the frontend sees it right away. The handler itself
    // cannot be interrupted — it finishes its current I/O — but its result is
    // silently discarded. Handlers that DO call shouldCancel() (screener bulk
    // ingest, quarterly backfill) continue to work as before; the poller is
    // harmless in that case since the row is already CANCELLED by the time the
    // poll fires.
    let cancelledMidRun = false;
    const cancelPoll = setInterval(async () => {
      if (cancelledMidRun) return;
      try {
        const row = await prisma.backgroundJob.findUnique({
          where: { id: job.id },
          select: { cancelRequested: true, status: true },
        });
        if (row?.cancelRequested === true && row.status === JobStatus.RUNNING) {
          cancelledMidRun = true;
          // Abort the AbortController immediately. Any fetch() or other
          // awaitable that received ctx.signal will throw an AbortError right
          // now, unwinding the handler's call stack without waiting for the
          // next batch checkpoint.
          abort();
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.CANCELLED,
              finishedAt: new Date(),
              progressNote:
                "Cancelled — operation will finish its current step then stop",
            },
          });
          console.log(`[worker] job ${job.id} (${job.type}) cancelled via poll`);
        }
      } catch {
        // Poll errors must never surface — progress is best-effort
      }
    }, 2000);

    try {
      const result = await handler(ctx);
      clearInterval(cancelPoll);

      if (cancelledMidRun) {
        // Cancel poller already wrote the terminal state — don't overwrite.
        console.log(
          `[worker] job ${job.id} (${job.type}) finished after cancel — suppressing SUCCEEDED`,
        );
        return;
      }

      // updateMany with a status guard so a cancel that races with this write
      // (between clearInterval and here) cannot be silently overwritten: if
      // the row's status is already CANCELLED the updateMany matches 0 rows.
      const { count } = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING },
        data: {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          durationMs: Date.now() - start,
          result: result as Prisma.InputJsonValue,
          progress: 100,
        },
      });

      if (count > 0) {
        console.log(
          `[worker] job ${job.id} (${job.type}) succeeded in ${Date.now() - start}ms`,
        );
        // ── CENTRAL SCORING TRIGGER ──────────────────────────────────────────
        // After a job genuinely SUCCEEDS, enqueue the PG_RESCORE(s) its new data
        // implies (prices → all 13 scored PGs; results-scan/shareholding → the
        // affected PGs). Gated by SCORING_TRIGGERS_ENABLED. A trigger error NEVER
        // changes the job's outcome — the job already succeeded; this is best-effort.
        try {
          const trig = await maybeEnqueueRescoresForJob(job.type, result);
          if (trig && (trig.enqueued > 0 || trig.deduped > 0)) {
            console.log(
              `[worker] job ${job.id} (${job.type}) → scoring trigger: ${trig.enqueued} rescore(s) enqueued, ${trig.deduped} deduped [${trig.scope}: ${trig.pgIds.join(",")}]`,
            );
          }
        } catch (err) {
          console.error(
            `[worker] job ${job.id} (${job.type}) scoring-trigger error (job still SUCCEEDED):`,
            err,
          );
        }
        // ── PORTFOLIO-HEALTH REFRESH (the nightly-rescore trigger) ───────────
        // When a scoring job (PG_RESCORE / cascades) SUCCEEDS with genuine score
        // changes, recompute PHS for the users holding the changed symbols. No-op for
        // non-scoring jobs and for clean no-op rescores. Best-effort — the job already
        // SUCCEEDED; a PHS failure never changes its outcome.
        try {
          const phs = await maybeRefreshPortfolioHealthForScoringJob(job.type, result);
          if (phs && phs.users > 0) {
            console.log(
              `[worker] job ${job.id} (${job.type}) → PHS refresh: ${phs.written} snapshot(s) written, ${phs.skipped} unchanged, ${phs.failed} failed across ${phs.users} user(s)`,
            );
          }
        } catch (err) {
          console.error(
            `[worker] job ${job.id} (${job.type}) PHS-refresh error (job still SUCCEEDED):`,
            err,
          );
        }
        // ── AUTO-RESOLVE-ON-HEAL (Stage 2) ───────────────────────────────────
        // A scoring job that SUCCEEDED heals its entity → close any open
        // scoring_job_failed row for that entity+period (button-driven OR organic).
        // Best-effort + no-op for non-scoring types; never changes the job outcome.
        await resolveHealedScoringErrors(job.type, job.payload, job.id);
      } else {
        console.log(
          `[worker] job ${job.id} (${job.type}) completed but status was already terminal — suppressing SUCCEEDED`,
        );
      }
    } catch (err) {
      clearInterval(cancelPoll);

      if (cancelledMidRun) {
        // Cancel poller already wrote the terminal state — this error is noise.
        console.log(
          `[worker] job ${job.id} (${job.type}) errored after cancel — suppressing FAILED`,
        );
        return;
      }

      const isCancellation =
        err instanceof JobCancelledError ||
        // AbortError is thrown by fetch() when ctx.signal is aborted.
        // Treat it the same as an explicit JobCancelledError.
        (err instanceof Error && err.name === "AbortError");
      const canRetry = !isCancellation && job.attempts < job.maxAttempts;
      const errorMessage = (err as Error).message;
      const errorStack = (err as Error).stack;

      const newStatus = isCancellation
        ? JobStatus.CANCELLED
        : canRetry
          ? JobStatus.PENDING // back to pending for retry
          : JobStatus.FAILED;

      // Guard: only update if the row is still RUNNING — the cancel poller
      // might have set it to CANCELLED in the narrow window between the
      // handler throwing and clearInterval completing.
      const { count } = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING },
        data: {
          status: newStatus,
          finishedAt: canRetry && !isCancellation ? null : new Date(),
          durationMs: canRetry && !isCancellation ? null : Date.now() - start,
          errorMessage,
          errorStack: errorStack ?? null,
        },
      });

      if (isCancellation) {
        console.log(`[worker] job ${job.id} (${job.type}) cancelled`);
      } else if (canRetry) {
        console.warn(
          `[worker] job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.maxAttempts}), will retry: ${errorMessage}`,
        );
      } else {
        console.error(
          `[worker] job ${job.id} (${job.type}) failed permanently: ${errorMessage}`,
        );
        // Scoring-error guard (Stage 1): surface a GENUINE terminal failure of a
        // scoring job (count>0 ⇒ the FAILED write took effect, not raced by a
        // cancel). No-op for non-scoring types / non-real entities.
        if (count > 0) await surfaceFailedScoringJobById(job.id);
      }
    }
  }

  /**
   * Boot-time recovery: any job stuck in RUNNING longer than abandonAfterMs
   * means the server died while it was executing. Mark it abandoned so it
   * doesn't block the dashboard with a permanently-running ghost.
   *
   * We do NOT auto-retry abandoned jobs. The operator decides — usually by
   * inspecting why it died and either re-enqueueing or moving on.
   */
  private async recoverAbandonedJobs() {
    const cutoff = new Date(Date.now() - this.options.abandonAfterMs);
    const result = await prisma.backgroundJob.updateMany({
      where: {
        status: JobStatus.RUNNING,
        startedAt: { lt: cutoff },
      },
      data: {
        status: JobStatus.ABANDONED,
        finishedAt: new Date(),
        errorMessage: "Worker process died while job was running",
      },
    });

    if (result.count > 0) {
      console.warn(`[worker] recovered ${result.count} abandoned jobs`);
    }
  }
}

// ── Singleton ────────────────────────────────────────────────
// Boot once from server.ts. Don't construct multiple instances.

export const jobWorker = new JobWorker();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
