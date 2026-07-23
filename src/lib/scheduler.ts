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
import { sweepFailedScoringJobs } from "../scoring/errors/failed-job-guard.js";
import { sweepStaleSnapshots } from "../scoring/errors/stale-snapshot-guard.js";
import { sweepDegradedSnapshots } from "../scoring/errors/degraded-snapshot-guard.js";

// ── Results-season gate ───────────────────────────────────────
// Returns true during the four earnings windows (generous to catch late filers):
//   Q1: Jul 15 – Aug 25
//   Q2: Oct 15 – Nov 25
//   Q3: Jan 15 – Feb 25
//   Q4 + annual: Apr 15 – Jun 10
export function isResultsSeasonNow(now: Date = new Date()): boolean {
  const m = now.getUTCMonth() + 1; // 1-based
  const d = now.getUTCDate();
  if ((m === 7 && d >= 15) || (m === 8 && d <= 25)) return true; // Q1
  if ((m === 10 && d >= 15) || (m === 11 && d <= 25)) return true; // Q2
  if ((m === 1 && d >= 15) || (m === 2 && d <= 25)) return true; // Q3
  if ((m === 4 && d >= 15) || m === 5 || (m === 6 && d <= 10)) return true; // Q4
  return false;
}

// ── Results-scan enqueue gate ─────────────────────────────────
// The results-scan cron ticks every 4h (00,04,08,12,16,20 UTC). This predicate
// decides which of those ticks actually enqueue a scan.
//
// ⚠️  THE CRON EXPRESSION IS NOT THE SCHEDULE. It fires 6×/day year-round; THIS
//     function is the real schedule. Change cadence here, not in the cron string.
//
//   • OFF SEASON — ONLY the 16:00 UTC tick → the scan still runs ONCE A DAY,
//     year-round, so a late / off-calendar filer is caught within ~a day instead
//     of waiting up to ~7 weeks for the next season window to reopen the gate.
//     UNCHANGED.
//   • IN SEASON  — 04:00 and 16:00 UTC (09:30 and 21:30 IST). Was: all 6 ticks.
//
// WHY 6 → 2. The 1→6 jump at the season boundary is what produced the 14–15 Jul
// spike: six universe scans a day, each fanning a rescore out to every scored PG.
// Six was never a freshness requirement — it was "every tick the cron happens to
// have". Two at 12h spacing keeps same-day discovery (a filing is picked up within
// 12h rather than 4h) at a third of the runs.
//
// WHY THESE TWO HOURS SPECIFICALLY:
//   · 16:00 UTC / 21:30 IST — after the trading day AND after evening board
//     meetings, which is when the bulk of results land. It is also the existing
//     off-season tick, so IN-SEASON IS A STRICT SUPERSET OF OFF-SEASON: nothing
//     that fires off-season ever stops firing when the season opens. The season
//     boundary becomes purely additive, which is the property that makes this
//     change safe to reason about.
//   · 04:00 UTC / 09:30 IST — market open, catching anything filed in the ~12h
//     since the previous tick.
//
// NOT tuned to a measured filing-time distribution, and deliberately not claimed
// to be: `filing_date` is a DATE — 0 of 6,589 rows carry a time — so NSE's actual
// filing hours are not in our data. (`fetched_at` clusters only show when our own
// scan ran; using them to place ticks would be circular.) These two hours are a
// reasoned choice against the Indian results day, not a fitted one. If a 3rd tick
// is ever wanted, the honest way to justify it is to start recording filing TIMES.
//
// Pure + deterministic (a function of `now` alone) so it can be unit-verified —
// see src/scripts/verify-results-scan-cadence.ts.

/** The single off-season tick. The scan runs once a day, year-round, on this hour. */
export const OFF_SEASON_TICK_UTC = 16;
/** The in-season ticks. MUST include OFF_SEASON_TICK_UTC — see the superset note above. */
export const IN_SEASON_TICKS_UTC: readonly number[] = [4, 16];

export function resultsScanShouldEnqueue(now: Date): boolean {
  const hour = now.getUTCHours();
  return isResultsSeasonNow(now)
    ? IN_SEASON_TICKS_UTC.includes(hour)
    : hour === OFF_SEASON_TICK_UTC;
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
  // NOTE: NSE publishes the full security-wise bhavcopy
  // (sec_bhavdata_full_*.csv, with delivery data) only ~6 PM IST.
  // The old 4:30 PM IST slot fetched the file before it existed →
  // 404 → mislabelled "market_closed" → silent daily gap.
  // Run at 7:00 PM IST; the handler also re-checks the prior few
  // trading days so a late file or a missed run self-heals.
  {
    name: "daily-eod-prices",
    schedule: "30 13 * * 1-5", // 7:00 PM IST, Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.EOD_PRICES_DAILY,
        {},
        "cron:daily-eod-prices",
        50, // slightly higher priority than default
      ).then(() => {}),
  },

  // ── AMFI mutual-fund NAV (HELD-NOT-SCORED) ─────────────────
  // ONE ~1.6 MB file carries the latest NAV for the whole ~14k-scheme universe, so there is
  // no per-scheme fan-out and no rate-limit exposure. Runs EVERY DAY (unlike the equity feed):
  // AMFI republishes daily, and a re-run on an unchanged file is a no-op (upsert on the ISIN
  // spine — 0 new rows). AMFI_NAV_DAILY is NOT a scoring trigger → never enqueues a rescore.
  {
    name: "daily-amfi-nav",
    schedule: "0 19 * * *", // 12:30 AM IST — after AMFI's ~11 PM IST publish
    enqueue: () =>
      enqueueIfNotActive(JobTypes.AMFI_NAV_DAILY, {}, "cron:daily-amfi-nav").then(() => {}),
  },

  // ── ETF NAV + TICKER (Step 13 — HELD-NOT-SCORED) ───────────
  // The SAME AMFI file, read for the 4 ETF sections Step 9 excluded, plus NSE's eq_etfseclist
  // joined on ISIN for the exchange ticker (327/337 resolve; the 10 misses are BSE-listed or
  // matured and stay honestly NULL).
  //
  // A SEPARATE JOB, not a flag on daily-amfi-nav, so the two passes fail and retry independently:
  // NSE going down must never be able to take the 17,567-fund NAV refresh with it.
  //
  // ORDERING IS LOAD-BEARING. It sits BETWEEN daily-amfi-nav and daily-mf-analytics because the
  // fold reads the CATALOGUE as its worklist: an ETF whose nav_date has not been refreshed yet
  // would be folded against yesterday's as-of date, and an ETF not yet catalogued at all would
  // simply be skipped. 30 minutes is ample for a 1.6 MB + 27 KB fetch.
  //
  // ETF_NAV_DAILY is NOT a scoring trigger → never enqueues a rescore.
  {
    name: "daily-etf-nav",
    schedule: "30 19 * * *", // 1:00 AM IST — after daily-amfi-nav, before daily-mf-analytics
    enqueue: () =>
      enqueueIfNotActive(JobTypes.ETF_NAV_DAILY, {}, "cron:daily-etf-nav").then(() => {}),
  },

  // ── ETF CORPORATE ACTIONS — unit splits, from NSE (Step 19) ──
  // AMFI's NAV history is RAW: when an ETF sub-divides its units 1:10 the published NAV steps down
  // 90% overnight, and EVERY metric folded from that series believes the fund lost 90% in a day —
  // not just the return. (Before this job existed: max_drawdown_3y -90.7%, vol_3y 134%, alpha_3y
  // -60%, while the 1Y figures were clean because the split fell outside that window.) This job
  // stores the REAL, DATED split so the fold can rescale the series before it computes anything.
  //
  // ORDERING IS LOAD-BEARING, and it is the whole reason this sits at :45.
  //   daily-etf-nav (19:30) → THIS (19:45) → daily-mf-analytics (20:00)
  // It must run AFTER daily-etf-nav, because it reads the ETF catalogue (an ETF with no row and no
  // ticker cannot be looked up on NSE); and BEFORE daily-mf-analytics, because the fold reads what
  // this writes. A split announced today is therefore in the table before tonight's fold rescales
  // the series — which is what stops a NEW split ever corrupting a return the way the last 22 did.
  //
  // CHEAP AND USUALLY EMPTY: 327 light NSE calls, and splits are rare and announced well ahead of
  // the ex-date, so most nights it finds nothing new. That is honest-empty, not a fault.
  //
  // NOT a scoring trigger → never enqueues a rescore (funds are held-not-scored).
  {
    name: "daily-etf-corporate-actions",
    schedule: "45 19 * * *", // 1:15 AM IST — between daily-etf-nav and daily-mf-analytics
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.INSTRUMENT_CORPORATE_ACTIONS,
        {},
        "cron:daily-etf-corporate-actions",
      ).then(() => {}),
  },

  // ── REIT / InvIT — identity + PRICE + distribution yield (Step 14) ──
  // A trust TRADES, so unlike the fund jobs this one is a PRICE job: every session produces a new
  // close. It reads the NSE udiff BhavCopy, which is published with the rest of the EOD files, so
  // it is scheduled alongside the equity EOD price ingest rather than with the AMFI/NAV crons —
  // it depends on NSE's bhavcopy being out, not on AMFI's.
  //
  // REIT_DAILY is NOT a scoring trigger → never enqueues a rescore (held-not-scored).
  {
    name: "daily-reit",
    schedule: "45 13 * * 1-5", // 7:15 PM IST, weekdays — after NSE publishes the day's bhavcopy
    enqueue: () => enqueueIfNotActive(JobTypes.REIT_DAILY, {}, "cron:daily-reit").then(() => {}),
  },

  // ── ETF MARKET PRICES (Step 14.5) — the traded close of a listed fund ──
  // Reads the SAME udiff BhavCopy as daily-reit (the EQ-series rows instead of RR/IV), so it is
  // scheduled right behind it, off the same publish. A separate job — an ETF pricing failure must
  // never take REIT/InvIT identity down with it.
  //
  // Deliberately NOT chained to the AMFI/NAV crons: this depends on NSE's bhavcopy being out, not
  // on AMFI's file. The NAV lane (daily-etf-nav, 1:00 AM IST) still runs on its own clock — the two
  // numbers are independent, and neither blocks the other.
  //
  // ETF_PRICES_DAILY is NOT a scoring trigger → never enqueues a rescore (held-not-scored).
  {
    name: "daily-etf-prices",
    schedule: "50 13 * * 1-5", // 7:20 PM IST, weekdays — 5 min after daily-reit
    enqueue: () =>
      enqueueIfNotActive(JobTypes.ETF_PRICES_DAILY, {}, "cron:daily-etf-prices").then(() => {}),
  },

  // ── GOVERNMENT SECURITIES (Step 15) — G-secs, T-bills, SDLs, Sovereign Gold Bonds ──
  // The third lane over the SAME udiff BhavCopy, scheduled behind the other two off the same
  // publish. A separate job so a problem with government paper can never take REIT identity or ETF
  // pricing down with it.
  //
  // GOVT_SECURITIES_DAILY is NOT a scoring trigger → never enqueues a rescore (held-not-scored).
  {
    name: "daily-govt-securities",
    schedule: "55 13 * * 1-5", // 7:25 PM IST, weekdays — 5 min after daily-etf-prices
    enqueue: () =>
      enqueueIfNotActive(JobTypes.GOVT_SECURITIES_DAILY, {}, "cron:daily-govt-securities").then(() => {}),
  },

  // ── CORPORATE BONDS / NCDs (Step 17) — NCDs, debentures, municipal green bonds ──
  // The FOURTH lane over the SAME udiff BhavCopy, scheduled behind the other three off the same
  // publish. A separate job, for the same reason all of them are: a problem loading corporate debt
  // must never be able to take REIT identity, ETF pricing or government paper down with it.
  //
  // IT IS NOT PART OF THE EQUITY PRICE INGEST, and that is deliberate. `daily-eod-prices` reads
  // sec_bhavdata_full — a file that has NO ISIN COLUMN AT ALL — and joins on the SYMBOL against
  // `stocks`. A bond has no `stocks` row (stock_id is NULL, which is exactly what makes it
  // held-not-scored), so the equity lane cannot see it and could not key it if it did. Bonds are
  // priced through `instrument_prices`, off the udiff, which is the only NSE file carrying ISIN +
  // series + close together.
  //
  // WHY IT MUST STILL RUN NIGHTLY even though the catalogue is already loaded — two reasons, and
  // both are load-bearing:
  //   1. THE UNIVERSE ACCUMULATES. The BhavCopy lists what TRADED, not what is LISTED. Corporate
  //      debt is thin (recon: ~150 rows/session, 356 across ten, and the union was STILL climbing).
  //      356 is a FLOOR. Each nightly run adds whatever new paper it sees, and the catalogue
  //      converges on the traded universe over time without anyone guessing at its true size.
  //   2. IT PRICES, AND IT UPGRADES NAMES. A bond that trades gets a fresh close. And a bond a
  //      BROKER seeded before we ever saw it (carrying its tradingsymbol as a placeholder name) has
  //      that name rewritten to the real FinInstrmNm the first time it prints — the ON CONFLICT
  //      (isin) DO UPDATE does it for free.
  //
  // CORPORATE_BONDS_DAILY is NOT a scoring trigger → never enqueues a rescore (held-not-scored).
  {
    name: "daily-corporate-bonds",
    // 7:35 PM IST, weekdays — 10 min after daily-govt-securities, NOT 5.
    // The obvious slot (7:30 PM / "0 14") is already taken by daily-block-deals, which also fetches
    // from NSE. Two NSE pulls firing on the same minute is exactly what the 5-minute stagger across
    // these lanes exists to prevent, so this steps over it rather than doubling up.
    schedule: "5 14 * * 1-5",
    enqueue: () =>
      enqueueIfNotActive(JobTypes.CORPORATE_BONDS_DAILY, {}, "cron:daily-corporate-bonds").then(() => {}),
  },

  // ── MF + ETF ANALYTICS (Step 10+11, Option B) — COMPUTE-AND-DISCARD ──
  // Streams ~21 × 90-day AMFI history windows (~12 min, ~1.1 GB), folds them into per-scheme
  // accumulators IN MEMORY, writes ~14,041 rows of derived analytics, and DISCARDS every raw
  // NAV. No NAV-history table exists to fill — that is the whole design (a persistent one
  // measured ~26 M rows / ~2.5 GB against a 500 MB ceiling).
  //
  // STEP 13: the fold's worklist is now every AMFI-catalogued fund — mutual_fund AND etf. An ETF's
  // rich data is NAV-derived, so it needs no new engine: 337 more scheme codes go through the
  // machine that was already there. (The table is still named mf_analytics; it is keyed on the
  // AMFI scheme code, which is exactly what both classes have.)
  //
  // Scheduled AFTER both ingests, deliberately: the fold anchors every scheme's horizons on that
  // scheme's OWN latest nav_date, which the ingests have just refreshed. Running it first would
  // compute tonight's analytics against yesterday's as-of dates.
  //
  // Memory is O(schemes), not O(rows) — the streaming fold never materialises a window body
  // (recon: 19.9 MB heap / 114 MB RSS folding 535,680 rows). Safe in-process alongside the API.
  //
  // MF_ANALYTICS_DAILY is NOT a scoring-trigger switch arm → it never enqueues a rescore.
  {
    name: "daily-mf-analytics",
    schedule: "0 20 * * *", // 1:30 AM IST — one hour after daily-amfi-nav
    enqueue: () =>
      enqueueIfNotActive(JobTypes.MF_ANALYTICS_DAILY, {}, "cron:daily-mf-analytics").then(() => {}),
  },

  // ── WEEKLY CHART SERIES refresh (Step 21 — HELD-NOT-SCORED) ──
  // Adds the newest week's point to every held non-stock instrument's 4-year series; the DB's
  // rolling-window trigger drops whatever just fell out of the 4y window, so per-instrument storage
  // stays constant. Idempotent (ON CONFLICT) — a re-run adds nothing. Weekly on Saturday, after the
  // week's last udiff closes AND the nightly AMFI NAV have all landed. Funds re-pull one mfapi call
  // each; listed instruments share ONE udiff archive pass. NOT a scoring trigger.
  {
    name: "weekly-instrument-history-refresh",
    schedule: "0 3 * * 6", // 8:30 AM IST Saturday — after Friday's close + Sat 00:30 AMFI NAV
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.INSTRUMENT_HISTORY_BACKFILL,
        { mode: "refresh_all_held" },
        "cron:weekly-instrument-history-refresh",
      ).then(() => {}),
  },

  // ── Index Prices (DISPLAY-ONLY — not scored) ───────────────
  // Sibling of daily-eod-prices: fetches the NSE index archive
  // (ind_close_all_*.csv) for chart display. Runs 5 min after the
  // equity job to stagger the two NSE fetches. INDEX_PRICES_DAILY is
  // NOT a scoring-trigger switch arm → it never enqueues a PG rescore.
  {
    name: "daily-eod-indices",
    schedule: "35 13 * * 1-5", // 7:05 PM IST, Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.INDEX_PRICES_DAILY,
        {},
        "cron:daily-eod-indices",
        50,
      ).then(() => {}),
  },

  // ── User-created alerts: daily evaluation pass ─────────────
  // Hung on the daily EOD cycle, but scheduled DELIBERATELY LATE — after the 7:00 PM IST
  // EOD-price ingest AND the PG rescores it enqueues (all 13 scored PGs) have had time to
  // land. Runs at 8:30 PM IST so each alert reads the day's fresh band / findings, not a
  // stale pre-rescore snapshot. Weekdays only (prices only move Mon–Fri). Evaluation
  // RECORDS fires into alert_events and flips (active, armed) — it SENDS NOTHING.
  {
    name: "daily-alerts-eval",
    schedule: "0 15 * * 1-5", // 8:30 PM IST, Mon–Fri (≈1.5h after EOD prices → post-rescore)
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.ALERTS_EVAL_DAILY,
        {},
        "cron:daily-alerts-eval",
      ).then(() => {}),
  },

  // ── User-created alerts: daily email drain ─────────────────
  // Runs 15 min AFTER daily-alerts-eval so tonight's fires (recorded into alert_events by
  // the eval pass) go out tonight. The eval pass is a fast read-only scan + a few small
  // transactions, so its events have long committed by 8:45 PM. Drains the WHOLE
  // undelivered backlog, so this also retries any events a prior run failed to send.
  // Idempotent (delivered flag is the guard) → a race or double-tick never double-sends.
  // Weekdays only, mirroring the eval cron.
  {
    name: "daily-alerts-deliver",
    schedule: "15 15 * * 1-5", // 8:45 PM IST, Mon–Fri (15 min after daily-alerts-eval)
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.ALERTS_DELIVER_DAILY,
        {},
        "cron:daily-alerts-deliver",
      ).then(() => {}),
  },

  // ── Event reminders: daily evaluation pass ─────────────────
  // Runs EVERY DAY (not just weekdays like the alerts eval) — reminders are date-based, so a
  // Monday event with a 1-day lead must fire on the (weekend) Sunday. Scheduled after the
  // alerts crons; re-resolves each reminder's nearest upcoming event (follows reschedules)
  // and records fires into event_reminder_events. Sends NOTHING.
  {
    name: "daily-reminders-eval",
    schedule: "20 15 * * *", // 8:50 PM IST, every day
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.REMINDERS_EVAL_DAILY,
        {},
        "cron:daily-reminders-eval",
      ).then(() => {}),
  },

  // ── Event reminders: daily email drain ─────────────────────
  // Runs 5 min AFTER daily-reminders-eval so tonight's fires go out tonight, EVERY DAY (must
  // cover weekends, mirroring the eval cadence). Drains event_reminder_events via the SAME
  // Resend mailer alerts use; drains the whole backlog so it also retries prior failures.
  // Idempotent (delivered flag is the guard) → a race or double-tick never double-sends.
  {
    name: "daily-reminders-deliver",
    schedule: "25 15 * * *", // 8:55 PM IST, every day (5 min after daily-reminders-eval)
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.REMINDERS_DELIVER_DAILY,
        {},
        "cron:daily-reminders-deliver",
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
  // Cadence — the cron ticks every 4h (00,04,08,12,16,20 UTC) year-round; the
  // enqueue gate decides which ticks actually run:
  //   • IN SEASON  — the 04:00 and 16:00 UTC ticks enqueue → TWICE A DAY, 12h apart
  //     (09:30 and 21:30 IST). Was all 6; see resultsScanShouldEnqueue for why.
  //   • OFF SEASON — ONLY the 16:00 UTC (9:30 PM IST) tick enqueues → ONCE A DAY.
  //     Before this fix the off-season gate was a hard `return` on EVERY tick, so
  //     between the four season windows the scan NEVER ran and a late / off-calendar
  //     filer waited up to ~7 weeks for the next window to reopen. Daily flattens that
  //     dead gap to ≤~1 day.
  //
  // WHY DAILY IS SUFFICIENT (no ledger fix needed): every run re-discovers the FULL
  // NSE filings list per symbol and decides ingest via decideIngest → the actual data
  // tables (fundamental/quarterly_result/…), NOT result_fetch_logs. A period is skipped
  // ONLY once a real data row exists for it; an empty/early fetch marks nothing. So the
  // current/open quarter stays re-checkable every run until its filing lands, and the
  // moment it lands the next daily run ingests it. result_fetch_logs is a write-only
  // audit trail here — it gates nothing and stays untouched.
  //
  // Universe scan ≈ 50 min at 1500ms/symbol (NSE-bound, light CPU). 16:00 UTC is clear
  // of the 3 AM IST retention prune (21:30 UTC) and the EOD ingest window (13:30–14:05
  // UTC); the alerts/reminders crons (15:00–15:25 UTC) are fast and long-settled by then.
  // Re-running an already-ingested period is a no-op (decideIngest→skip; logFetch upserts
  // in place) — zero duplicate rows.
  //
  // ⚠️  THE IN-SEASON 04:00 UTC TICK SHARES ITS SLOT, and that is a known, accepted cost.
  //     daily-shareholding-refresh and daily-google-news are both "0 4 * * 1-5", and
  //     news-extraction-worker is at 04:30. It is NOT concurrent NSE hammering: there is
  //     ONE worker and it drains serially, so these queue rather than overlap. But this
  //     scan carries priority 50 vs their default 100, so on in-season weekdays it goes
  //     FIRST and pushes them back by up to ~50 min. Both are same-day-tolerant (a news
  //     fetch and a shareholding smart-refresh), so this is a delay, not a miss.
  //     The alternative, 08:00 UTC, is an empty slot but leaves a 16h overnight discovery
  //     gap instead of 12h — worse on the axis that actually matters here.
  {
    name: "results-scan",
    schedule: "0 */4 * * *", // every 4 hours (UTC): 00,04,08,12,16,20 — the GATE picks 1 or 2 of them
    enqueue: async () => {
      // In-season: 04:00 + 16:00 UTC (2/day, 12h apart). Off-season: only 16:00 UTC, so
      // the scan still runs once a day year-round. See resultsScanShouldEnqueue.
      if (!resultsScanShouldEnqueue(new Date())) {
        console.log(
          `[Scheduler] results-scan: tick ${new Date().getUTCHours()}:00 UTC not in the ` +
            `active set (in-season ${IN_SEASON_TICKS_UTC.join("/")}, off-season ` +
            `${OFF_SEASON_TICK_UTC} only) — skipping`,
        );
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

  // ── Scoring-error detection: failed-job catch-up sweep (Stage 1) ──
  // Reconciles terminal-failed scoring BackgroundJobs → scoring error rows. Runs the
  // sweep DIRECTLY (a cheap read + dedup-write, not a long job), complementing the
  // real-time worker hook. Dedup coalesces the two paths; the liveness filter skips
  // failures already healed by a later successful rescore. Best-effort (never throws).
  {
    name: "scoring-failed-job-sweep",
    // ONCE DAILY 18:00 UTC (23:30 IST). Was */30 (48×/day). The detected state only changes when a
    // rescore WRITES a new snapshot (~1–2×/day: weekday EOD cascade + results-scan), so 47 of 48 daily
    // runs re-scanned identical state. 18:00 UTC is AFTER both the EOD and the 16:00-UTC results-scan
    // rescore cascades settle (see A4). Real-time detection is unaffected — the worker hook surfaces a
    // terminal failure the instant it happens; this sweep is only the boot-time/re-affirm backstop.
    schedule: "0 18 * * *",
    enqueue: async () => {
      const r = await sweepFailedScoringJobs();
      console.log(
        `[Scheduler] scoring-failed-job-sweep: scanned=${r.scanned} surfaced=${r.surfaced} ` +
          `skippedHealed=${r.skippedHealed} skippedNonRealEntity=${r.skippedNonRealEntity}`,
      );
    },
  },

  // ── Scoring-error detection: stale-snapshot sweep (Stage 3) ──
  // Reconciles in-force snapshots vs their (immutable-append) input createdAts →
  // opens scoring_stale rows for stocks whose data moved since the score, and self-
  // heals rows whose stock has since been rescored. Built on createdAt only (never
  // updatedAt) → display-only sweeps cannot false-flag it. Best-effort (never throws).
  {
    name: "scoring-stale-snapshot-sweep",
    // ONCE DAILY 18:10 UTC (23:40 IST). Was hourly (24×/day). Staleness is drift, not urgent, and a
    // snapshot only goes stale when a new score INPUT is inserted — which the same daily rescore cascade
    // then refreshes. Runs 10 min after the failed-job sweep so the three inline sweeps (they share this
    // process + the pg Pool, not the job worker) don't fan their full-scan queries out on the same tick.
    schedule: "10 18 * * *",
    enqueue: async () => {
      const r = await sweepStaleSnapshots();
      console.log(
        `[Scheduler] scoring-stale-snapshot-sweep: scanned=${r.scanned} stale=${r.stale} ` +
          `healed=${r.healed} (shareholding=${r.bySignal.new_shareholding} fundamental=${r.bySignal.new_fundamental})`,
      );
    },
  },

  // ── Scoring-error detection: degraded-snapshot sweep (Stage 4) ──
  // Market sub-case only: flags a Market pillar dropped (unavailable_redistributed)
  // while ≥2 of its 4 categories still have inputs — a contradiction of the engine's
  // own §14.4c rule (an engine/persistence anomaly). NEVER flags honest drops (VEDL /
  // <2 categories). Self-heals when the pillar is no longer unexpectedly dropped.
  // ── Broker auto-poll (Step 7) ──────────────────────────────
  // Fires every 30 min during MARKET HOURS (Mon–Fri, 9:00–17:00 IST = 03:30–11:30 UTC), and
  // enqueues ONE sweep job. The sweep itself decides who is due: enabled + session live +
  // lastSyncedAt older than 2h. So a connection is polled every ~2h, while the cron stays cheap
  // and frequent enough that a missed firing self-heals on the next one.
  //
  // WHY MARKET HOURS ONLY, and not 24/7: a holdings snapshot only moves when the user trades or a
  // trade settles. And Kite tokens die ~6:00 AM IST daily — so an overnight sweep would find every
  // session dead and do nothing but write noise into the job log. Polling when nothing can have
  // changed is not caution, it is just cost.
  //
  // enqueueIfNotActive is the outer guard: if a previous sweep is still pending/running (a slow
  // broker, a long worklist), this firing is skipped rather than piling a second sweep on top.
  {
    name: "broker-poll-sync",
    schedule: "*/30 3-11 * * 1-5", // every 30 min, 09:00–17:00 IST (03:30–11:30 UTC), Mon–Fri
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.BROKER_POLL_SYNC,
        {},
        "cron:broker-poll-sync",
      ).then(() => {}),
  },

  {
    name: "scoring-degraded-snapshot-sweep",
    // ONCE DAILY 18:20 UTC (23:50 IST). Was hourly (24×/day) — the heaviest sweep by far (unbounded
    // findMany over all snapshots + market pillars + the entire score_market_subs table, ~2.6 MB/run).
    // Degradation is a committed-snapshot STATE, so it can only appear/clear on a new snapshot write;
    // one daily pass after the cascades settle catches every change. Spaced last (10 min after the stale
    // sweep) so the largest scan runs alone. Query shape is deliberately untouched here (cadence-only).
    schedule: "20 18 * * *",
    enqueue: async () => {
      const r = await sweepDegradedSnapshots();
      console.log(
        `[Scheduler] scoring-degraded-snapshot-sweep: scanned=${r.scanned} degraded=${r.degraded} ` +
          `healed=${r.healed} honestSkipped=${r.honestSkipped}`,
      );
    },
  },
];

// ── Retention pruner — NIGHTLY, 3:00 AM IST — HELD DISABLED ────
// ⚠️ This job DELETES production data irreversibly. It is registered ONLY when
// RETENTION_CRON_ARMED is flipped to true — which happens AFTER the first dry-run
// report is reviewed and signed off (cv2-scheduler-hazard). Until then it is not
// registered and CANNOT fire, no matter how often the server restarts. The only
// way to exercise the engine today is the manual dry-run script
// (src/scripts/retention-dry-run.ts), which deletes nothing.
//
// 3:00 AM IST = 21:30 UTC — after daily-mf-analytics (1:30 AM IST) has long
// settled and hours before the 6:30 AM IST insider fetch. Nothing races it.
//
// ARMED (Step 1, 2026-07-18): the nightly 3 AM run enqueues RETENTION_PRUNE
// { dryRun: false }. Per-table safety is enforced in the POLICY, not here — the
// engine deletes only rows with retention_policy.armed = true. As of Step 1 the 30
// routine tables are armed; `daily_prices` is held (armed=false) for the Step-2
// one-time mass correction, so this nightly run maintains only the 30 and CANNOT
// touch daily_prices. (Kill switch: UPDATE retention_policy SET armed=false, or set
// this flag back to false to stop the cron entirely.)
const RETENTION_CRON_ARMED = true;

const RETENTION_JOB: ScheduledJob = {
  name: "nightly-retention-prune",
  schedule: "30 21 * * *", // 3:00 AM IST (21:30 UTC), every day
  enqueue: () =>
    enqueueIfNotActive(
      JobTypes.RETENTION_PRUNE,
      { dryRun: false },
      "cron:nightly-retention-prune",
    ).then(() => {}),
};

// ── Scheduler ─────────────────────────────────────────────────

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  const register = (job: ScheduledJob) => {
    cron.schedule(job.schedule, async () => {
      console.log(`[Scheduler] Firing: ${job.name}`);
      try {
        await job.enqueue();
      } catch (err) {
        console.error(`[Scheduler] ${job.name} enqueue error:`, err);
      }
    });
    console.log(`[Scheduler] Registered "${job.name}" → ${job.schedule}`);
  };

  for (const job of SCHEDULED_JOBS) register(job);

  // Retention pruner — held disabled until the first dry-run is signed off.
  if (RETENTION_CRON_ARMED) {
    register(RETENTION_JOB);
  } else {
    console.log(
      `[Scheduler] HELD (disabled): "${RETENTION_JOB.name}" — retention cron NOT registered ` +
        `(set RETENTION_CRON_ARMED=true only after the first dry-run report is signed off).`,
    );
  }
}

// ── Manual trigger (for testing / one-off runs) ───────────────

export async function triggerJob(name: string): Promise<void> {
  const job = SCHEDULED_JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown scheduled job: ${name}`);
  await job.enqueue();
}
