// ─────────────────────────────────────────────────────────────
// JOB REAPER — reclaim rows whose worker vanished.
//
// ── THE FAILURE THIS EXISTS FOR (measured, 11 Aug 2026) ──────────────────────────
// instrument_corporate_actions row fd413806 was claimed at 19:45:02 and its worker
// disappeared within the next ~15 minutes (proof: mf_analytics_daily was claimed at
// 20:00:01, and worker.ts's loop is strictly serial, so the loop that owned ICA was
// already gone). A new process booted and ran recoverAbandonedJobs — which reaps
// `running` rows older than 30 MINUTES, and ICA was 10 minutes old. It reaped nothing.
//
// Boot recovery ran ONCE, lost that race, and never looked again — its single call site
// was worker.ts:59, at boot. The row stayed `running` for 2.74 days. Because
// enqueueIfNotActive skips on pending|running, the 12 and 13 Aug ticks never ran, and
// mf_analytics folded ETF NAV against a stale split table for three nights. The admin
// pipeline card read "succeeded, minutes ago" the whole time, because it queries
// `finishedAt IS NOT NULL` and a ghost has none.
//
// ── WHY THIS IS KEYED ON HEARTBEAT AGE AND NEVER ON started_at ───────────────────
// A started_at reaper cannot be built. results_scan measures p50 2.29h, p95 6.30h,
// max 14.55h; any threshold wide enough to spare a live scan is hours too wide to catch
// a corpse, and any threshold tight enough to catch a corpse kills live scans. Heartbeat
// age is duration-blind: a 14-hour scan beats every 30 seconds for 14 hours, so it is
// never a candidate, while a corpse stops beating the instant its process dies.
//
// ⚠ THOSE DURATIONS ARE THE PER-SYMBOL PATH, NOT THE NIGHTLY CRON. Naming the job type
//   without naming the path has already misled one reader into believing the recurring
//   scan is a multi-hour job and redesigning the scheduler around it. It is not:
//     · per-symbol universe scan (RETIRED as a cron; still reachable, and required, for
//       backfill and for re-scanning a symbol after an industryType correction — a window
//       filters on BROADCAST date, so it can never serve history)
//       → the p50 2.29h / max 14.55h above. Last cron runs 2026-07-29..08-06, ~3h each.
//     · ranged universe scan (what the cron actually enqueues: `{ mode: "universe" }`
//       with no `discovery` → "ranged")
//       → MEASURED 6-9s off-season, 152s at the 2026-08-15 in-season peak. Discovery is
//         1-2 paged requests regardless of universe size; the cost is per FILING, not per
//         stock, so it barely moves when the universe grows.
//   The argument for heartbeat-age keying is unaffected — the per-symbol path still runs
//   for hours during a backfill, and that is the case a started_at reaper would kill.
//
// ── THE FALSE POSITIVE IS THE DANGEROUS DIRECTION ────────────────────────────────
// Killing a live 6-hour scan is worse than leaving a corpse one more cycle. Three
// independent guards, in order:
//   1. The predicate is heartbeat age, not elapsed runtime (above).
//   2. The heartbeat is written by the WORKER on its own timer, outside the handler's
//      control flow — a handler blocked in a 60s fetch keeps beating, because the fetch
//      is I/O and the event loop is free.
//   3. The reclaim UPDATE re-asserts the staleness predicate atomically. A row that beat
//      between the SELECT and the UPDATE matches 0 rows and is left strictly alone.
// And the margin is 20 missed beats before anything is touched (30s beat, 10min window).
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────
// It runs IN-PROCESS with the worker. If the whole process is dead, the reaper is dead
// too — that case is the boot pass's job, and the boot pass is this same function with a
// tighter window. There is no separate reaper process and none is wanted.
//
// ⚠ CORRECTION (Part 3 recon). An earlier draft of this header said "this build is
//   single-worker by construction", echoing worker.ts. THAT IS NOT TRUE IN PRODUCTION.
//   Measured over 21 days: 34 overlapping execution intervals on 7 distinct days,
//   including 5 CROSS-TYPE overlaps — 4 of them instrument_corporate_actions running
//   concurrently with mf_analytics_daily. And `retention_prune` (maxAttempts 1, so it has
//   no retry path at all) carries attempts=2 on two rows, which only a second claimant can
//   produce. Two API instances are reaching this database, at least transiently.
//
//   The heartbeat design happens to be CORRECT under that, and not by luck — liveness is a
//   property of the ROW, not of a worker identity, so a row another live instance is
//   working keeps beating and is never a candidate here. The guarded UPDATE (guard #3
//   below) re-asserts staleness atomically, so two reapers cannot both reclaim one row.
//   The OLD startedAt rule had neither property.
//
//   What is NOT fixed by this build, and is out of its scope: claimNextJob is findFirst +
//   update, which is not atomic, so two workers CAN claim the same pending row. See the
//   Part 3 report — this needs SELECT … FOR UPDATE SKIP LOCKED, deliberately not attempted
//   here.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { JobStatus, restartPolicyFor, type RestartPolicy } from "./types.js";

// ── Constants, and why each is the number it is ──────────────────────────────────

/**
 * How often the worker re-stamps `last_heartbeat_at` for the job it is running.
 *
 * 30 SECONDS. The cost is one small UPDATE per interval against at most ONE in-flight
 * row (the worker is single-threaded and drains serially) — 2 writes/minute, ~2,880/day.
 * For scale: the claim poll already issues ~29,500 reads/day against the same table, so
 * this is ~10% of an existing cost that is itself considered negligible. It is not a
 * write storm at any plausible job volume, because the volume is bounded by concurrency
 * (1), not by job count.
 *
 * Faster (5s) would buy detection latency the reaper does not spend anyway — the window
 * below dominates. Slower (5min) would leave too few beats inside that window for the
 * margin to mean anything.
 */
export const JOB_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How stale a heartbeat must be before the TIMER reclaims the row. 10 MINUTES.
 *
 * = 20 consecutive missed beats. Job duration does not enter this number at all, which is
 * the whole point of heartbeating; what it must exceed is the longest plausible gap
 * between two beats on a *live* worker:
 *   · a transient DB write failure — heartbeat errors are swallowed and retried on the
 *     next tick, so a reclaim needs 20 consecutive failures, not one;
 *   · a GC pause or a pgbouncer hiccup — seconds, not minutes;
 *   · ⚠ a handler that blocks the EVENT LOOP synchronously. This is the real one, and the
 *     candidate is mf_analytics_daily, which folds ~9.2M NAV rows in memory. It streams
 *     and awaits per window, so any single block is bounded by one chunk — but 20 beats of
 *     headroom is deliberately generous here rather than tight. A process that cannot run
 *     a timer for ten minutes is not serving HTTP either, and is dead by any definition.
 *
 * Paired with a 2-minute reaper cadence this gives worst-case detection of 12 minutes,
 * against the 2.74 days the 11 Aug row actually took.
 */
export const STALE_AFTER_MS = 10 * 60_000;

/**
 * The BOOT pass's window. 90 SECONDS = 3 missed beats.
 *
 * Boot is a different question from the timer's. At boot, any `running` row was owned by
 * a process that is gone — EXCEPT during a rolling deploy, where the outgoing instance can
 * still be draining a live job while the incoming one boots. That overlap is exactly the
 * false positive the old 30-minute rule was accidentally protecting against, and it is why
 * boot recovery cannot simply reclaim everything it finds.
 *
 * 90 seconds resolves both: a draining instance is still beating every 30s, so its job is
 * protected; a genuinely orphaned row stopped beating the moment its process died, and is
 * reclaimed at the very boot that previously lost the race. On the 11 Aug timeline the
 * ghost's last beat was ~19:50 and the boot ~19:55 — reclaimed on the spot.
 */
export const BOOT_STALE_AFTER_MS = 90_000;

/**
 * ⚠ THE TRANSITION RULE. Applies ONLY to rows with `last_heartbeat_at IS NULL` — i.e. rows
 * claimed by a worker that predates the column — and ONLY at boot. 30 MINUTES, which is
 * verbatim the old recoverAbandonedJobs threshold.
 *
 * This is chosen so that the first deploy after this ships behaves IDENTICALLY to today
 * for legacy rows: the only NULL-heartbeat rows it can touch are ones the old code would
 * also have marked abandoned at that same boot. Treating NULL as "infinitely stale" was
 * the obvious alternative and it is wrong — it would reclaim a live 6-hour scan on the
 * first restart after ship.
 *
 * The TIMER never touches a NULL heartbeat at all (see `reapStalledJobs`). This branch
 * goes dead on its own, one job-cycle after deploy, once every live row carries a beat.
 */
export const LEGACY_BOOT_STALE_AFTER_MS = 30 * 60_000;

/**
 * How many times one row may be reclaimed before it is failed instead of requeued.
 *
 * A reclaim deliberately does NOT consume `attempts` — the job was interrupted, not
 * failed, and burning a retry on an interruption is what would have made ICA's
 * maxAttempts:2 useless a second time. But an un-consumed counter needs its own bound, or
 * a process that dies at the same point every run requeues the same job forever. Three is
 * enough for a redeploy window (the measured pattern is ~50 boots/30d, i.e. isolated
 * events) and small enough that a genuine crash-loop surfaces the same day.
 */
export const MAX_RECLAIMS = 3;

/** Machine-greppable prefix on `errorMessage` for a row the reaper returned to pending. */
export const RECLAIM_PREFIX = "reclaimed:";
/** Machine-greppable prefix for a row returned to pending by graceful shutdown. */
export const INTERRUPT_PREFIX = "interrupted:";

// ── Types ────────────────────────────────────────────────────

export type ReapMode = "timer" | "boot";

export interface ReapOptions {
  /** "timer" (default) never touches NULL heartbeats; "boot" also runs the legacy branch. */
  mode?: ReapMode;
  /** Clock injection. Defaults to now. */
  now?: Date;
  /** Override the heartbeat-age window. Defaults per mode. */
  staleAfterMs?: number;
  /** Override the NULL-heartbeat window (boot only). */
  legacyStaleAfterMs?: number;
  /** Policy resolver injection — the harness uses this for synthetic types. */
  policyFor?: (type: string) => RestartPolicy;
  /** Reclaim ceiling override. */
  maxReclaims?: number;
}

export interface ReapOutcome {
  id: string;
  type: string;
  action: "requeued" | "failed";
  reason: string;
  /** ms since the last proven sign of life (heartbeat, or startedAt for legacy rows). */
  stalledMs: number;
  lastHeartbeatAt: Date | null;
  startedAt: Date | null;
  progress: number;
  progressNote: string | null;
  reclaimCount: number;
  /** true when this row was matched by the NULL-heartbeat legacy branch. */
  legacy: boolean;
}

export interface ReapReport {
  mode: ReapMode;
  /** Rows that matched the staleness predicate. */
  scanned: number;
  requeued: number;
  failed: number;
  /** Matched the SELECT but lost the guarded UPDATE — it beat, or went terminal. Left alone. */
  skippedRaced: number;
  outcomes: ReapOutcome[];
}

// ── The pass ─────────────────────────────────────────────────

/**
 * Reclaim every `running` row whose worker has stopped proving it is alive.
 *
 * Safe to call concurrently with a live worker: every write is guarded on the row still
 * being `running` AND still matching the staleness predicate, so a row that heartbeats
 * between the SELECT and the UPDATE is skipped rather than reclaimed.
 *
 * Never throws — a reaper that can take the process down with it is worse than no reaper.
 */
export async function reapStalledJobs(opts: ReapOptions = {}): Promise<ReapReport> {
  const mode = opts.mode ?? "timer";
  const now = opts.now ?? new Date();
  const staleAfterMs =
    opts.staleAfterMs ?? (mode === "boot" ? BOOT_STALE_AFTER_MS : STALE_AFTER_MS);
  const legacyStaleAfterMs = opts.legacyStaleAfterMs ?? LEGACY_BOOT_STALE_AFTER_MS;
  const policyFor = opts.policyFor ?? restartPolicyFor;
  const maxReclaims = opts.maxReclaims ?? MAX_RECLAIMS;

  const cutoff = new Date(now.getTime() - staleAfterMs);
  const legacyCutoff = new Date(now.getTime() - legacyStaleAfterMs);

  const report: ReapReport = { mode, scanned: 0, requeued: 0, failed: 0, skippedRaced: 0, outcomes: [] };

  // ── SELECT ────────────────────────────────────────────────────────────────────
  // ⚠ The NULL-heartbeat arm is present ONLY at boot. On the timer it is absent by
  //   construction, not by a runtime check: a row this process claimed always carries a
  //   heartbeat (claimNextJob stamps it), so a NULL on the timer can only be a legacy row,
  //   and legacy rows are the boot pass's business. This is what makes the first deploy
  //   after the migration provably unable to kill anything live.
  const staleArm = { lastHeartbeatAt: { lt: cutoff } };
  const legacyArm = { lastHeartbeatAt: null, startedAt: { lt: legacyCutoff } };

  let candidates: {
    id: string; type: string; startedAt: Date | null; lastHeartbeatAt: Date | null;
    progress: number; progressNote: string | null; reclaimCount: number;
    attempts: number; cancelRequested: boolean;
  }[];
  try {
    candidates = await prisma.backgroundJob.findMany({
      where: {
        status: JobStatus.RUNNING,
        OR: mode === "boot" ? [staleArm, legacyArm] : [staleArm],
      },
      select: {
        id: true, type: true, startedAt: true, lastHeartbeatAt: true,
        progress: true, progressNote: true, reclaimCount: true,
        attempts: true, cancelRequested: true,
      },
      orderBy: { startedAt: "asc" },
    });
  } catch (err) {
    console.error(`[reaper] scan failed (${mode}) — no row was touched:`, err);
    return report;
  }

  report.scanned = candidates.length;
  if (!candidates.length) return report;

  for (const row of candidates) {
    const legacy = row.lastHeartbeatAt === null;
    const lastAlive = row.lastHeartbeatAt ?? row.startedAt ?? now;
    const stalledMs = Math.max(0, now.getTime() - lastAlive.getTime());
    const stalledLabel = humanDuration(stalledMs);

    // ── DECIDE ──────────────────────────────────────────────────────────────────
    const policy = policyFor(row.type);
    const exhausted = row.reclaimCount >= maxReclaims;
    let action: "requeued" | "failed";
    let reason: string;

    if (row.cancelRequested) {
      // A cancel was already requested against this row and its worker then vanished.
      // Requeuing it would run work the operator asked to stop; the honest terminal state
      // is the one they asked for.
      action = "failed";
      reason =
        `${RECLAIM_PREFIX} worker vanished ${stalledLabel} ago with a cancel already requested — ` +
        `not re-run (last progress ${row.progress}%${row.progressNote ? `, "${row.progressNote}"` : ""})`;
    } else if (policy === "requeue" && !exhausted) {
      action = "requeued";
      reason =
        `${RECLAIM_PREFIX} worker stopped heartbeating ${stalledLabel} ago` +
        `${legacy ? " (legacy row — no heartbeat column when it was claimed)" : ""}` +
        ` — requeued from the start, attempts NOT consumed ` +
        `(was ${row.progress}%${row.progressNote ? `, "${row.progressNote}"` : ""}; ` +
        `reclaim ${row.reclaimCount + 1}/${maxReclaims})`;
    } else if (policy === "requeue" && exhausted) {
      action = "failed";
      reason =
        `${RECLAIM_PREFIX} reclaimed ${row.reclaimCount}× without ever completing — giving up ` +
        `rather than requeue a ${row.reclaimCount + 1}th time. Something kills this job every run; ` +
        `it needs a person, not another attempt.`;
    } else {
      action = "failed";
      reason =
        `${RECLAIM_PREFIX} worker stopped heartbeating ${stalledLabel} ago. ` +
        `This job type is NOT safe to auto-re-run (RESTART_POLICIES = "fail"), so it is surfaced ` +
        `instead of silently repeated ` +
        `(was ${row.progress}%${row.progressNote ? `, "${row.progressNote}"` : ""}).`;
    }

    // ── WRITE, GUARDED ──────────────────────────────────────────────────────────
    // The WHERE re-asserts the exact predicate that selected this row. If the worker
    // heartbeat in the meantime, or wrote a terminal status, count === 0 and we do
    // nothing at all. This is guard #3 against a false positive.
    const guard = {
      id: row.id,
      status: JobStatus.RUNNING,
      ...(legacy ? { lastHeartbeatAt: null } : { lastHeartbeatAt: { lt: cutoff } }),
    };

    const data =
      action === "requeued"
        ? {
            status: JobStatus.PENDING,
            // Wiped so the requeued row reads as what it is — fresh work, not a half-run.
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            progress: 0,
            progressNote: null,
            lastHeartbeatAt: null,
            errorMessage: reason,
            errorStack: null,
            // ★ ATTEMPTS IS GIVEN BACK, AND "not incrementing" WOULD NOT HAVE BEEN ENOUGH.
            //   claimNextJob does `attempts: {increment: 1}` on EVERY claim, so a row that
            //   is requeued gets re-claimed and the counter rises anyway — the interruption
            //   would consume a retry through the back door. Two reclaims of a maxAttempts:2
            //   job would leave it with no retry left for a real failure, which is exactly
            //   the protection ICA's maxAttempts:2 was bought for. Decrementing here undoes
            //   the claim that is about to be lost, so `attempts` ends where it was BEFORE
            //   this run: the retry budget is preserved exactly, and reclaimCount carries
            //   the honest record that an interruption happened.
            //   Safe from underflow: a `running` row was claimed, so attempts >= 1.
            attempts: { decrement: 1 },
            reclaimCount: { increment: 1 },
          }
        : {
            status: JobStatus.ABANDONED,
            finishedAt: now,
            // durationMs stays NULL: we know when it started, not when it stopped working.
            errorMessage: reason,
            reclaimCount: { increment: 1 },
          };

    try {
      const { count } = await prisma.backgroundJob.updateMany({ where: guard, data });
      if (count === 0) {
        report.skippedRaced++;
        console.warn(
          `[reaper] ${row.type} ${row.id} — SKIPPED: it heartbeat or went terminal between the scan ` +
            `and the write. Left alone (this is the guard working, not a fault).`,
        );
        continue;
      }
    } catch (err) {
      console.error(`[reaper] ${row.type} ${row.id} — reclaim write FAILED, row left as-is:`, err);
      continue;
    }

    // ── LOG LOUDLY, ALWAYS ──────────────────────────────────────────────────────
    // console.error, not log: a reclaimed job means a worker died and a pipeline stalled.
    // Every field an operator needs to answer "what died, for how long, and what now" is
    // on one line — the line this replaces was "[worker] recovered N abandoned jobs".
    console.error(
      `[reaper] ${action.toUpperCase()} ${row.type} ${row.id} — stalled ${stalledLabel} ` +
        `(last heartbeat ${row.lastHeartbeatAt?.toISOString() ?? "NEVER — legacy row"}, ` +
        `started ${row.startedAt?.toISOString() ?? "?"}, progress ${row.progress}%` +
        `${row.progressNote ? ` "${row.progressNote}"` : ""}, ` +
        `attempts ${row.attempts}, reclaims ${row.reclaimCount} → ${row.reclaimCount + 1}) ` +
        `[pass=${mode}] :: ${reason}`,
    );

    if (action === "requeued") report.requeued++;
    else report.failed++;
    report.outcomes.push({
      id: row.id, type: row.type, action, reason, stalledMs,
      lastHeartbeatAt: row.lastHeartbeatAt, startedAt: row.startedAt,
      progress: row.progress, progressNote: row.progressNote,
      reclaimCount: row.reclaimCount, legacy,
    });
  }

  if (report.requeued || report.failed) {
    console.error(
      `[reaper] pass=${mode} complete — ${report.scanned} stalled row(s): ` +
        `${report.requeued} requeued, ${report.failed} failed, ${report.skippedRaced} raced (left alone). ` +
        `Any cron blocked by these rows is unblocked as of now.`,
    );
  }
  return report;
}

/** "2d 14h" / "3h 12m" / "47s" — for a log line a human reads at 3am. */
function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
