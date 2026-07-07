-- ═══════════════════════════════════════════════════════════════
-- PHS copy-only tiers (portfolio-spec 1.1, Change 2). Two nullable TEXT columns on the
-- existing portfolio_health_snapshot — STORAGE + Part B copy SELECTOR ONLY.
--   structure_tier  Starter | Building | Established   (from holding count N)
--   capital_tier    Modest  | Moderate | Substantial   (from total book value ₹)
-- HARD LOCK: nothing in the score reads these — the PHS is byte-identical with or without
-- them. ADDITIVE + NULLABLE: pre-1.1 rows keep NULL, no backfill needed. No existing
-- column is touched. APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "portfolio_health_snapshot" ADD COLUMN "structure_tier" TEXT;
ALTER TABLE "portfolio_health_snapshot" ADD COLUMN "capital_tier" TEXT;
