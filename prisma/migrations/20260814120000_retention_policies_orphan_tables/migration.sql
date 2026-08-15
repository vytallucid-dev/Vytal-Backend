-- ═══════════════════════════════════════════════════════════════
-- RETENTION REGISTRATION — three symbol/instrument-keyed tables that sat entirely
-- outside the retention system and grew forever. DATA-ONLY: three INSERTs into
-- `retention_policy`. No DDL, no schema.prisma change, no data table touched.
--
-- SHIP UNARMED — enabled=true, armed=false, the attention_events / relationship_events /
-- chat_sessions idiom:
--   enabled=true  → the row IS loaded and COUNTED every pass, so its projection is visible
--                   in /admin/retention and in the dry-run report. A disabled row is skipped
--                   entirely (not even counted), which would hide the very number this
--                   registration exists to surface.
--   armed=false   → COUNTED, NEVER DELETED, even inside a live run (a per-table dry-run).
--                   Nothing here can delete a row until an admin reviews the dry-run and
--                   arms it deliberately through /admin/retention. All three are expected
--                   to project ZERO deletions today; arming is a separate, later decision.
--
-- ⚠ FLOOR IS IRREVOCABLE THROUGH THE AUDITED ROUTE. The admin API can edit
--   keep|days|supersededDays|armed|enabled (controllers/admin/retention-controller.ts:20-24)
--   and NOTHING ELSE — `floor` can only ever be changed by another migration. So each
--   `floor` below is set at the MEASURED consumer requirement and each `keep` at the desired
--   ceiling: a low floor with a high keep stays tunable downward forever, whereas floor == keep
--   freezes a policy immutable-downward (index_prices sits at floor=keep=1250 today and cannot
--   be lowered without a migration). `floor_reason` is the only durable record of the read
--   site each floor was derived from, which is why every one below carries its file:line.
--
-- ⚠ WHAT IS DELIBERATELY NOT HERE:
--   · result_fetch_logs — an UPSERTED per-(stock, period) ledger, unique(stock_id, quarter,
--     fiscal_year), bounded by universe x periods rather than accumulating with time (~9k rows
--     at 504 stocks, ~45k at 2,500). Two of its consumers read it UNBOUNDED — the industry
--     taxonomy disagreement trail (seed/industry-types.ts:161-172, no time filter) and the
--     per-stock lifetime count (controllers/ingestion/results-scan-controller.ts:302) — and an
--     unbounded consumer admits no finite floor. A 90-day window would have deleted 5,642 of
--     9,051 rows (62.3%) on its first pass. NOT MANAGED, deliberately.
--   · corporate_events — deferred, no ruling yet.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260814120000_retention_policies_orphan_tables`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

-- ── SEED: depth_per_key (keep newest N per key; a stalled key keeps everything it has) ──
--
-- The engine ranks with row_number() OVER (PARTITION BY <key_cols> ORDER BY <order_col> DESC,
-- "id" DESC) and deletes rn > keep (retention/engine.ts:90-99) — so rn=1 is the LARGEST
-- order_col and the OLDEST end is what goes. Every order_col below is NOT NULL, which matters:
-- Postgres sorts NULLS FIRST under DESC, so a NULL would rank as if newest, survive forever,
-- and consume a keep slot that a real row needed.
--
-- ★ stock_findings partitions on (stock_id, rule_key) — TWO columns, NOT stock_id alone.
--   stock_id alone ranks a stock's 22 rules against EACH OTHER by period_end, so a rule whose
--   current row sits at an old period (S:FY19Q3, A:FY22) ranks last and is deleted first even
--   though every consumer still reads it as live. Measured at keep=24 on stock_id alone: 219
--   rows deleted, 127 of them a rule's SOLE current row. On (stock_id, rule_key) the live max
--   depth is 2 and no keep >= 2 deletes anything.
INSERT INTO "retention_policy"
  ("id","table_name","mode","key_cols","order_col","keep","floor","floor_reason","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text,'stock_findings','depth_per_key',ARRAY['stock_id','rule_key'],'period_end',8,2,
   'Standing resolution needs the CURRENT row AND the most-recent strictly-older row per (stock, rule) = depth 2. filing/read.ts:294 readNewlyStandingFilingDetail treats a second row for the pair as its "prior exists" test; filing/pass.ts:141 picks the latest row with period_end < this period to decide newly_standing vs continuing, and losing it would re-stamp newly_standing on every re-run. Every other consumer needs only the first row per (stock, rule) — filing/read.ts:150, :355, :399, scoring/read/screen.service.ts:265, relational/base-rates.ts:182, relational/reader-context.ts:383. keep 8 = two years of quarterly grain per rule.',
   true,false,CURRENT_TIMESTAMP),

  (gen_random_uuid()::text,'market_cap_tier_snapshot','depth_per_key',ARRAY['stock_id'],'as_of_date',36,1,
   'No consumer reads a second snapshot. portfolio/phs/assemble.ts:421 is findFirst orderBy asOfDate desc (one row); the two bulk readers, controllers/me/holdings-controller.ts:123 and controllers/me/watchlist-enrich.ts:303, both order asOfDate desc and keep the first row per stock ("first = latest"). Nothing computes a tier trend or a tier migration. Measured requirement is 1; keep 36 is three years of monthly headroom above it.',
   true,false,CURRENT_TIMESTAMP),

  (gen_random_uuid()::text,'instrument_prices','depth_per_key',ARRAY['instrument_id'],'date',1250,2,
   'controllers/me/holdings-controller.ts:137 reads SELECT DISTINCT ON (instrument_id) ... ORDER BY instrument_id, date DESC — the LATEST row per instrument only; the day-change comes from that same row''s prev_close COLUMN, not from a second row (portfolio/price-resolver.ts:107). The identical query appears in portfolio/phs/assemble.ts:239 and portfolio/history/live-value.ts:83. Measured requirement is 1; floor 2 is deliberately ONE ABOVE it so a correction landing on the prior day still has a row to land on (fill/error-resolution.ts:102 resolves a target by instrument_id + date). keep 1250 is the 5-year horizon at ~248 sessions/yr; floor is deliberately NOT mirrored to keep — see index_prices, frozen immutable-downward at floor = keep = 1250.',
   true,false,CURRENT_TIMESTAMP);
