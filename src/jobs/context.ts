// ─────────────────────────────────────────────────────────────
// JOB CONTEXT
//
// Every handler receives a context object with:
//   - the parsed payload
//   - reportProgress(percent, note) — call as work proceeds
//   - shouldCancel() — call at safe points to honour cancellation
//
// Handlers are normal async functions. They throw on failure.
// They return a JSON-serialisable result on success.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";

export interface JobContext<TPayload = unknown> {
  jobId: string;
  payload: TPayload;
  /**
   * An AbortSignal tied to this job's lifecycle.
   * Pass this to every fetch() / HTTP call inside a handler or ingestion service:
   *   fetch(url, { signal: ctx.signal })
   * When the cancel poller fires it calls abort(), which makes any in-flight
   * network request throw an AbortError immediately — no waiting for the
   * next batch checkpoint.
   */
  signal: AbortSignal;
  reportProgress(percent: number, note?: string): Promise<void>;
  shouldCancel(): Promise<boolean>;
}

/**
 * Build a context object bound to a specific job row.
 * The worker calls this; handlers don't construct it themselves.
 *
 * Returns { ctx, abort } — the worker holds onto `abort` and calls it
 * when cancellation is detected so that in-flight fetch() calls that
 * received ctx.signal are interrupted immediately.
 */
export function makeJobContext<TPayload>(
  jobId: string,
  payload: TPayload,
): { ctx: JobContext<TPayload>; abort: () => void } {
  const abortController = new AbortController();

  // Throttle progress writes — handlers may call reportProgress on every iteration.
  // Writing to the DB on every call is wasteful; throttle to ~once per 500ms.
  let lastProgressWrite = 0;
  let lastReportedPercent = -1;

  const ctx: JobContext<TPayload> = {
    jobId,
    payload,
    signal: abortController.signal,

    async reportProgress(percent, note) {
      const now = Date.now();
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));

      // Always write completion (100) and meaningful jumps; throttle small updates.
      const significant =
        clamped === 100 ||
        clamped - lastReportedPercent >= 5 ||
        now - lastProgressWrite > 500;

      if (!significant) return;

      lastReportedPercent = clamped;
      lastProgressWrite = now;

      try {
        await prisma.backgroundJob.update({
          where: { id: jobId },
          data: {
            progress: clamped,
            progressNote: note ?? null,
          },
        });
      } catch (err) {
        // Progress writes must never break the handler
        console.warn(`[job ${jobId}] progress update failed:`, err);
      }
    },

    async shouldCancel() {
      // Fast path: signal already aborted — no DB round-trip needed.
      // This is set synchronously by the cancel poller calling abort(), so
      // handlers that check shouldCancel() inside a tight loop get an
      // instant answer without an extra DB query.
      if (abortController.signal.aborted) return true;

      try {
        const job = await prisma.backgroundJob.findUnique({
          where: { id: jobId },
          select: { cancelRequested: true },
        });
        return job?.cancelRequested === true;
      } catch {
        return false;
      }
    },
  };

  return { ctx, abort: () => abortController.abort() };
}

/**
 * Sentinel error a handler can throw to honour cancellation cleanly.
 * The worker catches this specifically and marks the job CANCELLED
 * rather than FAILED.
 */
export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled by request");
    this.name = "JobCancelledError";
  }
}
