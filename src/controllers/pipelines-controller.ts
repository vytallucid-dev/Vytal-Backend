// ─────────────────────────────────────────────────────────────
// PIPELINES STATUS — admin dashboard "last run" summary.
//
// GET /api/v1/admin/pipelines — for each data-source pipeline shown on the
// Admin Panel, returns WHEN it last actually ran (manual or cron) and by whom.
// The Admin Panel renders this as a relative "last run: 12m ago" per card.
//
// Source of truth per pipeline:
//   • job-driven pipelines → the newest FINISHED background_jobs row among that
//     pipeline's job types (its finishedAt is the true "last completed run").
//   • ingestion-errors     → the newest IngestionError.lastSeenAt (last detection).
//   • casa                 → the newest BankSupplementary CASA row (manual inject).
//
// Keys match the Admin Panel card route slugs (/admin/<key>). Mounted behind
// requireAdmin, so only admins can read the operational cadence.
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { JobTypes, type JobType } from "../jobs/types.js";

interface PipelineStatus {
  key: string;
  /** ISO timestamp of the last run, or null if it has never run. */
  lastRunAt: string | null;
  /** Raw trigger audit ("cron" | "user:…" | "admin_route" | "hook:…" | …) or null. */
  triggeredBy: string | null;
  /** Job status of that last run ("succeeded" | "failed" | …); null for non-job sources. */
  status: string | null;
}

// pipeline key (= /admin/<key> route slug) → the background_job types whose newest
// finished run represents "this pipeline last ran".
const PIPELINE_JOB_TYPES: Record<string, JobType[]> = {
  "stock-prices": [JobTypes.EOD_PRICES_DAILY, JobTypes.PRICE_BACKFILL, JobTypes.PRICES_REFETCH],
  "index-prices": [JobTypes.INDEX_PRICES_DAILY, JobTypes.INDEX_PRICES_BACKFILL],
  "quarterly-results": [JobTypes.RESULTS_SCAN, JobTypes.LEGACY_BACKFILL],
  "corporate-events": [
    JobTypes.EVENTS_DAILY_REFRESH,
    JobTypes.EVENTS_WEEKLY_INGEST,
    JobTypes.EVENTS_BACKFILL,
  ],
  "insider-trades": [JobTypes.INSIDER_TRADES_DAILY, JobTypes.INSIDER_TRADES_BACKFILL],
  "block-deals": [JobTypes.DEALS_DAILY_INGEST, JobTypes.DEALS_BACKFILL],
  "news-announcements": [
    JobTypes.DAILY_NEWS_INGEST,
    JobTypes.NSE_ANNOUNCEMENTS_INGEST,
    JobTypes.GOOGLE_NEWS_INGEST,
    JobTypes.NEWS_CONTENT_EXTRACTION,
    JobTypes.NEWS_BACKFILL,
  ],
  // The MF pipeline (Steps 9 + 10/11). Step 9's amfi_nav_daily was a MYSTERY CRON — it ran
  // nightly and appeared on no admin card, with no run-log and no manual trigger. It is a
  // first-class pipeline now, alongside the analytics fold and the one-time inception walk.
  // Step 13 adds ETF_NAV_DAILY here rather than opening a separate "etfs" card: an ETF is an
  // AMFI-registered fund whose analytics come out of the SAME fold, so it is one pipeline with
  // two identity feeds, not two pipelines. A mystery cron is exactly what Step 10 fixed — the
  // ETF pass is not allowed to become one.
  //
  // Step 14.5 adds ETF_PRICES_DAILY here too: it prices the SAME instrument the NAV lane owns,
  // just from the exchange rather than from AMFI. One instrument, one card — two numbers on it
  // (what a unit is worth, and what it trades at).
  //
  // INSTRUMENT_CORPORATE_ACTIONS belongs here and had been LEFT OFF. It is the job that reads NSE's
  // real unit splits so the fold can rescale an ETF's NAV series before folding it — i.e. it decides
  // whether this card's numbers are right. Shipping it cron-only made it precisely the "mystery cron"
  // Step 10 went back and eliminated for amfi_nav_daily: a job an operator cannot see is a job they
  // cannot debug, and this one runs 15 minutes before the fold that depends on it.
  //
  // (MF_INCEPTION_WALK is gone from this card and from the codebase — see the drop migration.)
  "mutual-funds": [
    JobTypes.AMFI_NAV_DAILY,
    JobTypes.ETF_NAV_DAILY,
    JobTypes.ETF_PRICES_DAILY,
    JobTypes.INSTRUMENT_CORPORATE_ACTIONS,
    JobTypes.MF_ANALYTICS_DAILY,
  ],
  // REITs/InvITs get their OWN card, not a seat on the mutual-funds one: they share no source
  // with it (NSE BhavCopy, not AMFI), no cadence (a trading day, not a NAV publish) and no fold.
  // Listed here so REIT_DAILY can never become the "mystery cron" that Step 10 had to go back
  // and fix — every pipeline in this codebase is visible, and this one is too, from day one.
  reits: [JobTypes.REIT_DAILY],
  // Government paper (Step 15) gets its own card: a different issuer, a different instrument and a
  // different universe from anything else in this list. Visible from day one — no mystery crons.
  "govt-securities": [JobTypes.GOVT_SECURITIES_DAILY],
  // Corporate debt (Step 17) gets its own card for the same reason government paper does — and one
  // more: it is the lane whose universe is still GROWING. The BhavCopy shows only what traded, so
  // the catalogue accumulates nightly toward a traded universe whose true size nobody knows. An
  // operator needs to be able to watch that, which means it cannot be a mystery cron either.
  "corporate-bonds": [JobTypes.CORPORATE_BONDS_DAILY],
  "peer-group-metrics": [JobTypes.PEER_METRICS_COMPUTE_ALL],
  "shareholding-patterns": [
    JobTypes.SHAREHOLDING_QUARTERLY,
    JobTypes.SHAREHOLDING_SMART_REFRESH,
    JobTypes.SHAREHOLDING_BACKFILL,
  ],
};

/** Newest FINISHED job among the given types — the pipeline's true last run. */
async function latestJobRun(key: string, types: JobType[]): Promise<PipelineStatus> {
  const job = await prisma.backgroundJob.findFirst({
    where: { type: { in: types }, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, status: true, triggeredBy: true },
  });
  return {
    key,
    lastRunAt: job?.finishedAt ? job.finishedAt.toISOString() : null,
    triggeredBy: job?.triggeredBy ?? null,
    status: job?.status ?? null,
  };
}

/** ingestion-errors — last time the detection layer flagged something. */
async function ingestionErrorsRun(): Promise<PipelineStatus> {
  const row = await prisma.ingestionError.findFirst({
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true },
  });
  return {
    key: "ingestion-errors",
    lastRunAt: row?.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    triggeredBy: "detection",
    status: null,
  };
}

/** casa — last manual CASA injection (BankSupplementary casa_pct row). */
async function casaRun(): Promise<PipelineStatus> {
  const row = await prisma.bankSupplementary.findFirst({
    where: { metric: "casa_pct" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, enteredBy: true },
  });
  return {
    key: "casa",
    lastRunAt: row?.createdAt ? row.createdAt.toISOString() : null,
    triggeredBy: row?.enteredBy ?? null,
    status: null,
  };
}

export const getPipelineStatus = async (_req: Request, res: Response) => {
  try {
    const jobEntries = Object.entries(PIPELINE_JOB_TYPES);
    const [jobResults, ingestionErrors, casa] = await Promise.all([
      Promise.all(jobEntries.map(([key, types]) => latestJobRun(key, types))),
      ingestionErrorsRun(),
      casaRun(),
    ]);

    const data: PipelineStatus[] = [ingestionErrors, casa, ...jobResults];
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[admin/pipelines] status error:", err);
    return res.status(500).json({
      success: false,
      error: "server_error",
      message: "Failed to read pipeline status",
    });
  }
};
