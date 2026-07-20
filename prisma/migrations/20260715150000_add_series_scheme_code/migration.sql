-- ═══════════════════════════════════════════════════════════════
-- SERIES SCHEME CODE (Stage 2) — the code whose NAV series a fund's metrics were measured on.
--
-- The fold corrects an IDCW plan's metrics by inheriting its tier-matched Growth twin's figures, but
-- the twin's SCHEME CODE was never recorded — so /chart had no way to draw the same series the
-- metrics came from, and served a raw, sawtoothed NAV beside a corrected number. This column stores
-- the fold's own choice: self for a Growth plan / ETF, the twin's code for an inherited IDCW/Bonus
-- plan, NULL for a distribution decline. One stored fact — /chart reads it, never re-resolves.
--
-- Nullable, no default. NO BACKFILL: the nightly fold rewrites every mf_analytics column. Additive —
-- no existing column or row is touched.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260715150000_add_series_scheme_code`.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "mf_analytics"
    ADD COLUMN "series_scheme_code" TEXT;
