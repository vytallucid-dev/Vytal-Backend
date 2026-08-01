-- ═══════════════════════════════════════════════════════════════
-- RELATIONAL L4 (Overview Pattern Library) — one nullable column on behavior_rollup.
--
-- PURELY ADDITIVE: a single ADD COLUMN on an existing table. No new table, no index change,
-- no backfill, no ALTER of any existing column. Every existing behavior_rollup row keeps NULL.
--
-- WHY THIS COLUMN AND NOT A NEW `user_object_views` TABLE. The Overview library specifies a new
-- per-(reader, object) view table carrying viewCount / firstViewedAt / lastViewedAt / surfacesSeen /
-- lastViewedSnapshotGeneration. behavior_rollup ALREADY carries all of those (surfacesSeen lives as
-- tab_counts / section_expand_counts) EXCEPT the snapshot generation. Two tables over the same fact
-- is a compute-once violation, so we extend the rollup by exactly the one missing field.
--
-- WHAT IT HOLDS: the in-force ScoreSnapshot id (the "generation") for this stock at the instant the
-- reader last viewed it. The delta family (UD9, a later slice) reads it to decide "new snapshot since
-- you last looked". Stamped by the attention fold (foldAttentionBatch) on the same upsert that advances
-- last_viewed_at — the beacon owns view tracking; the relational READ never writes here. NULL ⇔ the
-- stock was unscored at view time (no snapshot) — honest-empty, never fabricated.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260725140000_add_last_viewed_snapshot_generation`.
-- NEVER `migrate dev` / `migrate deploy`. (See [[vytal-migration-drift]].)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "behavior_rollup"
  ADD COLUMN "last_viewed_snapshot_generation" TEXT;
