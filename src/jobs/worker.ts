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
//
// ── LIVENESS AND RECLAIM ─────────────────────────────────────────────────────────
// A claimed row is only as trustworthy as the process behind it, and processes die
// (measured: ~50 boots in 30 days). Three things keep a `running` row honest:
//
//   1. HEARTBEAT — startHeartbeat() stamps `last_heartbeat_at` every 30s for whatever
//      row is claimed. Worker-driven, not handler-driven, so it is independent of what
//      the handler reports. This is liveness; `progress` is not.
//   2. SHUTDOWN  — shutdown() hands the in-flight row back to `pending` on SIGTERM,
//      BEFORE waiting on anything, so the write lands even if the handler ignores us.
//   3. REAPER    — jobs/reaper.ts reclaims rows whose heartbeat went stale, on a
//      2-minute timer (and once at boot with a tighter window). This is the path that
//      covers what neither of the others can: a row orphaned with no restart at all.
//
// ⚠ RETRY AND RECLAIM ARE DIFFERENT MECHANISMS AND ONE CANNOT SUBSTITUTE FOR THE OTHER.
//   `attempts`/`maxAttempts` is reachable ONLY from inside runJob's try block — it needs
//   a thrown exception. A killed process throws nothing, so no retry policy, however
//   generous, can rescue it. Reclaim is reached from outside the job's execution, reading
//   only DB state, and needs no cooperation from the dead job at all.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { makeJobContext, JobCancelledError } from "./context.js";
import { getHandler, type JobHandler } from "./dispatcher.js";
import { JobStatus, JobTypes, restartPolicyFor, type RestartPolicy } from "./types.js";
import {
  reapStalledJobs,
  JOB_HEARTBEAT_INTERVAL_MS,
  MAX_RECLAIMS,
  INTERRUPT_PREFIX,
} from "./reaper.js";
import { enqueueJob } from "./enqueue.js";
import { maybeEnqueueRescoresForJob } from "./scoring-triggers.js";
// ★ THE FILING PASS'S ARM OF THE SAME HOOK (step 6) — see the block at the call site.
import { planFilingRecompute } from "../filing/triggers.js";
import { maybeRefreshPortfolioHealthForScoringJob } from "../portfolio/phs/refresh.js";
import { surfaceFailedScoringJobById, resolveHealedScoringErrors } from "../scoring/errors/failed-job-guard.js";

/** Below fresh ingestion work, alongside the PG rescores this runs next to. */
const FILING_RECOMPUTE_PRIORITY = 60;

export interface WorkerOptions {
  /** How often to poll when no jobs are pending. Default 3000ms. */
  pollIntervalMs?: number;
  /**
   * How often to re-stamp `last_heartbeat_at` on the in-flight row. Default 30s
   * (JOB_HEARTBEAT_INTERVAL_MS — see reaper.ts for why that number).
   */
  heartbeatIntervalMs?: number;
  /**
   * Handler resolution seam. Defaults to the production dispatcher. Exists ONLY so the
   * durability harness can drive a real worker loop with synthetic job types instead of
   * running a real ingester — see scripts/verify-job-durability.ts.
   */
  resolveHandler?: (type: string) => JobHandler | null;
  /** Restart-policy resolution seam. Same reason; defaults to restartPolicyFor. */
  policyFor?: (type: string) => RestartPolicy;
  /** Run the boot reclaim pass on start(). Default true. */
  bootReclaim?: boolean;
}

export class JobWorker {
  private running = false;
  private shuttingDown = false;
  private currentJobId: string | null = null;
  /** abort() for the in-flight job's ctx.signal, held so shutdown() can reach it. */
  private currentAbort: (() => void) | null = null;
  /** Set when shutdown() has already written an interrupt row for currentJobId. */
  private interruptedJobId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private options: Required<WorkerOptions>;

  constructor(options: WorkerOptions = {}) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 3000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? JOB_HEARTBEAT_INTERVAL_MS,
      resolveHandler: options.resolveHandler ?? getHandler,
      policyFor: options.policyFor ?? restartPolicyFor,
      bootReclaim: options.bootReclaim ?? true,
    };
  }

  /** Start the worker loop. Returns immediately; loop runs in background. */
  async start() {
    if (this.running) {
      console.warn("[worker] already running");
      return;
    }
    this.running = true;
    this.shuttingDown = false;
    console.log("[worker] starting");

    // Reclaim rows whose worker vanished before this process existed. This is the BOOT
    // pass of the same reaper the timer runs — one predicate, two call sites, so the two
    // cannot drift apart the way the old boot-only sweep drifted from its own docs.
    if (this.options.bootReclaim) {
      await reapStalledJobs({ mode: "boot", policyFor: this.options.policyFor });
    }

    // ONE worker-level heartbeat timer, started here and running for the worker's whole
    // life. ★ It is NOT started per-job and NOT driven from inside a handler: it fires off
    // the Node timer queue regardless of what the handler is awaiting, which is precisely
    // what makes a handler blocked in a 60s fetch keep looking alive.
    this.startHeartbeat();

    // Run the loop without awaiting — it's a long-lived background task.
    void this.loop();
  }

  /**
   * Stop claiming new work. Does NOT protect the in-flight job — use shutdown() for that.
   * Kept because tests and the admin path want a flag flip with no DB write.
   */
  stop() {
    console.log("[worker] stop requested (no in-flight protection — see shutdown())");
    this.running = false;
  }

  /**
   * GRACEFUL SHUTDOWN. Stops claiming, stops heartbeating, and hands the in-flight row
   * back to the queue (or fails it, per RESTART_POLICIES) so the next process re-runs it
   * instead of finding a ghost.
   *
   * ── ORDER IS THE DESIGN ──────────────────────────────────────────────────────────
   * The row write happens FIRST, before we wait on anything and before we ask the handler
   * to stop. That is deliberate and it is the answer to "what if the handler ignores the
   * signal?". The old shutdown gave the job 30 seconds to finish and then exited — so for
   * every job longer than 30s (results_scan p50 2.29h, ICA p50 26min) the process died
   * with the row still `running` and nothing written at all. Waiting first makes the write
   * the thing most likely to be skipped. Writing first makes it the thing most likely to
   * land: at t≈0 the event loop is as free as it will ever be during shutdown.
   *
   * ⚠ COST OF WRITING FIRST, STATED. A job that would have finished in the remaining grace
   *   is marked interrupted anyway. That case is HEALED rather than paid for: if the
   *   handler does complete before the process dies, runJob re-asserts SUCCEEDED over the
   *   interrupt row (see the `count === 0` branch below), so no work is silently repeated.
   *
   * ── DOES SIGTERM abort() THE HANDLER? YES — BUT NEVER AS THE PROTECTION ──────────
   * After the row is safe, abort() is called so cooperative handlers unwind their in-flight
   * I/O immediately instead of spending the rest of the grace on work whose result is
   * already discarded. 24 of 36 handler files can use it. The other 12 never check
   * shouldCancel and never take ctx.signal — for those abort() does nothing at all, and the
   * row write is the ONLY protection they have. Which is exactly why it is not the row
   * write that waits on the abort.
   *
   * abort() cannot corrupt the outcome: the resulting AbortError lands in runJob's catch,
   * which writes through `updateMany where status = RUNNING` and matches 0 rows, because
   * this function already moved the row off RUNNING.
   */
  async shutdown(): Promise<{ interrupted: boolean; jobId?: string; action?: "requeued" | "failed" }> {
    if (this.shuttingDown) return { interrupted: false };
    this.shuttingDown = true;
    this.running = false;
    // Stop beating BEFORE anything else. A process on its way out must not keep claiming
    // liveness for a job it is about to abandon.
    this.stopHeartbeat();

    const jobId = this.currentJobId;
    if (!jobId) {
      console.log("[worker] shutdown — no job in flight, nothing to protect");
      return { interrupted: false };
    }

    const action = await this.markInterrupted(jobId);
    this.interruptedJobId = jobId;

    // Only now, and only as a courtesy to the handlers that can hear it.
    try {
      this.currentAbort?.();
    } catch {
      /* abort() must never be able to fail a shutdown that has already done its job */
    }
    return { interrupted: action !== null, jobId, action: action ?? undefined };
  }

  /** Returns the ID of the currently-executing job, or null. */
  currentJob(): string | null {
    return this.currentJobId;
  }

  // ── Liveness ───────────────────────────────────────────────

  /**
   * The heartbeat. One timer for the worker's whole life; each tick stamps
   * `last_heartbeat_at = now()` on whatever row is currently claimed.
   *
   * ★ WHY THIS IS NOT reportProgress. `progress` is written by the handler, so it proves
   *   only that the handler chose to report. Measured: live ICA runs sit at progress 38
   *   for minutes at a time, and TWO of the recorded corpses were at progress 100. This
   *   timer is driven by the worker, so it separates "the handler has something to say"
   *   from "a process is alive and owns this row" — which are different questions, and
   *   only the second one is liveness.
   *
   * Errors are swallowed on purpose: a heartbeat write that fails must never break the
   * job. One miss costs nothing (the reaper's window is 20 beats wide); it takes twenty
   * consecutive failures to reach a reclaim, by which point the DB is the problem.
   */
  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const jobId = this.currentJobId;
      if (!jobId || this.shuttingDown) return;
      // Guarded on RUNNING so a beat that races the terminal write cannot resurrect a
      // finished row's liveness. Fire-and-forget: never awaited by the loop.
      void prisma.backgroundJob
        .updateMany({
          where: { id: jobId, status: JobStatus.RUNNING },
          data: { lastHeartbeatAt: new Date() },
        })
        .catch(() => {
          /* best-effort; see the note above */
        });
    }, this.options.heartbeatIntervalMs);
    // Don't hold the process open just to heartbeat.
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Hand the in-flight row back — the SIGTERM half of reclaim.
   *
   * ── INTERRUPTED vs FAILED, AND HOW THEY STAY DISTINGUISHABLE ─────────────────────
   * A FAILED job threw: the worker caught an exception, `attempts` was already consumed
   * by the claim, and `attempts < maxAttempts` decides a retry. An INTERRUPTED job never
   * threw — the process was told to die while it was working.
   *
   * So this path writes `status = pending` WITHOUT touching `attempts`. That matters
   * concretely: instrument_corporate_actions carries maxAttempts 2 precisely so a
   * transient NSE blip cannot leave the fold on a stale split table, and burning that
   * budget on a redeploy would spend the protection on the wrong failure.
   *
   * The bound on repeated interruption is `reclaimCount`, a separate counter: at
   * MAX_RECLAIMS the job is failed instead, so a process that dies at the same point every
   * run surfaces rather than requeuing forever.
   *
   * The two states are also greppable apart on the row itself: an interrupted row is
   * `pending` with errorMessage starting "interrupted:", a reaped one "reclaimed:", and a
   * genuinely failed one is `failed`/`abandoned` with the thrown message.
   */
  private async markInterrupted(jobId: string): Promise<"requeued" | "failed" | null> {
    let row: {
      type: string; progress: number; progressNote: string | null;
      reclaimCount: number; attempts: number; maxAttempts: number; cancelRequested: boolean;
    } | null = null;
    try {
      row = await prisma.backgroundJob.findUnique({
        where: { id: jobId },
        select: {
          type: true, progress: true, progressNote: true, reclaimCount: true,
          attempts: true, maxAttempts: true, cancelRequested: true,
        },
      });
    } catch (err) {
      console.error(`[worker] shutdown — could not read job ${jobId}; row left as-is:`, err);
      return null;
    }
    if (!row) return null;

    const policy = this.options.policyFor(row.type);
    const exhausted = row.reclaimCount >= MAX_RECLAIMS;
    const requeue = policy === "requeue" && !exhausted && !row.cancelRequested;
    const where = { id: jobId, status: JobStatus.RUNNING };

    const reason = requeue
      ? `${INTERRUPT_PREFIX} SIGTERM during shutdown — requeued from the start, attempts NOT consumed ` +
        `(was ${row.progress}%${row.progressNote ? `, "${row.progressNote}"` : ""}; ` +
        `reclaim ${row.reclaimCount + 1}/${MAX_RECLAIMS})`
      : `${INTERRUPT_PREFIX} SIGTERM during shutdown. ` +
        (row.cancelRequested
          ? "A cancel was already requested — not re-run."
          : exhausted
            ? `Interrupted ${row.reclaimCount}× already — giving up rather than requeue again.`
            : `This job type is NOT safe to auto-re-run (RESTART_POLICIES = "fail"), so it is surfaced ` +
              `instead of silently repeated.`) +
        ` (was ${row.progress}%${row.progressNote ? `, "${row.progressNote}"` : ""})`;

    try {
      const { count } = await prisma.backgroundJob.updateMany({
        where,
        data: requeue
          ? {
              status: JobStatus.PENDING,
              startedAt: null,
              finishedAt: null,
              durationMs: null,
              progress: 0,
              progressNote: null,
              lastHeartbeatAt: null,
              errorMessage: reason,
              errorStack: null,
              // ★ GIVE THE ATTEMPT BACK — see reaper.ts for the full note. Merely *not*
              //   incrementing is insufficient: the re-claim increments, so an interruption
              //   would still consume a retry. Decrementing returns `attempts` to its
              //   pre-claim value, leaving the retry budget exactly as it was.
              attempts: { decrement: 1 },
              reclaimCount: { increment: 1 },
            }
          : {
              status: JobStatus.ABANDONED,
              finishedAt: new Date(),
              errorMessage: reason,
              reclaimCount: { increment: 1 },
            },
      });
      if (count === 0) {
        // The job finished in the moments between SIGTERM and this write. Nothing to do —
        // its own terminal write already landed and is correct.
        console.log(`[worker] shutdown — job ${jobId} (${row.type}) already terminal; nothing to protect`);
        return null;
      }
    } catch (err) {
      console.error(`[worker] shutdown — FAILED to hand back job ${jobId} (${row.type}):`, err);
      return null;
    }

    console.error(
      `[worker] shutdown — ${requeue ? "REQUEUED" : "ABANDONED"} in-flight job ${row.type} ${jobId} ` +
        `(progress ${row.progress}%, attempts ${row.attempts}/${row.maxAttempts} UNCHANGED, ` +
        `reclaims ${row.reclaimCount} → ${row.reclaimCount + 1}) :: ${reason}`,
    );
    return requeue ? "requeued" : "failed";
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
        this.currentAbort = null;
      } catch (err) {
        // ⚠ THIS IS THE SWALLOWED-TERMINAL-WRITE PATH, AND IT LEAVES A GHOST.
        //
        // runJob owns its own try/catch, so anything reaching here escaped it — and the
        // realistic escape is the TERMINAL updateMany itself throwing (a DB blip at the
        // exact moment the job finishes). The row is then left `running` with nobody
        // behind it, no process died, and no restart will ever occur to trigger boot
        // recovery. Before the reaper existed, that row was permanent, and it silently
        // disabled its cron via enqueueIfNotActive.
        //
        // It is STILL not repaired here, deliberately: this catch cannot know whether the
        // handler's work landed, and guessing would be worse than leaving a fact on the
        // floor. What has changed is that the row stops heartbeating the moment
        // currentJobId is cleared below, so the 2-minute timer reclaims it within
        // STALE_AFTER_MS — no restart required. That is the whole reason the reaper is a
        // timer and not a boot hook.
        console.error(
          "[worker] loop error — the in-flight row may be left RUNNING; the reaper will " +
            "reclaim it on heartbeat age:",
          err,
        );
        this.currentJobId = null;
        this.currentAbort = null;
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
    // ── SELECT ONLY `id`. THIS IS AN EGRESS FIX, NOT A TIDY-UP. ──
    //
    // This query runs every pollIntervalMs forever and MISSES almost every time: measured
    // 1,181,360 calls returning 978 rows in total across 40 days. What it costs is therefore
    // not rows — it is the RowDescription Postgres sends back to describe the shape of the
    // (empty) result. Unprojected, that describes all 18 columns of background_jobs and is
    // ~513 bytes; projected to `id` alone it is ~28. And because DATABASE_URL carries
    // `?pgbouncer=true`, Prisma cannot cache the prepared statement, so the full description
    // is re-sent on EVERY poll rather than once per connection. ~485 B × ~29.5 k polls/day is
    // ~430 MB/month of egress spent describing a row we did not get.
    //
    // WHY THIS IS SAFE: `id` is the only field the claim step below reads (`where: { id }`).
    // Everything runJob() needs — type, payload, attempts, maxAttempts — comes from the
    // UPDATE's return value, which is a full row and is deliberately left unprojected.
    // orderBy does not require its columns to be selected.
    const job = await prisma.backgroundJob.findFirst({
      where: { status: JobStatus.PENDING },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!job) return null;

    const claimed = await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
        // ★ STAMPED AT CLAIM, not on the first timer tick. Without this there is a window
        //   (up to one heartbeat interval) where a just-claimed row has a NULL heartbeat —
        //   and NULL is the legacy marker, which would put a brand-new job in the wrong
        //   branch of the reaper. Claiming and proving liveness are the same instant.
        lastHeartbeatAt: new Date(),
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
    const handler = this.options.resolveHandler(job.type);
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
    // Held on the instance so shutdown() can unwind a cooperative handler's in-flight I/O
    // AFTER it has already made the row safe. See shutdown()'s contract.
    this.currentAbort = abort;
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
        // ── FILING TRIGGER (step 6) ──────────────────────────────────────────
        // The same hook, the other pass. Where the scoring trigger fans a changed symbol out to its
        // PEER GROUPS, this one narrows to the RULES the moved feed drives and the STOCKS in that
        // batch — a shareholding upload recomputes eight rules on the symbols it wrote, and nothing
        // else. `startedAt` is passed because the two daily feeds (insider, block deals) do not
        // declare their batch and it has to be derived from what they inserted during the run.
        // Same best-effort contract: a trigger error never changes the job's outcome.
        try {
          const plan = await planFilingRecompute(job.type, result, new Date(start));
          if (plan && plan.symbols.length) {
            const j = await enqueueJob({
              type: JobTypes.FILING_RECOMPUTE,
              payload: {
                feeds: [...plan.feeds],
                symbols: plan.symbols,
                triggeredBy: `hook:${job.type}`,
                reason: `${job.type} moved ${plan.feeds.join("+")} on ${plan.symbols.length} symbol(s) [${plan.source}]`,
              },
              triggeredBy: `hook:${job.type}`,
              priority: FILING_RECOMPUTE_PRIORITY,
            });
            console.log(
              `[worker] job ${job.id} (${job.type}) → filing trigger: FILING_RECOMPUTE ${j.id} — ${plan.feeds.join("+")} × ${plan.symbols.length} symbol(s) [${plan.source}]`,
            );
          }
        } catch (err) {
          console.error(
            `[worker] job ${job.id} (${job.type}) filing-trigger error (job still SUCCEEDED):`,
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
        // ── LATE-COMPLETION HEAL ────────────────────────────────────────────────────
        // shutdown() writes the interrupt row FIRST, without waiting to see whether the
        // handler was about to finish (that ordering is what guarantees the write lands —
        // see shutdown()). The price is this case: the handler DID complete, inside the
        // remaining grace, over a row we already moved to `pending`.
        //
        // Rather than pay it as a redundant re-run, re-assert the truth. The guard is
        // narrow by construction — same id, still `pending`, and still carrying OUR
        // interrupt marker — so this can never overwrite a genuine requeue, a reaper
        // reclaim, or a cancel. reclaimCount is walked back too: the row was not, in the
        // end, reclaimed.
        if (this.interruptedJobId === job.id) {
          const healed = await prisma.backgroundJob.updateMany({
            where: {
              id: job.id,
              status: JobStatus.PENDING,
              errorMessage: { startsWith: INTERRUPT_PREFIX },
            },
            data: {
              status: JobStatus.SUCCEEDED,
              finishedAt: new Date(),
              durationMs: Date.now() - start,
              result: result as Prisma.InputJsonValue,
              progress: 100,
              errorMessage: null,
              // Undo both bookkeeping moves markInterrupted made: the run was not, in the
              // end, interrupted, so the attempt it consumed was real and the reclaim was not.
              attempts: { increment: 1 },
              reclaimCount: { decrement: 1 },
            },
          });
          if (healed.count > 0) {
            console.log(
              `[worker] job ${job.id} (${job.type}) finished inside the shutdown grace — ` +
                `interrupt healed to SUCCEEDED, no re-run needed`,
            );
            return;
          }
        }
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

  // ── Boot recovery now lives in reaper.ts ─────────────────────────────────────────
  //
  // `recoverAbandonedJobs` used to live here. It is GONE, not renamed, and the reason is
  // that it could not be fixed in place: it decided "is this row dead?" from
  // `now() - startedAt > 30min`, which is unanswerable — a healthy results_scan runs 6-14
  // hours. It also ran only at boot, so a restart that arrived inside the 30-minute window
  // lost the race permanently. That is the exact shape of the 11 August stall.
  //
  // The replacement is `reapStalledJobs({ mode: "boot" })`, called from start(). Same
  // function the 2-minute timer calls, keyed on heartbeat age, with a tighter window at
  // boot (90s vs 10min) and a legacy branch for rows that predate the heartbeat column.
  // One predicate, two call sites — which is what stops this drifting from its own docs
  // again.
}

// ── Singleton ────────────────────────────────────────────────
// Boot once from server.ts. Don't construct multiple instances.

export const jobWorker = new JobWorker();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
