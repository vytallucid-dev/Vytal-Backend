-- ═══════════════════════════════════════════════════════════════
-- RANK POOL SIZE (Stage 1) — publish the rank's DENOMINATOR.
--
-- applyRanks computes a rank over the POOL (bucket members with a non-null return that horizon), but
-- only rank_bucket_size (the WHOLE category) was ever persisted. So the only denominator on the wire
-- was the wrong one: "12 of 41" mixed "12th among funds we could measure" with "41 funds that exist".
--
-- These three columns carry the real denominator, one per horizon, paired 1:1 with rank_1y/3y/5y
-- (null exactly where the rank is null). rank_bucket_size is UNCHANGED — a different, true fact.
--
-- Nullable, no default. NO BACKFILL: the nightly fold rewrites every mf_analytics column, so tonight's
-- run fills these for every ranked scheme. Additive only — no existing column or row is touched.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260715140000_add_rank_pool_size`.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "mf_analytics"
    ADD COLUMN "rank_pool_1y" INTEGER,
    ADD COLUMN "rank_pool_3y" INTEGER,
    ADD COLUMN "rank_pool_5y" INTEGER;
