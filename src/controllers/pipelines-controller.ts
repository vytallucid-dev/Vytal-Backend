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
import { JobStatus, JobTypes, type JobType } from "../jobs/types.js";
import { STALE_AFTER_MS } from "../jobs/reaper.js";

/** One job type inside a pipeline card. ADDITIVE — the frontend hook does not read it yet. */
interface PipelineMemberStatus {
  type: string;
  lastRunAt: string | null;
  status: string | null;
  triggeredBy: string | null;
  /** Running or pending work for THIS type. Null when idle. */
  inFlight: {
    id: string;
    status: string;
    startedAt: string | null;
    progress: number;
    lastHeartbeatAt: string | null;
    /** null while pending; "alive" | "stale" | "unknown" once running. */
    liveness: "alive" | "stale" | "unknown" | null;
  } | null;
}

interface PipelineStatus {
  key: string;
  /** ISO timestamp of the last run, or null if it has never run. */
  lastRunAt: string | null;
  /** Raw trigger audit ("cron" | "user:…" | "admin_route" | "hook:…" | …) or null. */
  triggeredBy: string | null;
  /**
   * Card status. ⚠ NO LONGER "the newest finished run's status" — it is the WORST member's,
   * and it can now be "stalled" or "running", which the old shape could never say. The
   * frontend renders this string as-is, so the two new values are additive there too.
   */
  status: string | null;
  /** Per job type. Present on job-driven cards; absent on ingestion-errors / casa. */
  perType?: PipelineMemberStatus[];
  inFlightCount?: number;
  stalledCount?: number;
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

/**
 * A pipeline card's status.
 *
 * ★★ THIS FUNCTION CONCEALED THE 11 AUGUST INCIDENT AND IT IS FIXED IN PLACE, NOT
 *    SUPERSEDED. It is fixed rather than replaced because it has a live frontend consumer
 *    (Vytal-Frontend/lib/api/hooks/use-pipeline-status.ts, rendered by the admin cards),
 *    and the four fields that hook reads — key, lastRunAt, triggeredBy, status — keep
 *    exactly their old meaning. Everything new is ADDITIVE, so the panel keeps working
 *    untouched and can adopt the new fields when it is built. Retiring the path would have
 *    meant shipping a broken admin page.
 *
 * ── DEFECT 1: A STUCK JOB WAS INVISIBLE BY CONSTRUCTION ──────────────────────────────
 * The query was `where: { finishedAt: { not: null } }`. A job stuck in `running` has no
 * finishedAt, so the ONE state that needed showing was the one state the query could not
 * return. On 12 and 13 August this card read "succeeded, minutes ago" while the pipeline
 * was dead. `inFlight` below is the fix: running/pending work is now first-class, and it
 * carries its own liveness.
 *
 * ── DEFECT 2: ONE CARD REPORTED ANOTHER TYPE'S HEALTH AS ITS OWN ─────────────────────
 * The `mf` card covers four job types and returned the newest finished run AMONG them.
 * instrument_corporate_actions was dead; mf_analytics_daily was fine and three minutes
 * old; the card showed mf_analytics's success. `perType` below breaks every card out, and
 * the card-level `status` is now the WORST member rather than the newest — so one healthy
 * member can no longer vouch for a dead one.
 */
async function latestJobRun(key: string, types: JobType[]): Promise<PipelineStatus> {
  const now = Date.now();

  // Per type, independently. No aggregate can hide a member any more.
  const perType: PipelineMemberStatus[] = await Promise.all(
    types.map(async (type) => {
      const [finished, active] = await Promise.all([
        prisma.backgroundJob.findFirst({
          where: { type, finishedAt: { not: null } },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true, status: true, triggeredBy: true },
        }),
        prisma.backgroundJob.findFirst({
          where: { type, status: { in: [JobStatus.RUNNING, JobStatus.PENDING] } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, status: true, startedAt: true, createdAt: true,
            progress: true, lastHeartbeatAt: true,
          },
        }),
      ]);

      const hbAge = active?.lastHeartbeatAt ? now - active.lastHeartbeatAt.getTime() : null;
      const liveness: "alive" | "stale" | "unknown" | null =
        !active || active.status === JobStatus.PENDING
          ? null
          : hbAge === null
            ? "unknown"
            : hbAge > STALE_AFTER_MS
              ? "stale"
              : "alive";

      return {
        type,
        lastRunAt: finished?.finishedAt ? finished.finishedAt.toISOString() : null,
        status: finished?.status ?? null,
        triggeredBy: finished?.triggeredBy ?? null,
        inFlight: active
          ? {
              id: active.id,
              status: active.status,
              startedAt: active.startedAt?.toISOString() ?? null,
              progress: active.progress,
              lastHeartbeatAt: active.lastHeartbeatAt?.toISOString() ?? null,
              liveness,
            }
          : null,
      };
    }),
  );

  // The card's own headline stays backward-compatible: newest finished run across members.
  const newest = perType
    .filter((m) => m.lastRunAt)
    .sort((a, b) => (a.lastRunAt! < b.lastRunAt! ? 1 : -1))[0];

  // …but the STATUS is now the worst member, not the newest. A stuck member outranks a
  // succeeded one; a failed/abandoned member outranks a success.
  const stuck = perType.find((m) => m.inFlight?.liveness === "stale");
  const failedMember = perType.find(
    (m) => m.status === JobStatus.FAILED || m.status === JobStatus.ABANDONED,
  );
  const runningMember = perType.find((m) => m.inFlight);

  const status = stuck
    ? "stalled"
    : failedMember
      ? (failedMember.status as string)
      : runningMember
        ? "running"
        : (newest?.status ?? null);

  return {
    key,
    lastRunAt: newest?.lastRunAt ?? null,
    triggeredBy: newest?.triggeredBy ?? null,
    status,
    perType,
    inFlightCount: perType.filter((m) => m.inFlight).length,
    stalledCount: perType.filter((m) => m.inFlight?.liveness === "stale").length,
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
