-- ═══════════════════════════════════════════════════════════════
-- Watchlist favorite — the two-tier star. Additive, single column, non-null with a
-- FALSE default so every existing pin backfills to "not favorited" (no data touched
-- otherwise). Toggled via PATCH /me/watchlist/:stockId { favorite }.
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "watchlist"
    ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
