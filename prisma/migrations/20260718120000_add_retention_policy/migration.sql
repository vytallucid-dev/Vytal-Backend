-- ═══════════════════════════════════════════════════════════════
-- RETENTION POLICY (Layer 1) — the config table the generic pruner reads.
--
-- ONE ROW PER MANAGED TABLE. Nothing is hardcoded in the engine: a limit change
-- is an UPDATE here, no deploy. A future admin UI (Layer 3) writes these rows —
-- which is exactly why the engine treats EVERY value as untrusted input and
-- clamps `keep`/`days`/`superseded_days` UP to `floor`, never below.
--
-- PURELY ADDITIVE: one new table + its seed. ALTERs no existing table, touches no
-- existing row. daily_prices, the score layer, PHS and the 504-stock fingerprint
-- are all untouched — a policy row is a DECLARATION, the prune is a separate,
-- dry-run-gated job that this migration does NOT run.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260718120000_add_retention_policy`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
--
-- GATE-0 GROUNDING BAKED IN (schema is the authority, not the size report):
--   · financial depth keys are (stock_id, result_type) — the REAL unique omitting
--     fiscal_year; result_type ∈ {standalone, consolidated} kept per-basis (LICI lesson).
--   · order_col is a DELIBERATE addition to the shape: depth mode needs a defined
--     "newest N" sort, and storing it here keeps the engine config-driven instead of
--     hardcoding report_date/date/as_on_date. report_date (non-null) — NOT fiscal_year
--     (a "FY24" string that mis-sorts).
--   · insider_trades ts = trade_date (created_at reclaims 0 — all backfilled recently);
--     NULL trade_date is spared by construction (NULL < cutoff is never true).
--   · block_deals ts = deal_date · fundamental_logs ts = uploaded_at (no created_at) ·
--     ingestion_errors ts = last_seen_at (not created_at = first-seen).
--   · result_fetch_logs is NOT here — it is a per-(stock,period) idempotency ledger
--     (@@unique(stock_id, quarter, fiscal_year)), not a per-run log; pruning it erases
--     the scanner's memory. Recorded in the NOT-managed set so its name can't re-add it.
--   · exemptions are NAMED predicates the engine owns (never free SQL from the table):
--       ai_summary_referenced  → spare stock_news rows referenced by an ai_summary
--       delivered_only         → prune delivered=true, SPARE delivered=false (unsent email)
--       resolved_or_ignored    → prune status in (resolved,ignored), SPARE open (triage queue)
--       terminal_jobs_only     → prune terminal jobs, SPARE pending/running (never mid-flight)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE "retention_policy" (
    "id"              TEXT         NOT NULL,
    "table_name"      TEXT         NOT NULL,                 -- physical target table
    "mode"            TEXT         NOT NULL,                 -- depth_per_key | time | supersede_chain
    "key_cols"        TEXT[]       NOT NULL DEFAULT '{}',    -- depth: grouping columns (the REAL unique key, minus the period)
    "order_col"       TEXT,                                  -- depth: the "newest N" sort column (report_date/date/as_on_date)
    "keep"            INTEGER,                               -- depth: keep newest N per key
    "days"            INTEGER,                               -- time: prune rows older than N days
    "superseded_days" INTEGER,                               -- supersede: prune non-head links older than N days
    "floor"           INTEGER      NOT NULL,                 -- THE HARD MINIMUM — engine clamps keep/days/superseded_days UP to this
    "floor_reason"    TEXT         NOT NULL,                 -- shown when a clamp fires
    "except_where"    TEXT,                                  -- NAMED exemption predicate (engine-known), nullable
    "ts_column"       TEXT,                                  -- time: which timestamp column
    "enabled"         BOOLEAN      NOT NULL DEFAULT true,    -- per-table kill switch
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "retention_policy_table_name_key" UNIQUE ("table_name"),
    CONSTRAINT "retention_policy_mode_check"
        CHECK ("mode" IN ('depth_per_key', 'time', 'supersede_chain')),
    -- Shape integrity per mode (belt-and-braces; the engine validates too):
    CONSTRAINT "retention_policy_depth_shape"
        CHECK ("mode" <> 'depth_per_key' OR ("keep" IS NOT NULL AND "order_col" IS NOT NULL AND array_length("key_cols",1) IS NOT NULL)),
    CONSTRAINT "retention_policy_time_shape"
        CHECK ("mode" <> 'time' OR ("days" IS NOT NULL AND "ts_column" IS NOT NULL)),
    CONSTRAINT "retention_policy_supersede_shape"
        CHECK ("mode" <> 'supersede_chain' OR "superseded_days" IS NOT NULL)
);

-- ── SEED: depth_per_key ─────────────────────────────────────────
INSERT INTO "retention_policy"
  ("id","table_name","mode","key_cols","order_col","keep","floor","floor_reason","updated_at")
VALUES
  (gen_random_uuid()::text,'daily_prices','depth_per_key',ARRAY['stock_id'],'date',1000,760,'Market A2 sub-component reads 756 trading days across all 504 stocks',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'index_prices','depth_per_key',ARRAY['index_name'],'date',1250,1250,'MF Sharpe/Sortino/alpha-beta read benchmark indices at the y5 (5-year) horizon',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'fundamentals','depth_per_key',ARRAY['stock_id','result_type'],'report_date',10,5,'Foundation pillar null-floor is 5 fiscal years',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'quarterly_results','depth_per_key',ARRAY['stock_id','result_type'],'report_date',20,8,'Momentum L3 needs 8 consecutive quarters',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'banking_fundamentals','depth_per_key',ARRAY['stock_id','result_type'],'report_date',10,2,'Banking foundation YoY needs 2 fiscal years',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'banking_quarterly_results','depth_per_key',ARRAY['stock_id','result_type'],'report_date',20,4,'Banking momentum M1 (NIM) needs 4 consecutive quarters',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'nbfc_fundamentals','depth_per_key',ARRAY['stock_id','result_type'],'report_date',10,5,'Foundation null-floor 5 fiscal years (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'nbfc_quarterly_results','depth_per_key',ARRAY['stock_id','result_type'],'report_date',20,8,'Momentum L3 8 quarters (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'life_insurance_fundamentals','depth_per_key',ARRAY['stock_id','result_type'],'report_date',10,5,'Foundation null-floor 5 fiscal years (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'life_insurance_quarterly_results','depth_per_key',ARRAY['stock_id','result_type'],'report_date',20,8,'Momentum L3 8 quarters (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'general_insurance_fundamentals','depth_per_key',ARRAY['stock_id','result_type'],'report_date',10,5,'Foundation null-floor 5 fiscal years (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'general_insurance_quarterly_results','depth_per_key',ARRAY['stock_id','result_type'],'report_date',20,8,'Momentum L3 8 quarters (not scored today; floor future-proofs)',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'shareholding_patterns','depth_per_key',ARRAY['stock_id'],'as_on_date',20,8,'Ownership baseline reads 8 consecutive trailing quarters',CURRENT_TIMESTAMP);

-- ── SEED: time (fixed calendar window on ts_column) ─────────────
INSERT INTO "retention_policy"
  ("id","table_name","mode","days","floor","floor_reason","ts_column","except_where","updated_at")
VALUES
  (gen_random_uuid()::text,'insider_trades','time',365,200,'Scoring reach = 90d before shareholding as-of date + filing lag (~200d); trade_date NULL is spared','trade_date',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'block_deals','time',365,200,'Scoring reach = 90d before shareholding as-of date + filing lag (~200d)','deal_date',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'stock_news','time',90,90,'News surface read window caps at 90 days','published_at','ai_summary_referenced',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'alert_events','time',90,30,'Fired-event log; an undelivered event is an unsent notification','fired_at','delivered_only',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'event_reminder_events','time',90,30,'Fired-event log; an undelivered event is an unsent notification','fired_at','delivered_only',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'ingestion_errors','time',30,7,'Open errors are the live triage queue and must never be pruned','last_seen_at','resolved_or_ignored',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'background_jobs','time',30,7,'Never delete a job mid-flight (pending/running spared)','created_at','terminal_jobs_only',CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'index_fetch_logs','time',30,7,'Per-run ingest log; only recent runs are read (newest-N paginated)','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'shareholding_fetch_logs','time',30,7,'Per-run ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'insider_trade_fetch_logs','time',30,7,'Per-day ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'deal_fetch_logs','time',30,7,'Per-day ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'price_fetch_logs','time',30,7,'Per-day ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'event_fetch_logs','time',30,7,'Per-run ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'news_fetch_logs','time',30,7,'Per-run ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'mf_fetch_logs','time',30,7,'Per-day ingest log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'fundamental_logs','time',30,7,'Upload log; ts column is uploaded_at (no created_at)','uploaded_at',NULL,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'peer_group_computation_logs','time',30,7,'Per-run compute log; newest-N paginated','created_at',NULL,CURRENT_TIMESTAMP);

-- ── SEED: supersede_chain (score layer) ─────────────────────────
INSERT INTO "retention_policy"
  ("id","table_name","mode","superseded_days","floor","floor_reason","updated_at")
VALUES
  (gen_random_uuid()::text,'score_snapshots','supersede_chain',60,60,'The 60-day daily snapshot series reads superseded (non-head) versions; every head is kept forever',CURRENT_TIMESTAMP);
