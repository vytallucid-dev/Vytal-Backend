-- ═══════════════════════════════════════════════════════════════
-- DROP THE FOUR AI "CARD" CACHE TABLES.
--
-- AI card generation was removed: insight cards move to a deterministic pattern library, and AI is
-- retained ONLY for the chat surface (built next). These four write-through caches served the deleted
-- POST /api/v1/me/stocks/:symbol/explanation, .../insight and /portfolio/explanation endpoints.
--
-- All FKs on these tables are OUTBOUND (children of stocks/users); nothing in the schema references
-- them, so DROP TABLE removes each table's own FK constraints, unique keys and indexes. CASCADE is
-- belt-and-suspenders. No inter-table FKs, so ordering is immaterial.
--
-- ⚠ DELIBERATELY UNTOUCHED: ai_usage_counters (the quota gate — KEEP) and ai_summaries (pre-existing
--   news-shaped scaffolding with a live m2m to stock_news; never ours to drop).
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260725120000_drop_ai_card_tables`. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "ai_stock_insights_personal" CASCADE;
DROP TABLE IF EXISTS "ai_stock_insights"          CASCADE;
DROP TABLE IF EXISTS "ai_portfolio_explanations"  CASCADE;
DROP TABLE IF EXISTS "ai_explanations"            CASCADE;
