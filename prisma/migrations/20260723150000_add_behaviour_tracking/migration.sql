-- ═══════════════════════════════════════════════════════════════
-- BEHAVIOUR TRACKING (Phase 1) — two raw event tables + one durable rollup, plus the two
-- retention_policy rows that register the event tables with the existing pruner.
--
-- PURELY ADDITIVE: three new tables + two policy rows. ALTERs nothing, touches no existing row.
--
-- ⚠ THE POLICY ROWS SHIP enabled=true BUT armed=false. The engine will COUNT (so the projection
--   shows in /admin/retention) but NEVER DELETE until an admin arms them after reviewing the
--   dry-run — the same discipline daily_prices got. behavior_rollup gets NO policy row (kept
--   indefinitely).
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260723150000_add_behaviour_tracking`. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

-- ── attention_events (high volume; 60d retention) ──────────────────────────
CREATE TABLE "attention_events" (
    "id"         TEXT         NOT NULL,
    "user_id"    TEXT         NOT NULL,
    "stock_id"   TEXT         NOT NULL,
    "event_type" TEXT         NOT NULL,
    "detail"     TEXT,
    "dwell_ms"   INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attention_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attention_events_event_type_check"
        CHECK ("event_type" IN ('view', 'tab', 'section_expand', 'comparison', 'tool'))
);
CREATE INDEX "attention_events_user_id_stock_id_idx" ON "attention_events"("user_id", "stock_id");
CREATE INDEX "attention_events_created_at_idx" ON "attention_events"("created_at"); -- backs the retention pruner
ALTER TABLE "attention_events" ADD CONSTRAINT "attention_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attention_events" ADD CONSTRAINT "attention_events_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── relationship_events (low volume; 730d retention) ───────────────────────
CREATE TABLE "relationship_events" (
    "id"         TEXT         NOT NULL,
    "user_id"    TEXT         NOT NULL,
    "stock_id"   TEXT         NOT NULL,
    "event_type" TEXT         NOT NULL,
    "detail"     TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "relationship_events_event_type_check"
        CHECK ("event_type" IN ('watchlist_added', 'watchlist_removed', 'position_opened', 'position_closed', 'alert_set', 'alert_removed'))
);
CREATE INDEX "relationship_events_user_id_stock_id_idx" ON "relationship_events"("user_id", "stock_id");
CREATE INDEX "relationship_events_created_at_idx" ON "relationship_events"("created_at"); -- backs the retention pruner
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── behavior_rollup (durable; NO retention policy) ─────────────────────────
CREATE TABLE "behavior_rollup" (
    "id"                    TEXT         NOT NULL,
    "user_id"               TEXT         NOT NULL,
    "stock_id"              TEXT         NOT NULL,
    "view_count"            INTEGER      NOT NULL DEFAULT 0,
    "first_viewed_at"       TIMESTAMP(3),
    "last_viewed_at"        TIMESTAMP(3),
    "watchlist_added_at"    TIMESTAMP(3),
    "watchlist_removed_at"  TIMESTAMP(3),
    "position_opened_at"    TIMESTAMP(3),
    "position_closed_at"    TIMESTAMP(3),
    "alert_count"           INTEGER      NOT NULL DEFAULT 0,
    "tab_counts"            JSONB,
    "section_expand_counts" JSONB,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavior_rollup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "behavior_rollup_user_id_stock_id_key" ON "behavior_rollup"("user_id", "stock_id");
CREATE INDEX "behavior_rollup_user_id_idx" ON "behavior_rollup"("user_id");
ALTER TABLE "behavior_rollup" ADD CONSTRAINT "behavior_rollup_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "behavior_rollup" ADD CONSTRAINT "behavior_rollup_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RETENTION REGISTRATION — mode=time, ts_column=created_at, enabled=true, armed=false ────
-- Ship UNARMED: counted (projection visible in /admin/retention) but never deleted until an
-- admin reviews the dry-run and arms them. Modest floors — the durable behavior_rollup already
-- captured the signal, so raw events protect nothing critical; the floor is only a debugging tail.
INSERT INTO "retention_policy"
  ("id","table_name","mode","days","floor","floor_reason","ts_column","except_where","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text,'attention_events','time',60,7,'Attention events feed the durable behavior_rollup; raw rows are disposable once folded (floor 7d = debugging tail)','created_at',NULL,true,false,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'relationship_events','time',730,90,'Relationship events are the durable 2-year behavioural history the rollup is reconciled from (floor 90d)','created_at',NULL,true,false,CURRENT_TIMESTAMP);
