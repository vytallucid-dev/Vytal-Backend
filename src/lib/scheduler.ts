// src/lib/scheduler.ts
// ─────────────────────────────────────────────────────────────
// Cron-based scheduler. All recurring jobs run through the job
// worker queue — no ingestion function is called directly.
// Each cron tick: dedup check → enqueueJob → worker picks it up.
//
// Benefits:
//   - Every run is tracked in BackgroundJob (status, progress, result)
//   - A restart mid-job marks it ABANDONED, not silently lost
//   - Two server instances or a restart can't double-run the same job
//   - All jobs are cancellable from the admin API
// ─────────────────────────────────────────────────────────────

import cron from "node-cron";
import { enqueueJob, listJobs } from "../jobs/enqueue.js";
import { JobStatus, JobTypes, type JobType } from "../jobs/types.js";

// ── Results-season gate ───────────────────────────────────────
// Returns true during the four earnings windows (generous to catch late filers):
//   Q1: Jul 15 – Aug 25
//   Q2: Oct 15 – Nov 25
//   Q3: Jan 15 – Feb 25
//   Q4 + annual: Apr 15 – Jun 10
function isResultsSeasonNow(now: Date = new Date()): boolean {
  const m = now.getUTCMonth() + 1; // 1-based
  const d = now.getUTCDate();
  if ((m === 7 && d >= 15) || (m === 8 && d <= 25)) return true; // Q1
  if ((m === 10 && d >= 15) || (m === 11 && d <= 25)) return true; // Q2
  if ((m === 1 && d >= 15) || (m === 2 && d <= 25)) return true; // Q3
  if ((m === 4 && d >= 15) || m === 5 || (m === 6 && d <= 10)) return true; // Q4
  return false;
}

// ── Dedup helper ──────────────────────────────────────────────
// Returns the enqueued job, or null if already pending/running.

async function enqueueIfNotActive(
  jobType: JobType,
  payload: unknown,
  triggeredBy: string,
  priority = 100,
) {
  const active = await listJobs({
    type: jobType,
    status: [JobStatus.PENDING, JobStatus.RUNNING],
    limit: 1,
  });

  if (active && active.jobs.length > 0) {
    console.log(
      `[Scheduler] ${jobType} already active (job ${active.jobs[0].id}), skipping`,
    );
    return null;
  }

  const job = await enqueueJob({
    type: jobType,
    payload,
    triggeredBy,
    priority,
  });

  console.log(`[Scheduler] Enqueued ${jobType} as job ${job.id}`);
  return job;
}

// ── Job registry ──────────────────────────────────────────────

interface ScheduledJob {
  name: string;
  /** Cron expression (UTC). IST = UTC + 5:30. */
  schedule: string;
  enqueue: () => Promise<void>;
}

// All cron expressions are in UTC.
// IST reference: UTC + 5:30
//   4:30 PM IST = 11:00 UTC  (post-market close bhavcopy)
//   7:30 PM IST = 14:00 UTC
//   8:00 AM IST = 02:30 UTC
//   9:00 AM IST = 03:30 UTC
//   9:30 AM IST = 04:00 UTC
//  10:00 AM IST = 04:30 UTC
//   6:30 PM IST = 13:00 UTC

const SCHEDULED_JOBS: ScheduledJob[] = [
  // ── Prices ─────────────────────────────────────────────────
  {
    name: "daily-eod-prices",
    schedule: "0 11 * * 1-5", // 4:30 PM IST, Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.EOD_PRICES_DAILY,
        {},
        "cron:daily-eod-prices",
        50, // slightly higher priority than default
      ).then(() => {}),
  },

  // ── Block / Bulk Deals ─────────────────────────────────────
  {
    name: "daily-block-deals",
    schedule: "0 14 * * 1-5", // 7:30 PM IST, Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.DEALS_DAILY_INGEST,
        {},
        "cron:daily-block-deals",
      ).then(() => {}),
  },

  // ── Corporate Events ───────────────────────────────────────
  {
    name: "weekly-events",
    schedule: "0 2 * * 0", // 7:30 AM IST Sunday
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.EVENTS_WEEKLY_INGEST,
        {},
        "cron:weekly-events",
      ).then(() => {}),
  },
  {
    name: "daily-event-refresh",
    schedule: "30 2 * * 1-5", // 8:00 AM IST Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.EVENTS_DAILY_REFRESH,
        {},
        "cron:daily-event-refresh",
      ).then(() => {}),
  },

  // ── Shareholding ───────────────────────────────────────────
  {
    name: "quarterly-shareholding",
    schedule: "30 3 20 1,4,7,10 *", // 9:00 AM IST on the 20th of each quarter month
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.SHAREHOLDING_QUARTERLY,
        {},
        "cron:quarterly-shareholding",
      ).then(() => {}),
  },
  {
    name: "daily-shareholding-refresh",
    schedule: "0 4 * * 1-5", // 9:30 AM IST Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.SHAREHOLDING_SMART_REFRESH,
        {},
        "cron:daily-shareholding-refresh",
      ).then(() => {}),
  },

  // ── Insider Trades ─────────────────────────────────────────
  {
    name: "daily-insider-trades",
    schedule: "0 13 * * 1-5", // 6:30 PM IST Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.INSIDER_TRADES_DAILY,
        {},
        "cron:daily-insider-trades",
      ).then(() => {}),
  },

  // ── News ───────────────────────────────────────────────────
  {
    name: "daily-nse-news",
    schedule: "30 3 * * 1-5", // 9:00 AM IST Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.NSE_ANNOUNCEMENTS_INGEST,
        { days: 2 },
        "cron:daily-nse-news",
      ).then(() => {}),
  },
  {
    name: "daily-google-news",
    schedule: "0 4 * * 1-5", // 9:30 AM IST Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.GOOGLE_NEWS_INGEST,
        { days: 7 },
        "cron:daily-google-news",
      ).then(() => {}),
  },
  {
    name: "news-extraction-worker",
    schedule: "30 4 * * 1-5", // 10:00 AM IST Mon–Fri (30 min after fetch jobs)
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.NEWS_CONTENT_EXTRACTION,
        { batchSize: 50 },
        "cron:news-extraction-worker",
      ).then(() => {}),
  },

  // ── Peer Metrics ───────────────────────────────────────────
  {
    name: "monthly-peer-metrics",
    schedule: "30 1 5 * *", // 7:00 AM IST on the 5th of every month
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.PEER_METRICS_COMPUTE_ALL,
        {},
        "cron:monthly-peer-metrics",
        50,
      ).then(() => {}),
  },

  // ── Quarterly Results Scan (v3) ────────────────────────────
  // Every 4 hours during earnings season.
  // Rationale: filings drop throughout the day; 4h cadence gives ≤4h
  // discovery latency. Universe scan at 1500ms/symbol takes ~50min,
  // well inside the 4h budget. Off-season ticks are no-ops.
  {
    name: "results-scan",
    schedule: "0 */4 * * *", // every 4 hours (UTC)
    enqueue: async () => {
      if (!isResultsSeasonNow()) {
        console.log("[Scheduler] results-scan: not result season, skipping");
        return;
      }
      await enqueueIfNotActive(
        JobTypes.RESULTS_SCAN,
        { mode: "universe", hoursBack: 6 },
        "cron:results-scan",
        50,
      );
    },
  },
];

// ── Scheduler ─────────────────────────────────────────────────

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  for (const job of SCHEDULED_JOBS) {
    cron.schedule(job.schedule, async () => {
      console.log(`[Scheduler] Firing: ${job.name}`);
      try {
        await job.enqueue();
      } catch (err) {
        console.error(`[Scheduler] ${job.name} enqueue error:`, err);
      }
    });

    console.log(`[Scheduler] Registered "${job.name}" → ${job.schedule}`);
  }
}

// ── Manual trigger (for testing / one-off runs) ───────────────

export async function triggerJob(name: string): Promise<void> {
  const job = SCHEDULED_JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown scheduled job: ${name}`);
  await job.enqueue();
}
