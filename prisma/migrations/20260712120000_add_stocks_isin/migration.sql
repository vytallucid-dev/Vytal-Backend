-- ═══════════════════════════════════════════════════════════════
-- ISIN spine (Step 1.4) — prerequisite for the instrument catalog (Step 1.5).
-- Nullable-first: the constraint is tightened in a SEPARATE migration only after
-- the seed-CSV backfill proves 505/505 non-null with 0 duplicates (GATE 2/3).
-- Drift-safe apply: hand-authored SQL over DIRECT_URL, NOT migrate dev/deploy.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "stocks" ADD COLUMN "isin" TEXT;
