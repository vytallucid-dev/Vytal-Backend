-- ═══════════════════════════════════════════════════════════════
-- PORTFOLIO SCORE HISTORY — add Construction Net to the daily series.
--
-- PURELY ADDITIVE: one nullable column on the existing portfolio_score_history table.
-- No data touched, no other table touched, portfolio_health_snapshot untouched.
--
-- Nullable, and deliberately never backfilled: every row written before this column
-- existed carries NULL (honest "we didn't capture this yet"), never a fabricated 0 and
-- never reconstructed from portfolio_health_snapshot (that table is event-keyed —
-- multiple rows some days, zero on others — not a calendar series; backfilling from it
-- would assert a daily Construction history that was never actually computed).
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260719120000_add_score_history_structure`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "portfolio_score_history"
    ADD COLUMN "structure" INTEGER;  -- Construction Net 0–100, nullable — see schema.prisma
