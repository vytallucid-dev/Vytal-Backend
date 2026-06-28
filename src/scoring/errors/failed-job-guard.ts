// ─────────────────────────────────────────────────────────────
// FAILED-SCORING-JOB GUARD — Stage 1 of scoring-error detection.
//
// Surfaces GENUINE terminal failures of the 3 SCORING BackgroundJob types
// (pg_rescore, pg_cascade_rescore, fill_cascade_rescore) into the shared
// IngestionError table (source="scoring") via reportScoringError, so a broken or
// stale Health Score becomes visible in the existing triage UI.
//
// The failure is ALREADY fully recorded on the BackgroundJob (status=failed/
// abandoned + errorMessage + attempts); this guard merely surfaces it. CN-8 clean:
// it READS job + score state and WRITES only error rows — it changes NO scoring
// logic, bars, or weights.
//
// ── WHAT COUNTS AS A GENUINE, ACTIONABLE FAILURE (terminal-vs-transient rule) ──
//   1. TERMINAL  — status ∈ {failed, abandoned}. The worker sets a RETRYABLE
//      failure back to "pending" (NOT "failed"), so a row actually in failed/
//      abandoned has exhausted its retries or hit a non-retryable terminal error.
//      A fail-then-retry-succeeded sequence never leaves a failed row (the SAME
//      row ends "succeeded"). ⇒ no `attempts` arithmetic is needed.
//   2. STILL LIVE — no LATER succeeded scoring job for the SAME entity. A week-old
//      failure for a PG that has since been rescored is STALE, not a live problem
//      (the real noise source per Stage-1 grounding: 11/12 historical failures were
//      healed). The real-time hook fires on a just-failed job (no later success can
//      exist yet → trivially live); the periodic sweep applies this filter.
//   3. REAL ENTITY — the pgId is one of the 13 scored PGs (drops test artifacts such
//      as the "PGX"/NONEXISTENT-PG safety job), or the symbol resolves to a Stock.
//      A failure for a non-existent entity protects no real score → not actionable.
//
// Two hook points, both routing through reportScoringError (dedup coalesces them
// into one row): (a) the worker's terminal-failure branch (real-time), and (b) the
// periodic sweep (catch-up + re-affirm occurrences).
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { JobStatus, JobTypes } from "../../jobs/types.js";
import { reportScoringError, scoringEntityKey } from "../../ingestions/shared/ingestion-error.js";
import { scoredPgById } from "../composite/pg-registry.js";

/** The 3 job types that compute scores (PRICES_REFETCH is ingestion, NOT scoring). */
export const SCORING_JOB_TYPES: readonly string[] = [
  JobTypes.PG_RESCORE,
  JobTypes.PG_CASCADE_RESCORE,
  JobTypes.FILL_CASCADE_RESCORE,
];

/** Terminal failure statuses the worker writes (retryable failures go to "pending"). */
const TERMINAL_FAILED: readonly string[] = [JobStatus.FAILED, JobStatus.ABANDONED];

/** A failed scoring job = a stock/PG whose score may be stale or missing ⇒ HIGH. */
const FAILED_JOB_SEVERITY = "high" as const;

export interface FailedScoringJob {
  id: string;
  type: string;
  status: string;
  payload: unknown;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  triggeredBy: string;
  createdAt: Date;
}

interface ScoringEntity {
  pgId: string | null;
  symbol: string | null;
  periodKey: string | null;
}

/** Pull the (pgId | symbol, period) the failed job targeted, from its payload. */
function extractEntity(type: string, payload: unknown): ScoringEntity {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

  if (type === JobTypes.PG_RESCORE) {
    return { pgId: str(p.pgId), symbol: null, periodKey: null }; // live, current period
  }
  if (type === JobTypes.PG_CASCADE_RESCORE) {
    return { pgId: str(p.pgId), symbol: str(p.symbol), periodKey: str(p.editedPeriod) };
  }
  if (type === JobTypes.FILL_CASCADE_RESCORE) {
    return { pgId: null, symbol: str(p.symbol), periodKey: str(p.editPeriodKey) ?? str(p.editReportDateIso) };
  }
  return { pgId: null, symbol: null, periodKey: null };
}

/** Human label for the entity in the error text. */
function entityLabel(e: ScoringEntity): string {
  const base = e.pgId ?? e.symbol ?? "(unknown entity)";
  return e.periodKey ? `${base} @ ${e.periodKey}` : base;
}

/**
 * REAL-ENTITY check: does this failure threaten a REAL score?
 *   • pgId  → must be one of the 13 scored PGs (drops "PGX" test artifacts).
 *   • symbol→ must resolve to a Stock (cascades). `knownSymbols`, when provided
 *             (the batch sweep), avoids a per-job query; else we look it up.
 */
async function isRealEntity(e: ScoringEntity, knownSymbols?: Set<string>): Promise<boolean> {
  if (e.pgId) return scoredPgById(e.pgId) !== undefined;
  if (e.symbol) {
    if (knownSymbols) return knownSymbols.has(e.symbol);
    const stock = await prisma.stock.findUnique({ where: { symbol: e.symbol }, select: { id: true } });
    return stock !== null;
  }
  return false; // no entity to act on
}

/** Build the reportScoringError input for a terminal-failed scoring job. */
function buildReport(job: FailedScoringJob, e: ScoringEntity) {
  const label = entityLabel(e);
  return {
    failureType: "job_failed" as const,
    cron: `scoring:${job.type}`,
    pgId: e.pgId,
    symbol: e.symbol,
    periodKey: e.periodKey,
    targetField: null,
    severity: FAILED_JOB_SEVERITY,
    recomputeAction: "rescore",
    resolutionPath: "rescore" as const,
    expected: `${label} rescores successfully`,
    observed: `${job.type} job ${job.id.slice(0, 8)} ${job.status}: ${job.errorMessage ?? "(no error message)"}`,
    detail:
      `Terminal ${job.status} after ${job.attempts}/${job.maxAttempts} attempt(s) ` +
      `(triggeredBy=${job.triggeredBy}). The Health Score for ${label} may be stale or ` +
      `missing until a successful rescore.`,
    triggeringJobId: job.id,
  };
}

/**
 * REAL-TIME hook (worker terminal-failure branch). Surface ONE just-failed scoring
 * job. Best-effort — never throws (a detection write must never break the worker).
 * Liveness is trivially satisfied (a job that failed *now* has no later success),
 * so only the type, terminal-status and real-entity gates apply. Returns the
 * IngestionError id, or null if not surfaced / on any error.
 */
export async function surfaceFailedScoringJob(job: FailedScoringJob): Promise<string | null> {
  try {
    if (!SCORING_JOB_TYPES.includes(job.type)) return null; // not a scoring job
    if (!TERMINAL_FAILED.includes(job.status)) return null; // not terminal
    const e = extractEntity(job.type, job.payload);
    if (!(await isRealEntity(e))) {
      console.log(`[failed-job-guard] skip non-real entity for job ${job.id.slice(0, 8)} (${job.type})`);
      return null;
    }
    return await reportScoringError(buildReport(job, e));
  } catch (err) {
    console.error(`[failed-job-guard] surfaceFailedScoringJob error for job ${job.id}:`, err);
    return null;
  }
}

/**
 * AUTO-RESOLVE-ON-HEAL (Stage 2 lifecycle completion). When a scoring job SUCCEEDS,
 * close any OPEN scoring_job_failed row for the SAME entity+period — whether the
 * rescore came from the resolution-UI "Re-score" button OR organically (a later
 * scheduled/triggered rescore that succeeded). Together with the Stage-1 sweep's
 * liveness filter (don't surface healed failures), this guarantees no stale open
 * scoring_job_failed row lingers once its entity recovers.
 *
 * PERIOD-PRECISE: matches on `targetEntity`, computed by the SAME scoringEntityKey
 * the surfacing path used — so a success for SYM@FY26Q2 resolves the FY26Q2 row and
 * NOT a FY26Q1 row, and a live pg_rescore (no period) resolves the live "PG5" row.
 * IDEMPOTENT: a success with no matching open row is a no-op (count 0). Best-effort —
 * never throws (must not break job completion). Returns the number of rows resolved.
 */
export async function resolveHealedScoringErrors(
  jobType: string,
  payload: unknown,
  succeededJobId: string,
): Promise<number> {
  try {
    if (!SCORING_JOB_TYPES.includes(jobType)) return 0;
    const e = extractEntity(jobType, payload);
    const key = scoringEntityKey(e.pgId, e.symbol, e.periodKey);
    if (!key) return 0;
    const { count } = await prisma.ingestionError.updateMany({
      where: {
        source: "scoring",
        guardType: "scoring_job_failed",
        status: "open",
        targetEntity: key,
      },
      data: {
        status: "resolved",
        resolvedBy: "auto:rescore-heal",
        resolvedAt: new Date(),
        resolutionNote: `healed by successful ${jobType} job ${succeededJobId}`,
      },
    });
    if (count > 0) {
      console.log(`[failed-job-guard] auto-resolved ${count} scoring error(s) for "${key}" (healed by job ${succeededJobId.slice(0, 8)})`);
    }
    return count;
  } catch (err) {
    console.error("[failed-job-guard] resolveHealedScoringErrors error:", err);
    return 0;
  }
}

/**
 * REAL-TIME hook convenience: surface a just-terminally-failed job BY ID. Re-reads
 * the freshly-written row (so status/errorMessage/triggeredBy are accurate) and
 * delegates to surfaceFailedScoringJob. Best-effort — never throws. This is what the
 * worker calls from its terminal-failure branches.
 */
export async function surfaceFailedScoringJobById(jobId: string): Promise<string | null> {
  try {
    const job = await prisma.backgroundJob.findUnique({
      where: { id: jobId },
      select: {
        id: true, type: true, status: true, payload: true, errorMessage: true,
        attempts: true, maxAttempts: true, triggeredBy: true, createdAt: true,
      },
    });
    if (!job) return null;
    return await surfaceFailedScoringJob(job as FailedScoringJob);
  } catch (err) {
    console.error(`[failed-job-guard] surfaceFailedScoringJobById error for ${jobId}:`, err);
    return null;
  }
}

export interface SweepResult {
  scanned: number;
  surfaced: number;
  skippedHealed: number;
  skippedNonRealEntity: number;
}

/**
 * PERIODIC catch-up sweep. Reconciles the BackgroundJob table → scoring error rows:
 * for every terminal-failed scoring job that is STILL LIVE (no later success for the
 * same entity) and a REAL entity, ensure an open scoring error exists (dedup bumps
 * occurrences). Catches anything the real-time hook missed (e.g. boot-time ABANDONED
 * jobs) and re-affirms occurrences. Best-effort — never throws.
 */
export async function sweepFailedScoringJobs(): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, surfaced: 0, skippedHealed: 0, skippedNonRealEntity: 0 };
  try {
    const [failed, succeeded] = await Promise.all([
      prisma.backgroundJob.findMany({
        where: { type: { in: SCORING_JOB_TYPES as string[] }, status: { in: TERMINAL_FAILED as string[] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, type: true, status: true, payload: true, errorMessage: true,
          attempts: true, maxAttempts: true, triggeredBy: true, createdAt: true,
        },
      }),
      prisma.backgroundJob.findMany({
        where: { type: { in: SCORING_JOB_TYPES as string[] }, status: JobStatus.SUCCEEDED },
        select: { type: true, payload: true, createdAt: true },
      }),
    ]);
    result.scanned = failed.length;
    if (failed.length === 0) return result;

    // Liveness index: entity-key → newest success time. A failure is HEALED (stale)
    // when a success for the same entity is newer than the failure.
    const latestSuccessByEntity = new Map<string, number>();
    const entityKey = (e: ScoringEntity): string | null => e.pgId ?? e.symbol ?? null;
    for (const s of succeeded) {
      const e = extractEntity(s.type, s.payload);
      const k = entityKey(e);
      if (!k) continue;
      const t = s.createdAt.getTime();
      const prev = latestSuccessByEntity.get(k);
      if (prev === undefined || t > prev) latestSuccessByEntity.set(k, t);
    }

    // Batch-resolve cascade symbols once (real-entity check without N queries).
    const symbols = new Set<string>();
    for (const j of failed) {
      const e = extractEntity(j.type, j.payload);
      if (e.symbol) symbols.add(e.symbol);
    }
    const knownSymbols = new Set<string>();
    if (symbols.size) {
      const stocks = await prisma.stock.findMany({ where: { symbol: { in: [...symbols] } }, select: { symbol: true } });
      for (const s of stocks) knownSymbols.add(s.symbol);
    }

    for (const j of failed) {
      const e = extractEntity(j.type, j.payload);
      const k = entityKey(e);
      // LIVENESS: skip if a later success healed this entity.
      const healedAt = k ? latestSuccessByEntity.get(k) : undefined;
      if (healedAt !== undefined && healedAt > j.createdAt.getTime()) {
        result.skippedHealed++;
        continue;
      }
      // REAL ENTITY: skip test artifacts / non-existent entities.
      if (!(await isRealEntity(e, knownSymbols))) {
        result.skippedNonRealEntity++;
        continue;
      }
      const id = await reportScoringError(buildReport(j as FailedScoringJob, e));
      if (id) result.surfaced++;
    }
    return result;
  } catch (err) {
    console.error("[failed-job-guard] sweepFailedScoringJobs error:", err);
    return result;
  }
}
