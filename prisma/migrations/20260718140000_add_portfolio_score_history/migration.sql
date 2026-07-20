-- ═══════════════════════════════════════════════════════════════
-- PORTFOLIO SCORE HISTORY (Part A) — the daily "PHS over time" series.
--
-- A SIBLING of portfolio_health_snapshot, never a widening of it: one row per user per
-- day, upserted on (user_id, date) so the day's LATEST compute wins. The write is
-- best-effort and DECOUPLED from the score (see score-history.ts) — it can never fail a
-- snapshot write and never opens an error-tab row.
--
-- PURELY ADDITIVE: one new table + ONE retention_policy seed row. ALTERs no existing
-- table, touches no existing row. portfolio_health_snapshot, the score layer and the
-- 504-stock fingerprint are all untouched.
--
-- Managed from day one by the SAME generic retention engine (no special-casing): a
-- depth_per_key row, key user_id, order date, keep 1825 (≈5y), floor 30, ARMED. The
-- engine requires an `id` column (it deletes by id) — present below.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260718140000_add_portfolio_score_history`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE "portfolio_score_history" (
    "id"         TEXT             NOT NULL,
    "user_id"    TEXT             NOT NULL,
    "date"       DATE             NOT NULL,             -- the calendar day (IST close); no time component
    "phs"        INTEGER          NOT NULL,             -- composite Health (= snapshot.phs); only written for an evaluable book
    "quality"    INTEGER,                               -- sub-scores (nullable — for future lines / not-evaluable)
    "signals"    INTEGER,
    "coverage"   DOUBLE PRECISION,                      -- % of book covered (0..1)
    "created_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)     NOT NULL,             -- @updatedAt — Prisma sets it on every write

    CONSTRAINT "portfolio_score_history_pkey" PRIMARY KEY ("id")
);

-- One row per user per day — the upsert key. This unique index ALSO serves the read
-- (`where user_id order by date`) and the retention depth scan (partition by user_id,
-- order by date desc), so no separate secondary index is created.
CREATE UNIQUE INDEX "portfolio_score_history_user_id_date_key"
    ON "portfolio_score_history" ("user_id", "date");

-- FK to users — a deleted user's history vanishes with them (matches portfolio_health_snapshot).
ALTER TABLE "portfolio_score_history"
    ADD CONSTRAINT "portfolio_score_history_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── SEED: the retention policy row (depth_per_key, key user_id, keep 1825 ≈ 5y). ──
-- ARMED from day one (deliberate, spec-directed): a chart series is safe to prune, unlike
-- the conservative default (armed=false) the load-bearing tables ship with. floor 30 is
-- the hard minimum the engine clamps UP to — even a fat-fingered keep can never drop a
-- user below ~a month of history.
INSERT INTO "retention_policy"
  ("id","table_name","mode","key_cols","order_col","keep","floor","floor_reason","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text,'portfolio_score_history','depth_per_key',ARRAY['user_id'],'date',1825,30,
   'The PHS-over-time graph caps at a 5-year (1825-day) window per user',true,true,CURRENT_TIMESTAMP);
