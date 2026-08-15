// ─────────────────────────────────────────────────────────────
// DAILY OPERATIONS HEALTH CHECK
//
// One pass, once a night, answering five questions from data alone:
//
//   1. WHICH SCHEDULED CRONS DID NOT RUN in their expected window?
//   2. WHAT IS STUCK in `running` beyond the liveness threshold?
//   3. WHICH RETENTION RULES are reporting status=error?
//   4. WHICH JOB TYPES have gone silent (no success while their cron kept firing)?
//   5. WHAT IS THE ABANDONMENT + RECLAIM RATE per type over 7 days?
//
// ── THE INCIDENT THIS IS SHAPED BY ─────────────────────────────────────────────────
// 11 Aug 2026: instrument_corporate_actions stalled in `running` for 2.74 days;
// enqueueIfNotActive skipped the 12 and 13 Aug ticks; mf_analytics folded ETF NAV
// against a stale split table for three nights. Nothing alerted. Worse, the admin
// pipeline card read "succeeded, minutes ago" throughout, because it queries
// `finishedAt IS NOT NULL` (a ghost has none) and because ICA shares its card with
// mf_analytics, which was running fine.
//
// Question 1 is the detector for that, and it is derived — never a list. The expected
// firings come from parsing the SAME cron strings the scheduler registered (lib/cron-expr.ts
// over lib/scheduler.ts's exported registry). A hardcoded cadence table would rot exactly
// the way every comment Part 1 had to correct rotted.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────────────
// It writes nothing but its own job row. No table is created for it: the report IS the
// `result` JSON of the job_health_check BackgroundJob that produced it. That is not
// laziness — background_jobs already carries a retention policy (30 days, terminal rows
// only, pending/running spared), an admin read path, and a history the report needs to sit
// alongside anyway. A separate table would need its own retention rule and would be the
// second place to look for the same night.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { JobStatus, JobTypes, restartPolicyFor, type JobType } from "../types.js";
import { STALE_AFTER_MS, RECLAIM_PREFIX, INTERRUPT_PREFIX } from "../reaper.js";
import { expectedFirings, assertUnambiguousDayFields, assertUtcProcess } from "../../lib/cron-expr.js";
import { scheduledJobRegistry, type ScheduledJob } from "../../lib/scheduler.js";

/** The subset of a registry entry this module reads. */
type ScheduledJobLike = ScheduledJob;

// ── Tuning ───────────────────────────────────────────────────

/** Cron-coverage lookback. One full day, so every daily cron has exactly one chance in it. */
export const DEFAULT_WINDOW_HOURS = 24;
/** Reliability lookback for abandonment/reclaim rates. */
export const DEFAULT_LOOKBACK_DAYS = 7;
/**
 * Grace after an expected firing before it counts as missed. A cron that fires at 19:45
 * creates its row within a second or two, but a check running at exactly 19:45:00 must not
 * report the firing it is racing. 10 minutes is well past any observed enqueue latency
 * (measured: every cron row lands within ~1s of its minute) and well short of a cadence.
 */
export const FIRING_GRACE_MS = 10 * 60_000;

/**
 * ⚠ EXPECTED-FAILURE BASELINE — the anti-alarm-fatigue rule, and it is load-bearing.
 *
 * quarter_brief recorded 5,720 failures against 4,272 successes in 30 days. Measured
 * breakdown: 5,718 `quota_exhausted` + 2 `ungrounded_number`. EVERY ONE IS A DESIGNED
 * OUTCOME — the handler's own header says a refusal is a decision, not a failure, and
 * throws so that the failed-job view is exactly "briefs that did not get written". A naive
 * per-type failure rate would therefore paint this type 57% red forever, and an operator
 * who learns to ignore one red row has learned to ignore the panel.
 *
 * So failures are SPLIT, not suppressed: a failure whose errorMessage begins with one of
 * these prefixes is counted as `expectedFailures` and reported separately from
 * `unexpectedFailures`. Nothing is hidden; only the ALARM is reserved for the second
 * number. Blanket-excluding the type would have hidden a real quarter_brief crash too.
 *
 * Keyed on the prefix before the first ":" because that is the shape the handlers throw
 * (`${reason}: ${detail}`).
 */
export const EXPECTED_FAILURE_REASONS: Partial<Record<JobType, readonly string[]>> = {
  [JobTypes.QUARTER_BRIEF]: ["quota_exhausted", "ungrounded_number", "no_facts", "refused"],
  // A denied quota is the documented skip path for the title job too; it leaves the
  // provisional title in place and costs nothing.
  [JobTypes.CHAT_TITLE_GENERATE]: ["quota_exhausted"],
};

// ── Report shape ─────────────────────────────────────────────
// Shaped for a panel: every section is an array of rows with a stable `severity`, so the
// UI groups by severity without knowing what any section means.

export type Severity = "ok" | "warn" | "critical";

export interface MissedFiring {
  cron: string;
  jobType: string | null;
  schedule: string;
  expectedAt: string;
  severity: Severity;
  /** The row that was blocking the queue at that instant, if one was. THE 11 AUG SIGNAL. */
  blockedBy: { id: string; status: string; startedAt: string | null; stalledMinutes: number | null } | null;
  detail: string;
}

export interface StuckJob {
  id: string;
  type: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  stalledMinutes: number | null;
  progress: number;
  progressNote: string | null;
  reclaimCount: number;
  restartPolicy: "requeue" | "fail";
  severity: Severity;
  detail: string;
}

export interface RetentionRuleError {
  table: string;
  status: string;
  error: string;
  firstSeen: string;
  lastSeen: string;
  consecutiveNights: number;
  severity: Severity;
  detail: string;
}

export interface SilentType {
  jobType: string;
  cron: string;
  schedule: string;
  expectedFirings: number;
  succeeded: number;
  lastSuccessAt: string | null;
  daysSinceSuccess: number | null;
  severity: Severity;
  detail: string;
}

export interface TypeReliability {
  jobType: string;
  total: number;
  succeeded: number;
  expectedFailures: number;
  unexpectedFailures: number;
  abandoned: number;
  cancelled: number;
  reclaimed: number;
  abandonRatePct: number;
  reclaimRatePct: number;
  severity: Severity;
  detail: string;
}

export interface DependencyViolation {
  consumer: string;
  consumerJobId: string;
  consumerRanAt: string;
  dependency: string;
  kind: "producer_still_running" | "producer_stale";
  severity: Severity;
  detail: string;
}

export interface HealthReport {
  generatedAt: string;
  windowFrom: string;
  windowTo: string;
  lookbackDays: number;
  severity: Severity;
  headline: string;
  counts: {
    missedFirings: number;
    stuckJobs: number;
    retentionErrors: number;
    silentTypes: number;
    unreliableTypes: number;
    dependencyViolations: number;
  };
  missedFirings: MissedFiring[];
  dependencyViolations: DependencyViolation[];
  stuckJobs: StuckJob[];
  retentionErrors: RetentionRuleError[];
  silentTypes: SilentType[];
  reliability: TypeReliability[];
  /** Cron entries deliberately not checked, and why. Stated so the report's scope is legible. */
  excludedCrons: { cron: string; reason: string }[];
  /** Anything that stopped this report from being complete. Never silently empty. */
  degradations: string[];
}

const worst = (a: Severity, b: Severity): Severity =>
  a === "critical" || b === "critical" ? "critical" : a === "warn" || b === "warn" ? "warn" : "ok";

export interface HealthCheckOptions {
  now?: Date;
  windowHours?: number;
  lookbackDays?: number;
}

// ─────────────────────────────────────────────────────────────
export async function runHealthCheck(opts: HealthCheckOptions = {}): Promise<HealthReport> {
  const now = opts.now ?? new Date();
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const windowFrom = new Date(now.getTime() - windowHours * 3600_000);
  const lookbackFrom = new Date(now.getTime() - lookbackDays * 86_400_000);

  const degradations: string[] = [];
  const excludedCrons: { cron: string; reason: string }[] = [];

  // The premise of every expected-firing calculation below.
  const tz = assertUtcProcess();
  if (!tz.utc) {
    degradations.push(
      `This report was generated in a process at UTC${tz.offsetMinutes > 0 ? "-" : "+"}${Math.abs(tz.offsetMinutes) / 60}, not UTC. ` +
        `Expected firings are computed in UTC and are correct as computed; the risk is on the other ` +
        `side — node-cron fires in PROCESS-LOCAL time, so if the SCHEDULER also runs at this offset it ` +
        `is firing at different wall-clock instants than the ones checked here, and the missed-firing ` +
        `section would be comparing against the wrong times. Production is measured to run in UTC ` +
        `(every cron row lands on its expression's UTC minute); this line appears when the check is ` +
        `run somewhere else, such as a developer machine.`,
    );
  }

  // ── 1 · CRON COVERAGE ────────────────────────────────────────────────────────────
  const registry = scheduledJobRegistry();
  const missedFirings: MissedFiring[] = [];

  // Pull every cron-triggered row in the window once, rather than a query per entry.
  const windowRows = await prisma.backgroundJob.findMany({
    where: { createdAt: { gte: new Date(windowFrom.getTime() - 3600_000), lte: now }, triggeredBy: { startsWith: "cron:" } },
    select: { id: true, type: true, triggeredBy: true, createdAt: true, status: true },
  });
  const byCron = new Map<string, { createdAt: Date }[]>();
  for (const r of windowRows) {
    const arr = byCron.get(r.triggeredBy) ?? [];
    arr.push({ createdAt: r.createdAt });
    byCron.set(r.triggeredBy, arr);
  }

  // Rows that were pending/running at any point in the window and could therefore have
  // made enqueueIfNotActive skip. THIS IS THE 11 AUGUST LINK: a missed firing is only half
  // the fact; the other half is which ghost was standing in front of it.
  const blockers = await prisma.backgroundJob.findMany({
    where: {
      OR: [
        { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
        { startedAt: { lte: now }, finishedAt: { gte: windowFrom } },
      ],
    },
    select: {
      id: true, type: true, status: true, startedAt: true, finishedAt: true,
      createdAt: true, lastHeartbeatAt: true,
    },
  });

  for (const entry of registry) {
    if (entry.jobType === null) {
      excludedCrons.push({
        cron: entry.name,
        reason:
          "runs INLINE and creates no background_jobs row (jobType: null in the scheduler registry), " +
          "so its firing is not observable from the jobs table. Excluded by declaration, not omission.",
      });
      continue;
    }
    try {
      assertUnambiguousDayFields(entry.schedule, entry.name);
    } catch (e) {
      degradations.push((e as Error).message);
      continue;
    }

    // ⚠ The gate is applied here — for results-scan the cron string is NOT the schedule.
    const expected = expectedFirings(entry.schedule, windowFrom, now, entry.gate);
    const observed = byCron.get(`cron:${entry.name}`) ?? [];

    if (expected.length === 0) continue;

    // ★ SANITY, NOT ASSUMPTION. If an entry has expected firings but this window shows no
    //   rows at all AND none in the whole lookback, we cannot tell "never ran" from
    //   "triggeredBy does not follow cron:<name>". Say so rather than report a false miss.
    if (observed.length === 0) {
      const everSeen = await prisma.backgroundJob.count({
        where: { triggeredBy: `cron:${entry.name}`, createdAt: { gte: lookbackFrom } },
      });
      if (everSeen === 0) {
        const anyEver = await prisma.backgroundJob.count({ where: { triggeredBy: `cron:${entry.name}` } });
        if (anyEver === 0) {
          degradations.push(
            `"${entry.name}" has NEVER produced a row with triggeredBy="cron:${entry.name}". ` +
              `Either it has genuinely never fired, or its enqueue() passes a different triggeredBy ` +
              `than its registry name. Both are worth a look; this report cannot tell them apart.`,
          );
          continue;
        }
      }
    }

    for (const at of expected) {
      // Grace: don't report a firing we are racing.
      if (now.getTime() - at.getTime() < FIRING_GRACE_MS) continue;
      const hit = observed.some((o) => Math.abs(o.createdAt.getTime() - at.getTime()) <= FIRING_GRACE_MS);
      if (hit) continue;

      const blocker = blockers.find(
        (b) =>
          b.type === entry.jobType &&
          (b.createdAt?.getTime() ?? 0) <= at.getTime() &&
          (b.finishedAt === null || b.finishedAt.getTime() >= at.getTime()),
      );
      const stalledMinutes = blocker
        ? Math.round((at.getTime() - (blocker.lastHeartbeatAt ?? blocker.startedAt ?? blocker.createdAt).getTime()) / 60_000)
        : null;

      missedFirings.push({
        cron: entry.name,
        jobType: entry.jobType,
        schedule: entry.schedule,
        expectedAt: at.toISOString(),
        severity: blocker ? "critical" : "warn",
        blockedBy: blocker
          ? {
              id: blocker.id,
              status: blocker.status,
              startedAt: blocker.startedAt?.toISOString() ?? null,
              stalledMinutes,
            }
          : null,
        detail: blocker
          ? `${entry.name} did not enqueue at ${at.toISOString()}. A ${blocker.status} ${blocker.type} row ` +
            `(${blocker.id}) was standing in front of it, so enqueueIfNotActive skipped. ` +
            `That row had been silent ${stalledMinutes}m at the time. THIS IS THE 11 AUGUST SHAPE.`
          : `${entry.name} did not enqueue at ${at.toISOString()} and nothing was blocking it — ` +
            `the scheduler tick itself did not happen (process down, or the cron is not registered).`,
      });
    }
  }

  // ── 2 · STUCK JOBS ───────────────────────────────────────────────────────────────
  const runningRows = await prisma.backgroundJob.findMany({
    where: { status: JobStatus.RUNNING },
    select: {
      id: true, type: true, startedAt: true, lastHeartbeatAt: true,
      progress: true, progressNote: true, reclaimCount: true,
    },
    orderBy: { startedAt: "asc" },
  });
  const stuckJobs: StuckJob[] = [];
  for (const r of runningRows) {
    const lastAlive = r.lastHeartbeatAt ?? r.startedAt;
    const stalledMs = lastAlive ? now.getTime() - lastAlive.getTime() : null;
    const stale = stalledMs !== null && stalledMs > STALE_AFTER_MS;
    // ⚠ A NULL heartbeat is NOT read as stale here, for the same reason the timer reaper
    //   refuses to touch one: it means "claimed before the liveness column existed", and
    //   during the deploy window a live job legitimately has one.
    if (r.lastHeartbeatAt === null) {
      if (stalledMs !== null && stalledMs > STALE_AFTER_MS) {
        stuckJobs.push({
          id: r.id, type: r.type,
          startedAt: r.startedAt?.toISOString() ?? null,
          lastHeartbeatAt: null,
          stalledMinutes: Math.round(stalledMs / 60_000),
          progress: r.progress, progressNote: r.progressNote,
          reclaimCount: r.reclaimCount,
          restartPolicy: restartPolicyFor(r.type),
          severity: "warn",
          detail:
            `${r.type} has been running ${Math.round(stalledMs / 60_000)}m with NO heartbeat column value. ` +
            `This is a pre-migration row: the boot reaper handles it on the old 30-minute startedAt rule. ` +
            `Reported as warn, not critical — a legacy NULL cannot distinguish live from dead.`,
        });
      }
      continue;
    }
    if (!stale) continue;
    stuckJobs.push({
      id: r.id, type: r.type,
      startedAt: r.startedAt?.toISOString() ?? null,
      lastHeartbeatAt: r.lastHeartbeatAt.toISOString(),
      stalledMinutes: Math.round((stalledMs ?? 0) / 60_000),
      progress: r.progress, progressNote: r.progressNote,
      reclaimCount: r.reclaimCount,
      restartPolicy: restartPolicyFor(r.type),
      severity: "critical",
      detail:
        `${r.type} last proved liveness ${Math.round((stalledMs ?? 0) / 60_000)}m ago (threshold ` +
        `${STALE_AFTER_MS / 60_000}m). The reaper should have reclaimed it within ~12m — if this row is ` +
        `still here, the reaper is not running (is the scheduler started? it only starts when ` +
        `NODE_ENV=production) or its reclaim write is failing.`,
    });
  }

  // ── 3 · RETENTION RULES REPORTING error ──────────────────────────────────────────
  // The per-table status lives inside the retention_prune job's own result JSON
  // (retention/engine.ts writes status: "ok" | "skipped_disabled" | "error" per table).
  const retentionErrors: RetentionRuleError[] = [];
  try {
    // ⚠ BOUNDED BY THE REPORT'S OWN CLOCK, NOT BY `now()`. The first draft of this query
    //   used a literal `now() - interval '30 days'`, which meant the retention section
    //   silently ignored the injected `now` and always scanned the last 30 REAL days. Live
    //   that is invisible (the two agree); under historical validation it made this section
    //   answer a different question from every other section in the same report — and the
    //   validation caught it reporting an error that had not started yet in the window
    //   being examined. A report whose sections disagree about what "the window" means is
    //   not a report.
    //
    // 30 days back from the REPORT's instant: a retention rule that has been erroring for
    // three weeks matters more than one that started last night, and the lookbackDays used
    // for reliability (7) is too short to show that.
    // ★ Tagged $queryRaw, so the two Dates are BOUND, not spliced. See the standing note on
    //   $queryRaw vs $queryRawUnsafe — a spliced predicate is how the echo census broke.
    const retFrom = new Date(now.getTime() - 30 * 86_400_000);
    const rows = await prisma.$queryRaw<
      { tbl: string; status: string; err: string; first_seen: Date; last_seen: Date; nights: number }[]
    >`
      SELECT r->>'table'  AS tbl,
             r->>'status' AS status,
             COALESCE(r->>'error','(no message)') AS err,
             MIN(b.created_at) AS first_seen,
             MAX(b.created_at) AS last_seen,
             COUNT(*)::int AS nights
      FROM background_jobs b, jsonb_array_elements(b.result->'results') r
      WHERE b.type = 'retention_prune'
        AND b.status = 'succeeded'
        AND b.created_at > ${retFrom}
        AND b.created_at <= ${now}
        AND r->>'status' = 'error'
      GROUP BY 1, 2, 3
      ORDER BY MIN(b.created_at)
    `;
    for (const r of rows) {
      retentionErrors.push({
        table: r.tbl,
        status: r.status,
        error: r.err.replace(/\s+/g, " ").trim().slice(0, 300),
        firstSeen: new Date(r.first_seen).toISOString(),
        lastSeen: new Date(r.last_seen).toISOString(),
        consecutiveNights: Number(r.nights),
        severity: "critical",
        detail:
          `Retention rule for "${r.tbl}" has reported status=error on ${r.nights} night(s), first ` +
          `${new Date(r.first_seen).toISOString()}, most recently ${new Date(r.last_seen).toISOString()}. ` +
          `That table has NOT been pruned since. The prune job itself SUCCEEDED each night — the failure is ` +
          `per-table and invisible unless the result JSON is opened, which is why it is surfaced here.`,
      });
    }
  } catch (e) {
    degradations.push(`retention-error scan failed: ${(e as Error).message}`);
  }

  // ── 4 & 5 · PER-TYPE RELIABILITY + SILENT TYPES ──────────────────────────────────
  const lookbackRows = await prisma.backgroundJob.findMany({
    where: { createdAt: { gte: lookbackFrom, lte: now } },
    select: { type: true, status: true, errorMessage: true, reclaimCount: true, finishedAt: true },
  });

  const agg = new Map<string, TypeReliability>();
  for (const r of lookbackRows) {
    const a =
      agg.get(r.type) ??
      {
        jobType: r.type, total: 0, succeeded: 0, expectedFailures: 0, unexpectedFailures: 0,
        abandoned: 0, cancelled: 0, reclaimed: 0, abandonRatePct: 0, reclaimRatePct: 0,
        severity: "ok" as Severity, detail: "",
      };
    a.total++;
    if (r.reclaimCount > 0) a.reclaimed++;
    if (r.status === JobStatus.SUCCEEDED) a.succeeded++;
    else if (r.status === JobStatus.ABANDONED) a.abandoned++;
    else if (r.status === JobStatus.CANCELLED) a.cancelled++;
    else if (r.status === JobStatus.FAILED) {
      const reason = (r.errorMessage ?? "").split(":")[0].trim();
      const benign = EXPECTED_FAILURE_REASONS[r.type as JobType] ?? [];
      if (benign.includes(reason)) a.expectedFailures++;
      else a.unexpectedFailures++;
    }
    agg.set(r.type, a);
  }

  const reliability: TypeReliability[] = [];
  for (const a of agg.values()) {
    a.abandonRatePct = a.total ? Math.round((a.abandoned / a.total) * 1000) / 10 : 0;
    a.reclaimRatePct = a.total ? Math.round((a.reclaimed / a.total) * 1000) / 10 : 0;
    const failRate = a.total ? a.unexpectedFailures / a.total : 0;
    a.severity =
      a.abandonRatePct >= 20 || failRate >= 0.5 ? "critical" : a.abandonRatePct >= 5 || failRate >= 0.1 ? "warn" : "ok";
    a.detail =
      `${a.total} run(s) over ${lookbackDays}d — ${a.succeeded} ok, ${a.abandoned} abandoned ` +
      `(${a.abandonRatePct}%), ${a.reclaimed} reclaimed (${a.reclaimRatePct}%), ` +
      `${a.unexpectedFailures} unexpected failure(s)` +
      (a.expectedFailures
        ? ` + ${a.expectedFailures} DESIGNED refusal(s) excluded from the alarm ` +
          `(${(EXPECTED_FAILURE_REASONS[a.jobType as JobType] ?? []).join("/")})`
        : "");
    reliability.push(a);
  }
  reliability.sort((x, y) => y.abandonRatePct - x.abandonRatePct || y.total - x.total);

  // Silent types: a cron-driven type whose cron fired in the lookback but which produced
  // no success. The expectation is DERIVED from the expression, so a monthly job is not
  // "silent" after seven days — it simply had no expected firing.
  const silentTypes: SilentType[] = [];
  for (const entry of registry) {
    if (entry.jobType === null) continue;
    const fired = expectedFirings(entry.schedule, lookbackFrom, now, entry.gate).length;
    if (fired === 0) continue;
    const a = agg.get(entry.jobType);
    const succeeded = a?.succeeded ?? 0;
    if (succeeded > 0) continue;
    const last = await prisma.backgroundJob.findFirst({
      where: { type: entry.jobType, status: JobStatus.SUCCEEDED },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    const days = last?.finishedAt ? Math.floor((now.getTime() - last.finishedAt.getTime()) / 86_400_000) : null;
    silentTypes.push({
      jobType: entry.jobType,
      cron: entry.name,
      schedule: entry.schedule,
      expectedFirings: fired,
      succeeded: 0,
      lastSuccessAt: last?.finishedAt?.toISOString() ?? null,
      daysSinceSuccess: days,
      severity: "critical",
      detail:
        `${entry.jobType} had ${fired} expected firing(s) in the last ${lookbackDays}d and NOT ONE succeeded. ` +
        (last?.finishedAt
          ? `Last success was ${days}d ago (${last.finishedAt.toISOString()}).`
          : `It has never succeeded.`),
    });
  }

  // ── 1b · DEPENDENCY VIOLATIONS ───────────────────────────────────────────────────
  //
  // ★ THIS IS THE SECTION THAT NAMES THE HARM. A missed ICA firing is the CAUSE; the harm
  //   was three nights of mf_analytics folding against a split table nobody had refreshed.
  //   An operator reading "daily-etf-corporate-actions did not enqueue" only connects the
  //   two if they already know the ordering — so the ordering is declared (ScheduledJob
  //   .dependsOn, lifted from the load-bearing comments already on those entries) and the
  //   consequence is stated outright.
  //
  // Two distinct failures, and BOTH occurred:
  //   · producer_stale         — the producer missed a firing, so the consumer read data
  //                              that had not been refreshed. (12 + 13 Aug)
  //   · producer_still_running — the consumer STARTED while the producer was mid-write, so
  //                              it read a half-built table. Measured 4× for exactly the
  //                              ICA × mf_analytics pair, which is only possible because
  //                              two API instances reach this database (see the report).
  const dependencyViolations: DependencyViolation[] = [];
  const byType = new Map<string, ScheduledJobLike>();
  for (const e of registry) if (e.jobType) byType.set(e.jobType, e);

  for (const entry of registry) {
    if (!entry.jobType || !entry.dependsOn?.length) continue;
    const runs = await prisma.backgroundJob.findMany({
      where: { type: entry.jobType, startedAt: { gte: windowFrom, lte: now } },
      select: { id: true, startedAt: true, finishedAt: true },
      orderBy: { startedAt: "asc" },
    });
    for (const run of runs) {
      const ranAt = run.startedAt;
      if (!ranAt) continue;
      for (const dep of entry.dependsOn) {
        // (a) Was the producer still executing when the consumer started?
        const overlapping = await prisma.backgroundJob.findFirst({
          where: {
            type: dep,
            startedAt: { lte: ranAt },
            OR: [{ finishedAt: null }, { finishedAt: { gt: ranAt } }],
            status: { in: [JobStatus.RUNNING, JobStatus.SUCCEEDED, JobStatus.FAILED] },
          },
          select: { id: true, status: true, startedAt: true, finishedAt: true },
          orderBy: { startedAt: "desc" },
        });
        if (overlapping) {
          dependencyViolations.push({
            consumer: entry.jobType,
            consumerJobId: run.id,
            consumerRanAt: ranAt.toISOString(),
            dependency: dep,
            kind: "producer_still_running",
            severity: "critical",
            detail:
              `${entry.jobType} started at ${ranAt.toISOString()} while ${dep} (${overlapping.id}) was ` +
              `still executing — it read a half-written input. The two are ordered on purpose ` +
              `(see the scheduler entry); they are only able to overlap because more than one worker ` +
              `is draining this queue.`,
          });
          continue;
        }
        // (b) Had the producer gone stale — i.e. missed at least one expected firing since
        //     its own last success — by the time the consumer ran?
        const depEntry = byType.get(dep);
        if (!depEntry) continue;
        const lastOk = await prisma.backgroundJob.findFirst({
          where: { type: dep, status: JobStatus.SUCCEEDED, finishedAt: { lt: ranAt } },
          orderBy: { finishedAt: "desc" },
          select: { id: true, finishedAt: true },
        });
        const since = lastOk?.finishedAt ?? windowFrom;
        const missedSince = expectedFirings(
          depEntry.schedule,
          new Date(since.getTime() + 60_000),
          ranAt,
          depEntry.gate,
        );
        if (missedSince.length > 0) {
          dependencyViolations.push({
            consumer: entry.jobType,
            consumerJobId: run.id,
            consumerRanAt: ranAt.toISOString(),
            dependency: dep,
            kind: "producer_stale",
            severity: "critical",
            detail:
              `${entry.jobType} ran at ${ranAt.toISOString()} against ${dep} output last refreshed ` +
              `${lastOk?.finishedAt ? lastOk.finishedAt.toISOString() : "never in this window"}. ` +
              `${dep} was due ${missedSince.length} time(s) in between and succeeded none of them, so this ` +
              `run folded STALE input and its numbers look fine while being wrong.`,
          });
        }
      }
    }
  }

  // ── ROLL-UP ──────────────────────────────────────────────────────────────────────
  let severity: Severity = "ok";
  for (const d of dependencyViolations) severity = worst(severity, d.severity);
  for (const m of missedFirings) severity = worst(severity, m.severity);
  for (const s of stuckJobs) severity = worst(severity, s.severity);
  for (const r of retentionErrors) severity = worst(severity, r.severity);
  for (const s of silentTypes) severity = worst(severity, s.severity);
  for (const r of reliability) severity = worst(severity, r.severity);
  if (degradations.length) severity = worst(severity, "warn");

  const unreliableTypes = reliability.filter((r) => r.severity !== "ok").length;
  const headline =
    severity === "ok"
      ? `All clear — ${registry.length - excludedCrons.length} cron(s) checked, nothing stuck, no retention errors.`
      : `${missedFirings.length} missed cron firing(s), ${dependencyViolations.length} stale-input run(s), ` +
        `${stuckJobs.length} stuck job(s), ${retentionErrors.length} retention rule(s) erroring, ` +
        `${silentTypes.length} silent type(s), ${unreliableTypes} type(s) over the reliability threshold.`;

  return {
    generatedAt: now.toISOString(),
    windowFrom: windowFrom.toISOString(),
    windowTo: now.toISOString(),
    lookbackDays,
    severity,
    headline,
    counts: {
      missedFirings: missedFirings.length,
      stuckJobs: stuckJobs.length,
      retentionErrors: retentionErrors.length,
      silentTypes: silentTypes.length,
      unreliableTypes,
      dependencyViolations: dependencyViolations.length,
    },
    missedFirings,
    dependencyViolations,
    stuckJobs,
    retentionErrors,
    silentTypes,
    reliability,
    excludedCrons,
    degradations,
  };
}

/**
 * The loud half of 3b. Every finding gets its own line at console.error — a health report
 * nobody reads is the same as no health report, and the line this replaces
 * ("[worker] recovered N abandoned jobs") is the reason that lesson is in this codebase.
 */
export function logHealthReport(r: HealthReport): void {
  const tag = `[health]`;
  if (r.severity === "ok") {
    console.log(`${tag} OK — ${r.headline}`);
  } else {
    console.error(`${tag} ${r.severity.toUpperCase()} — ${r.headline}`);
  }
  for (const m of r.missedFirings) console.error(`${tag} MISSED-FIRING ${m.cron} :: ${m.detail}`);
  for (const d of r.dependencyViolations) console.error(`${tag} STALE-INPUT ${d.consumer}<-${d.dependency} :: ${d.detail}`);
  for (const s of r.stuckJobs) console.error(`${tag} STUCK ${s.type} ${s.id} :: ${s.detail}`);
  for (const x of r.retentionErrors) console.error(`${tag} RETENTION-ERROR ${x.table} :: ${x.detail}`);
  for (const s of r.silentTypes) console.error(`${tag} SILENT ${s.jobType} :: ${s.detail}`);
  for (const t of r.reliability.filter((t) => t.severity !== "ok")) {
    console.error(`${tag} UNRELIABLE ${t.jobType} :: ${t.detail}`);
  }
  for (const d of r.degradations) console.error(`${tag} DEGRADED :: ${d}`);
}

/** Re-exported so the API layer can label a row without importing the reaper. */
export const RECLAIM_MARKERS = { RECLAIM_PREFIX, INTERRUPT_PREFIX };
