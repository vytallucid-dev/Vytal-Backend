-- ═══════════════════════════════════════════════════════════════
-- STEP 10+11 (OPTION B) — MF ANALYTICS: compute-and-discard.
--
-- THE WHOLE POINT: raw NAV NEVER PERSISTS. The nightly job streams the universe's
-- NAV history, folds it into per-scheme accumulators in memory, writes ONLY the small
-- derived results, and discards the raw series. There is NO nav_history table here, by
-- design — a persistent Layer C would have been ~26 M rows / ~2.5 GB (measured), against
-- a 500 MB free-tier ceiling with 114 MB of headroom.
--
-- TWO new tables. Nothing else changes. The 504 stocks, the 2 users and Step-9's 17,567
-- MF instrument rows are not touched by this DDL at all.
--
--   1. mf_analytics    — one row per AMFI scheme code. ~13,704 rows, ~8 MB.
--                        THE ONLY new object carrying computed numbers.
--   2. mf_fetch_logs   — the run-log. Step 9's AMFI ingest shipped as a MYSTERY CRON
--                        (no run-log, no admin route, no manual trigger, absent from
--                        PIPELINE_JOB_TYPES). This makes the whole MF pipeline a
--                        first-class, observable one, mirroring price_fetch_logs /
--                        index_fetch_logs exactly.
--
-- NO new job types here — BackgroundJob.type is a String, so mf_analytics_daily /
-- mf_inception_walk need no DDL.
-- NO new columns on `instruments` — the blank-NAV-wipe fix is a change to the upsert's
-- SET clause, not to the schema.
-- NO change to IngestionError — the recurring-fault dedup rides the existing
-- (open|resolved|ignored) status enum and the existing dedup index.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL via apply-migration-direct.ts, then
-- `prisma migrate resolve --applied 20260713140000_mf_analytics`.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. mf_analytics — the derived results. Keyed on the AMFI SCHEME CODE.
--
-- WHY scheme_code AND NOT isin: a scheme code IS the NAV series (Direct and Regular have
-- genuinely different NAVs, so per-scheme-code is the correct grain). Recon proved a code
-- groups at most the 2 ISINs of ONE plan (growth/payout + div-reinvest), which share a NAV.
-- Keying on ISIN would store the identical analytics twice for 3,863 codes.
--
-- HONEST-EMPTY IS THE DEFAULT: every metric is NULLABLE. A fund without 5 years of history
-- has ret_5y_cagr = NULL — never 0, never fabricated. `omissions` carries the REASON, so a
-- NULL is always explainable ("why is there no 5Y number for this fund?").
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "mf_analytics" (
    "scheme_code" TEXT NOT NULL,

    -- ── Provenance / freshness ──
    "as_of_date"     DATE NOT NULL,           -- the newest NAV date folded into this row
    "computed_at"    TIMESTAMP(3) NOT NULL DEFAULT now(),
    "nav_points"     INTEGER NOT NULL DEFAULT 0,  -- NAV observations folded. The honest-empty EVIDENCE.
    "window_from"    DATE,                    -- oldest NAV date seen in the fold
    "window_to"      DATE,                    -- newest NAV date seen in the fold

    -- ── RETURNS (fractions, NOT percents: 0.152345 = +15.2345%) ──
    -- Decimal(12,6): a fund up 100× over 20 y is 99.0 — comfortably inside. NULL = honest-empty.
    "ret_1m"              DECIMAL(12,6),
    "ret_3m"              DECIMAL(12,6),
    "ret_6m"              DECIMAL(12,6),
    "ret_1y"              DECIMAL(12,6),
    "ret_3y_cagr"         DECIMAL(12,6),
    "ret_5y_cagr"         DECIMAL(12,6),
    -- RULING ④: this is CAGR since the EARLIEST OBSERVED NAV, not since true inception.
    -- AMFI's history floor is ~2009, so for older funds these differ. earliest_nav_date is
    -- NOT NULL-able-away: the number is meaningless without it, and the API must render
    -- "since <earliest_nav_date>", NEVER "since inception".
    "ret_since_earliest_cagr" DECIMAL(12,6),

    -- ── RISK (annualised fractions) ──
    "vol_1y"           DECIMAL(10,6),
    "vol_3y"           DECIMAL(10,6),
    -- RULING ③: Sharpe/Sortino gate on TWO independent honest-empty conditions —
    -- (i) the fund's own NAV depth AND (ii) the risk-free series covering that horizon.
    -- index_prices carries only ~1 y of the G-Sec/1D-Rate index today, so 3Y/5Y are
    -- honest-empty until INDEX_PRICES_BACKFILL is re-run at days=1825.
    "sharpe_1y"        DECIMAL(10,6),
    "sharpe_3y"        DECIMAL(10,6),
    "sharpe_5y"        DECIMAL(10,6),
    "sortino_1y"       DECIMAL(10,6),
    "sortino_3y"       DECIMAL(10,6),
    -- Drawdowns are NEGATIVE fractions (-0.4231 = a 42.31% peak-to-trough fall).
    "max_drawdown_1y"  DECIMAL(10,6),
    "max_drawdown_3y"  DECIMAL(10,6),
    "max_drawdown_5y"  DECIMAL(10,6),

    -- ── ROLLING 1-YEAR RETURNS (folded from the 260-slot ring) ──
    "roll_1y_n"            INTEGER,         -- how many rolling windows were observable
    "roll_1y_min"          DECIMAL(12,6),
    "roll_1y_max"          DECIMAL(12,6),
    "roll_1y_avg"          DECIMAL(12,6),
    "roll_1y_pct_positive" DECIMAL(5,2),    -- 0.00–100.00

    -- ── CATEGORY RANK (RULING ②) ──
    -- Bucket = (normalised leaf category, plan_type), OPEN-ENDED + ACTIVE only.
    -- NULL bucket = deliberately unranked: close-ended/FMP, dormant, NULL plan_type (880
    -- funds — Step 9 refused to GUESS a plan, so we refuse to guess a BUCKET), or a bucket
    -- with <5 funds (11 buckets — a rank in a 4-fund pool is noise, not information).
    "rank_bucket"      TEXT,
    "rank_bucket_size" INTEGER,
    "rank_1y"          INTEGER,      -- 1 = best in bucket
    "rank_3y"          INTEGER,
    "rank_5y"          INTEGER,
    "pct_1y"           DECIMAL(5,2), -- percentile within bucket, 0.00–100.00 (100 = best)
    "pct_3y"           DECIMAL(5,2),
    "pct_5y"           DECIMAL(5,2),

    -- ── THE EARLIEST-NAV ANCHOR (RULING ④) ──
    -- Written ONCE by the one-time mf_inception_walk. The NIGHTLY job MUST NOT touch these
    -- two columns — its ON CONFLICT DO UPDATE deliberately omits them from the SET list.
    -- Decimal(18,8): the SAME precision as instruments.current_nav. NOT the house (12,2).
    "earliest_nav"      DECIMAL(18,8),
    "earliest_nav_date" DATE,

    -- ── HONEST-EMPTY LEDGER ──
    -- {"ret_5y_cagr":"insufficient_history: 412 pts, need >=1150",
    --  "sharpe_3y":"risk_free_series_covers_only_1y",
    --  "pct_1y":"bucket_too_small: 4 funds"}
    -- A NULL metric without an entry here would be an unexplained gap. This is what makes
    -- "honest-empty" auditable rather than merely absent.
    "omissions" JSONB,

    CONSTRAINT "mf_analytics_pkey" PRIMARY KEY ("scheme_code")
);

-- Ranking reads pull a whole bucket at once; freshness sweeps scan as_of_date.
CREATE INDEX "mf_analytics_rank_bucket_idx" ON "mf_analytics"("rank_bucket");
CREATE INDEX "mf_analytics_as_of_date_idx"  ON "mf_analytics"("as_of_date");

-- ─────────────────────────────────────────────────────────────
-- 2. mf_fetch_logs — the run-log (RULING ①(a)).
--
-- MIRRORS price_fetch_logs / index_fetch_logs: same columns, same status vocabulary,
-- same (date, discriminator) uniqueness. Invented nothing.
--
-- ONE table for the whole MF pipeline, discriminated by `job`, because the MF pipeline is
-- one pipeline with three jobs:
--     amfi_nav_daily    — Step 9's identity + current-NAV ingest (retro-fitted: it has had
--                         NO run-log since it shipped)
--     mf_analytics_daily— the nightly compute-and-discard fold
--     mf_inception_walk — the one-time earliest-NAV anchor walk
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "mf_fetch_logs" (
    "id"        TEXT NOT NULL,
    "run_date"  DATE NOT NULL,
    "job"       TEXT NOT NULL,                      -- amfi_nav_daily | mf_analytics_daily | mf_inception_walk
    "source"    TEXT NOT NULL DEFAULT 'amfi',
    "status"    TEXT NOT NULL,                      -- success | partial | failed  (same vocabulary as the siblings)

    -- Counters. `schemes_processed` / `rows_folded` are the memory-proof evidence:
    -- rows_folded is O(millions) while the job's heap stays O(schemes).
    "schemes_processed"  INTEGER NOT NULL DEFAULT 0,
    "rows_folded"        INTEGER NOT NULL DEFAULT 0,
    "analytics_written"  INTEGER NOT NULL DEFAULT 0,
    "faults"             INTEGER NOT NULL DEFAULT 0,

    -- What window this run actually folded (so a short/failed run is visible as short).
    "window_from" DATE,
    "window_to"   DATE,
    "pulls"       INTEGER NOT NULL DEFAULT 0,

    "duration_ms" INTEGER,
    "error"       TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "mf_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- One row per (day, job) — a same-day re-run UPDATES its row rather than piling up,
-- exactly as price_fetch_logs/index_fetch_logs do.
CREATE UNIQUE INDEX "mf_fetch_logs_run_date_job_key" ON "mf_fetch_logs"("run_date", "job");
CREATE INDEX "mf_fetch_logs_run_date_idx" ON "mf_fetch_logs"("run_date");
CREATE INDEX "mf_fetch_logs_job_created_at_idx" ON "mf_fetch_logs"("job", "created_at");
