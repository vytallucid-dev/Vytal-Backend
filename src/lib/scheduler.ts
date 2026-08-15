// src/lib/scheduler.ts
// ─────────────────────────────────────────────────────────────
// Cron-based scheduler. All recurring jobs run through the job
// worker queue — no ingestion function is called directly.
// Each cron tick: dedup check → enqueueJob → worker picks it up.
//
// Benefits:
//   - Every run is tracked in BackgroundJob (status, progress, result)
//   - A restart mid-job returns the row to `pending` (or `abandoned` for the types that
//     are not safe to re-run) rather than leaving a ghost — see jobs/reaper.ts.
//     ⚠ THIS LINE USED TO CLAIM "a restart mid-job marks it ABANDONED, not silently
//       lost", and that was FALSE for the case that actually happened. Boot recovery
//       only reaped rows older than 30 minutes and only ran at boot, so a restart
//       arriving inside that window left the row `running` forever and NOTHING looked
//       again. Measured 11 Aug 2026: 2.74 days, and the two ticks below were skipped.
//   - Two server instances or a restart can't double-run the same job
//     ⚠ Read this precisely: the guarantee is enqueue-time dedup (enqueueIfNotActive),
//       and its failure mode is the OPPOSITE of double-running — a single stuck
//       `running` row makes every later tick skip, i.e. the job stops running at all.
//       That is what the reaper exists to bound.
//   - All jobs are cancellable from the admin API
//     ⚠ Cancellation is COOPERATIVE. 12 of 36 handler files never check ctx.shouldCancel
//       and never take ctx.signal, so for those the flag is recorded and nothing stops.
// ─────────────────────────────────────────────────────────────

import cron from "node-cron";
import { enqueueJob, listJobs } from "../jobs/enqueue.js";
import { JobStatus, JobTypes, type JobType } from "../jobs/types.js";
import { reapStalledJobs } from "../jobs/reaper.js";
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

export interface ScheduledJob {
  name: string;
  /** Cron expression (UTC). IST = UTC + 5:30. */
  schedule: string;
  enqueue: () => Promise<void>;
  /**
   * The job type this entry enqueues, or null when it does work INLINE and creates no
   * background_jobs row at all (the three scoring sweeps and the reaper).
   *
   * ★ DECLARED, NOT INFERRED, because the health check needs it and a closure cannot be
   *   read. `null` is a real answer here, not a missing one: it tells the monitor that
   *   this entry is unobservable from the jobs table and must be excluded by NAME rather
   *   than counted as permanently missing.
   */
  jobType: JobType | null;
  /**
   * The enqueue GATE, when the cron expression is not the schedule.
   *
   * ⚠ results-scan is the live case and the reason this field exists: it ticks 6×/day
   *   year-round and this predicate decides which ticks actually enqueue. Without it the
   *   health check would compute 6 expected firings a night and report four phantom
   *   misses — training the operator to ignore the report, which is the exact failure
   *   this whole part is meant to prevent.
   */
  gate?: (now: Date) => boolean;
  /**
   * Job types whose FRESH OUTPUT this entry reads. Declared so the health check can detect
   * a consumer that ran against a stale or half-written input.
   *
   * ★ THIS IS THE 11 AUGUST HARM, NOT ITS CAUSE. The cause was a stuck ICA row; the HARM
   *   was three nights of mf_analytics folding ETF NAV against a split table that had not
   *   been refreshed. Every ordering below is already stated as load-bearing in the comment
   *   on its entry ("ORDERING IS LOAD-BEARING… the fold reads what this writes") — this
   *   field only makes that machine-readable, so the monitor can say it instead of an
   *   operator having to know it.
   */
  dependsOn?: JobType[];
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
  // ── JOB REAPER — every 2 minutes, and it does NOT go through the queue ──────────
  //
  // ★ THIS IS THE ONE ENTRY THAT MUST NOT BE A JOB. Every other line in this list enqueues
  //   work for the worker to drain. A reaper that did that would queue BEHIND the very job
  //   it exists to reclaim — a stuck 7-hour scan would hold the worker, the reaper's own
  //   row would sit `pending` behind it, and nothing would ever be reclaimed. So it calls
  //   reapStalledJobs directly, in-process, like the three scoring sweeps below.
  //
  // WHY 2 MINUTES. The detection budget is STALE_AFTER_MS (10 min) + this cadence, so a
  // stalled job surfaces within 12 minutes worst-case. The pass itself is one indexed read
  // over a population that is normally EMPTY (`status='running'` is ~1 row deep against
  // ~12k), so 720 near-free reads a day buys that latency. Against the 2.74 days the 11
  // August row actually took, the cadence is not the expensive part of anything.
  //
  // ⚠ It runs in the SAME process as the worker, so it cannot help a process that is fully
  //   dead. That case is the BOOT pass's (worker.start → reapStalledJobs({mode:"boot"})).
  //   Between them: process alive + row orphaned → this; process dead → boot.
  {
    name: "job-reaper",
    schedule: "*/2 * * * *",
    jobType: null,
    enqueue: async () => {
      const r = await reapStalledJobs({ mode: "timer" });
      // Silent when there is nothing to say — this fires 720×/day and a heartbeat line per
      // tick would bury the one that matters. reapStalledJobs logs loudly on every reclaim.
      if (r.scanned > 0) {
        console.error(
          `[Scheduler] job-reaper: scanned=${r.scanned} requeued=${r.requeued} ` +
            `failed=${r.failed} raced=${r.skippedRaced}`,
        );
      }
    },
  },

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
    jobType: JobTypes.EOD_PRICES_DAILY,
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
    jobType: JobTypes.AMFI_NAV_DAILY,
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
    jobType: JobTypes.ETF_NAV_DAILY,
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
    jobType: JobTypes.INSTRUMENT_CORPORATE_ACTIONS,
    // Reads the ETF catalogue: an ETF with no row and no ticker cannot be looked up on NSE.
    dependsOn: [JobTypes.ETF_NAV_DAILY],
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
    jobType: JobTypes.REIT_DAILY,
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
    jobType: JobTypes.ETF_PRICES_DAILY,
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
    jobType: JobTypes.GOVT_SECURITIES_DAILY,
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
    jobType: JobTypes.CORPORATE_BONDS_DAILY,
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
    jobType: JobTypes.MF_ANALYTICS_DAILY,
    // ★ THE 11 AUGUST EDGE. The fold anchors each scheme on its OWN latest nav_date (the two
    //   NAV feeds) and RESCALES the series from the split table (ICA) before computing
    //   anything. A fold that runs while any of the three is stale or still mid-write
    //   produces numbers that look fine and are wrong — which is exactly what happened on
    //   11, 12 and 13 August and what nothing surfaced.
    dependsOn: [JobTypes.AMFI_NAV_DAILY, JobTypes.ETF_NAV_DAILY, JobTypes.INSTRUMENT_CORPORATE_ACTIONS],
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
    jobType: JobTypes.INSTRUMENT_HISTORY_BACKFILL,
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
    jobType: JobTypes.INDEX_PRICES_DAILY,
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
  // ── The filing pass: the rolling-window sweep (step 6) ─────
  // ★ THE ONLY CLOCK-KEYED THING IN THE FILING PASS, AND IT EXISTS FOR ONE REASON. Every other rule
  // recomputes when a filing lands, because a filing is the only thing that can change its answer.
  // P6 and H are different: they evaluate a TRAILING 90-DAY WINDOW, so yesterday's deal leaves the
  // window tomorrow whether or not anything is ingested. An ingestion trigger cannot fire for the
  // absence of an event, so those two — and only those two — need a clock.
  //
  // 8:00 PM IST, DAILY INCLUDING WEEKENDS. Weekdays it lands after the 6:30 PM insider ingest and the
  // 7:30 PM deals ingest, so it sees the day's feed. Weekends it still runs, because a window edge
  // moves on a Saturday exactly as it does on a Tuesday and a Monday-only sweep would let a finding
  // sit two days past true. Its worklist is the stocks that HAVE a feed row, never the universe.
  {
    name: "daily-filing-rolling-window",
    schedule: "30 14 * * *", // 8:00 PM IST, every day
    jobType: JobTypes.FILING_ROLLING_DAILY,
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.FILING_ROLLING_DAILY,
        {},
        "cron:daily-filing-rolling-window",
        60,
      ).then(() => {}),
  },

  {
    name: "daily-alerts-eval",
    schedule: "0 15 * * 1-5", // 8:30 PM IST, Mon–Fri (≈1.5h after EOD prices → post-rescore)
    jobType: JobTypes.ALERTS_EVAL_DAILY,
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
    jobType: JobTypes.ALERTS_DELIVER_DAILY,
    // Drains what the eval pass recorded — a drain before the eval sends nothing.
    dependsOn: [JobTypes.ALERTS_EVAL_DAILY],
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
    jobType: JobTypes.REMINDERS_EVAL_DAILY,
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
    jobType: JobTypes.REMINDERS_DELIVER_DAILY,
    dependsOn: [JobTypes.REMINDERS_EVAL_DAILY],
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
    jobType: JobTypes.DEALS_DAILY_INGEST,
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
    jobType: JobTypes.EVENTS_WEEKLY_INGEST,
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
    jobType: JobTypes.EVENTS_DAILY_REFRESH,
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
    jobType: JobTypes.SHAREHOLDING_QUARTERLY,
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
    jobType: JobTypes.SHAREHOLDING_SMART_REFRESH,
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
    jobType: JobTypes.INSIDER_TRADES_DAILY,
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
    jobType: JobTypes.NSE_ANNOUNCEMENTS_INGEST,
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
    jobType: JobTypes.GOOGLE_NEWS_INGEST,
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.GOOGLE_NEWS_INGEST,
        { days: 7 },
        "cron:daily-google-news",
      ).then(() => {}),
  },
  // ── ⚠ NEWS CONTENT EXTRACTION — DELIBERATELY NOT SCHEDULED ──────────────────────────────────
  // `news-extraction-worker` (NEWS_CONTENT_EXTRACTION, batchSize 50, formerly 10:00 AM IST) was
  // removed from this list on 2026-07-26. Full article text is not wanted at the current ingest
  // volume: nothing in the app consumes `contentText`, and the publishers worth scraping block
  // AI crawlers by name in robots.txt anyway, so most attempts could only ever return the RSS
  // snippet we already store in `summary`.
  //
  // THE CODE IS INTACT — the job type, the dispatcher entry, `runContentExtractionWorker`, and
  // the admin trigger (POST .../news/extract) all still work. Re-enabling is re-adding an entry
  // here, not a rebuild. It is left registered on purpose so a one-off admin run stays possible.
  //
  // ⚠ IF YOU RE-ENABLE IT, KNOW THIS: the worker's queue is `extractionStatus: "pending"`, and the
  // 6,544 rows that were pending when it was switched off were re-marked "skipped" (an honest
  // "we chose not to extract" — the value the worker itself writes when it declines) precisely so
  // nothing reads "pending" and infers work that will never happen. Those rows will NOT be picked
  // up by a re-enabled worker. That is intended: they are historical, and stock_news retention
  // prunes at 90 days by published_at regardless.
  // ────────────────────────────────────────────────────────────────────────────────────────────

  // ── Peer Metrics ───────────────────────────────────────────
  {
    name: "monthly-peer-metrics",
    schedule: "30 1 5 * *", // 7:00 AM IST on the 5th of every month
    jobType: JobTypes.PEER_METRICS_COMPUTE_ALL,
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
    jobType: JobTypes.RESULTS_SCAN,
    gate: resultsScanShouldEnqueue,
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
      // ⚠ `hoursBack: 6` USED TO BE HERE AND IT WAS DEAD — the handler destructured it and echoed
      //   it into the job result without ever passing it to the scanner, so every run re-read every
      //   symbol's entire filing history. It is omitted now rather than corrected in place, so the
      //   window lives in exactly ONE place: DEFAULT_DISCOVERY_WINDOW_HOURS in scan.ts, next to the
      //   reasoning for its width. Pass an explicit hoursBack here only to deviate from that.
      await enqueueIfNotActive(
        JobTypes.RESULTS_SCAN,
        { mode: "universe" },
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
    jobType: null,
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
    jobType: null,
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
    jobType: JobTypes.BROKER_POLL_SYNC,
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
    jobType: null,
    enqueue: async () => {
      const r = await sweepDegradedSnapshots();
      console.log(
        `[Scheduler] scoring-degraded-snapshot-sweep: scanned=${r.scanned} degraded=${r.degraded} ` +
          `healed=${r.healed} honestSkipped=${r.honestSkipped}`,
      );
    },
  },

  // ── Behaviour rollup reconcile (Phase 1) ───────────────────
  // Nightly recompute of behavior_rollup's distributional JSON (tab/section) from raw attention
  // events, plus a safe stamp self-heal. Runs through the job queue like every other recurring job.
  // 18:40 UTC (00:10 IST) — after the three scoring sweeps (18:00–18:20) have settled, well clear of
  // the 21:30 UTC retention prune. Bounded by rollup size, not traffic; a re-run is idempotent.
  {
    name: "nightly-behavior-rollup-reconcile",
    schedule: "40 18 * * *",
    jobType: JobTypes.BEHAVIOR_ROLLUP_RECONCILE,
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.BEHAVIOR_ROLLUP_RECONCILE,
        {},
        "cron:nightly-behavior-rollup-reconcile",
      ).then(() => {}),
  },

  // ── Chat reader-profile distillation (Stage 5) ─────────────
  // Reads every QUIET chat session (last_message_at older than 6h) that has turns the distiller has not
  // seen, and folds it into that reader's profile. One model call + one quota unit per session, as a
  // system actor. Idempotent by watermark: a re-run over unchanged sessions selects nothing.
  //
  // 19:10 UTC (00:40 IST) — AFTER the behaviour reconcile (18:40) so the two nightly reader-context jobs
  // don't overlap, and well BEFORE the retention prune (21:30) which is the only other job that touches
  // chat_sessions. Nothing races it, and by that hour the day's conversations have long gone quiet.
  //
  // ⚠ The 6h quiescence is deliberately NOT the 24h sidebar resume window — see chat/profile.ts.
  // A conversation still in progress is simply picked up tomorrow, at no extra cost.
  {
    name: "nightly-chat-profile-distill",
    schedule: "10 19 * * *",
    jobType: JobTypes.CHAT_PROFILE_DISTILL,
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.CHAT_PROFILE_DISTILL,
        {},
        "cron:nightly-chat-profile-distill",
      ).then(() => {}),
  },

  // ── DAILY OPERATIONS HEALTH CHECK (Part 3) ─────────────────
  // Reads the last 24h of cron coverage, everything stuck, the retention rules' per-table
  // status, and 7 days of per-type reliability. Writes nothing but its own job row, whose
  // `result` IS the persisted report.
  //
  // 22:00 UTC (3:30 AM IST) — LAST in the nightly order, and the position is load-bearing.
  // It must run AFTER nightly-retention-prune (21:30) so it reads the SAME night's
  // per-table retention statuses rather than yesterday's, and after the whole 19:00–21:30
  // ingest/fold/prune block so a 24h window covers one complete cycle. 30 minutes is ample:
  // the prune measures p95 37s.
  //
  // ⚠ It is deliberately AFTER the thing it inspects rather than before. A health check
  //   scheduled first would report on a window it is standing in the middle of.
  {
    name: "daily-job-health-check",
    schedule: "0 22 * * *", // 3:30 AM IST, every day
    jobType: JobTypes.JOB_HEALTH_CHECK,
    enqueue: () =>
      enqueueIfNotActive(
        JobTypes.JOB_HEALTH_CHECK,
        {},
        "cron:daily-job-health-check",
        40, // ahead of default work: a report queued behind a 7-hour scan is a report nobody gets
      ).then(() => {}),
  },
];

// ── Retention pruner — NIGHTLY, 3:00 AM IST — LIVE AND ARMED ───
// ⚠️ This job DELETES production data irreversibly. It is registered ONLY when
// RETENTION_CRON_ARMED is true — which was flipped AFTER the first dry-run report
// was reviewed and signed off (cv2-scheduler-hazard). It is true today, so the
// nightly run is REGISTERED and FIRES, enqueuing RETENTION_PRUNE { dryRun: false }.
// To exercise the engine without deleting, use src/scripts/retention-dry-run.ts.
//
// 3:00 AM IST = 21:30 UTC — after daily-mf-analytics (1:30 AM IST) has long
// settled and hours before the 6:30 AM IST insider fetch. Nothing races it.
//
// Per-table safety is enforced in the POLICY, not here — the engine deletes only
// rows with retention_policy.armed = true. Read the live table; do not read this
// comment for a table's state.
//
// ⚠️ daily_prices IS ARMED — DO NOT READ THE OLD STEP-1 NOTE THAT SAID OTHERWISE.
//   Step 1 (2026-07-18) armed the 30 routine tables and deliberately HELD
//   daily_prices at armed=false for the Step-2 one-time 5.2y→4y mass correction.
//   Step 2 has since COMPLETED: src/scripts/retention-step2-execute.ts:106 flips
//   daily_prices.armed=true on a clean §13, and the live row reads armed=true with
//   its last write at 2026-07-18T03:35:17Z. The nightly now maintains daily_prices
//   at keep=1000 (floor 760) — the steady state that script predicted at ~424
//   rows/night, and the dry-run measures at 423 (423 stocks sitting at 1001 rows,
//   i.e. pruned to 1000 then one fresh bar).
//
//   ★ THAT ARMING WAS APPLIED OUTSIDE THE AUDITED PATH, so retention_policy_audit
//     holds NO row for it. Only the admin API (applyPolicyChange, controllers/admin/
//     retention-controller.ts:98) writes an audit row, in the same transaction as the
//     UPDATE; there is no DB trigger on retention_policy (verified against pg_trigger
//     — zero triggers), so a script's prisma.retentionPolicy.update, or a raw SQL
//     UPDATE, changes state silently. Both arming scripts take that unaudited route.
//     An absent audit row therefore does NOT mean a value never changed. Future policy
//     changes should go through the admin path so the trail stays honest.
//
// (Kill switch: UPDATE retention_policy SET armed=false, or set this flag back to
// false to stop the cron entirely.)
const RETENTION_CRON_ARMED = true;

const RETENTION_JOB: ScheduledJob = {
  name: "nightly-retention-prune",
  schedule: "30 21 * * *", // 3:00 AM IST (21:30 UTC), every day
  jobType: JobTypes.RETENTION_PRUNE,
  enqueue: () =>
    enqueueIfNotActive(
      JobTypes.RETENTION_PRUNE,
      { dryRun: false },
      "cron:nightly-retention-prune",
    ).then(() => {}),
};

// ── THE REGISTRY, AS DATA ─────────────────────────────────────
//
// Everything the scheduler will actually register, in one list, EXPORTED — so the daily
// health check derives "what was supposed to run" from the same objects that run it.
// That is the whole point: the monitor and the scheduler cannot disagree about the
// schedule, because there is only one schedule.
//
// ⚠ DO NOT re-declare this list anywhere. If a health report ever needs a cadence, it
//   reads `schedule` off these entries and parses it (lib/cron-expr.ts). A second copy is
//   how the comment drift this build spent Part 1 correcting begins.
export function scheduledJobRegistry(): readonly ScheduledJob[] {
  return RETENTION_CRON_ARMED ? [...SCHEDULED_JOBS, RETENTION_JOB] : [...SCHEDULED_JOBS];
}

/** Entries that create no background_jobs row, keyed by name — see ScheduledJob.jobType. */
export function inlineOnlyCronNames(): string[] {
  return scheduledJobRegistry().filter((j) => j.jobType === null).map((j) => j.name);
}

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
