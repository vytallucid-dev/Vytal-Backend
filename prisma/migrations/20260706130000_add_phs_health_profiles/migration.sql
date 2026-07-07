-- ═══════════════════════════════════════════════════════════════
-- PHS health-read enrichments (portfolio-spec 1.2, Change 4/5). Two nullable JSONB columns
-- on the existing portfolio_health_snapshot — computed at snapshot time over the SCORED
-- holdings:
--   pillar_profile  { foundation, momentum, market, ownership } | NULL  (position-weighted
--                   pillar means over scored weight — where the quality comes from)
--   lens_profile    { absolute, peer, trend } | NULL  (findings-CHARACTER share of fired
--                   lens patterns by nature — NEVER score attribution)
-- ADDITIVE + NULLABLE: pre-1.2 rows keep NULL, no backfill. No existing column is touched
-- (the 1.2 ceiling retirement reuses the kept phs_raw/ceiling_* columns as NULL/false — no
-- drop). APPLIED via the drift-safe db-execute + migrate-resolve path ([[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "portfolio_health_snapshot" ADD COLUMN "pillar_profile" JSONB;
ALTER TABLE "portfolio_health_snapshot" ADD COLUMN "lens_profile" JSONB;
