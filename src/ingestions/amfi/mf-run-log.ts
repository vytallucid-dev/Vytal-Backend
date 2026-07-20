// ─────────────────────────────────────────────────────────────
// THE MF PIPELINE'S RUN-LOG (RULING ①a).
//
// Mirrors the house pattern (price_fetch_logs / index_fetch_logs): upsert on (date, job) so a
// same-day re-run UPDATES its row instead of piling up, `success | partial | failed` as the
// status vocabulary, counters + durationMs + error.
//
// WHY THIS EXISTS AT ALL: Step 9's amfi_nav_daily shipped as a mystery cron — no run-log, no
// admin route, no manual trigger, and absent from the admin panel's PIPELINE_JOB_TYPES. It ran
// nightly and nobody could see that it had. Every other pipeline in this codebase is
// observable; now this one is too.
//
// BEST-EFFORT: writing the log must never break the job it is logging. A failure here is
// swallowed and printed, exactly as reportIngestionError does.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";

export const MF_JOBS = {
  NAV_DAILY: "amfi_nav_daily",
  /** Step 13 — the ETF pass over the same AMFI file. Its own log row, so an NSE ticker-join
   *  fault shows up as an ETF problem rather than smearing the MF run's status. */
  ETF_NAV_DAILY: "etf_nav_daily",
  ANALYTICS_DAILY: "mf_analytics_daily",
  // (INCEPTION_WALK removed — the job no longer exists. Its historical run-log ROWS are left in the
  // table untouched: they are a record of what actually ran, and deleting history to tidy up a
  // constant would be rewriting the past. `job` is a plain TEXT column, so old rows still read.)
} as const;

export type MfJob = (typeof MF_JOBS)[keyof typeof MF_JOBS];
export type MfRunStatus = "success" | "partial" | "failed";

export interface MfRunLogInput {
  job: MfJob;
  status: MfRunStatus;
  schemesProcessed?: number;
  rowsFolded?: number;
  analyticsWritten?: number;
  faults?: number;
  windowFrom?: Date | null;
  windowTo?: Date | null;
  pulls?: number;
  durationMs?: number | null;
  error?: string | null;
  /** Defaults to today (UTC). Overridable so a replay can log against the day it replays. */
  runDate?: Date;
}

export async function writeMfRunLog(input: MfRunLogInput): Promise<void> {
  const runDate = input.runDate ?? new Date(new Date().toISOString().slice(0, 10));

  const data = {
    source: "amfi",
    status: input.status,
    schemesProcessed: input.schemesProcessed ?? 0,
    rowsFolded: input.rowsFolded ?? 0,
    analyticsWritten: input.analyticsWritten ?? 0,
    faults: input.faults ?? 0,
    windowFrom: input.windowFrom ?? null,
    windowTo: input.windowTo ?? null,
    pulls: input.pulls ?? 0,
    durationMs: input.durationMs ?? null,
    error: input.error ?? null,
  };

  try {
    await prisma.mfFetchLog.upsert({
      where: { runDate_job: { runDate, job: input.job } },
      create: { runDate, job: input.job, ...data },
      update: data,
    });
  } catch (err) {
    console.error(`[writeMfRunLog] failed to record ${input.job}/${input.status}:`, err);
  }
}
