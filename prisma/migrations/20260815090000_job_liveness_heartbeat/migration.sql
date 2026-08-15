-- ═══════════════════════════════════════════════════════════════
-- JOB LIVENESS — the two columns the reaper is keyed on.
--
-- WHY THIS EXISTS. `background_jobs` had no way to answer "is this running row
-- alive?". The only liveness proxy was `now() - started_at`, and that cannot work:
-- a healthy results_scan measures p50 2.29h / p95 6.30h / max 14.55h, so any
-- started_at threshold wide enough to spare a live scan is far too wide to catch a
-- corpse. Measured consequence (11 Aug 2026): instrument_corporate_actions row
-- fd413806 sat in `running` for 2.74 days, and because enqueueIfNotActive skips on
-- pending|running, the 12 and 13 Aug ticks never ran at all.
--
-- ⚠ BOTH COLUMNS SHIP NULL/0 FOR EXISTING ROWS AND THAT IS DELIBERATE. There is NO
--   backfill of last_heartbeat_at from started_at. A backfill would make every row
--   that is running at deploy time instantly look stale by hours, and the timer
--   reaper would reclaim a LIVE job on the first tick after ship. NULL is read as
--   "claimed before this column existed" and is handled by the reaper's legacy
--   branch (boot-only, on the SAME 30-minute started_at rule the old
--   recoverAbandonedJobs used) — so the first deploy after this ships can only ever
--   touch rows that today's code would also have touched. The branch goes dead on
--   its own once every live row carries a heartbeat, which is one job-cycle later.
--
-- DDL ONLY. No row is read, written or deleted by this migration.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "background_jobs"
  ADD COLUMN "last_heartbeat_at" TIMESTAMP(3),
  ADD COLUMN "reclaim_count"     INTEGER NOT NULL DEFAULT 0;

-- The reaper's only query shape: WHERE status = 'running' AND last_heartbeat_at < cutoff.
-- `status` leads because it is the selective term — the running population is ~1 row deep
-- against ~12k total, so this stays a one-page index scan forever.
CREATE INDEX "background_jobs_status_last_heartbeat_at_idx"
  ON "background_jobs" ("status", "last_heartbeat_at");
