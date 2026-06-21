-- Pond mask (File 1 §5 / File 2 §3.3) — the PG-level pond-heat signal denormalised onto every
-- member's ScoreSnapshot (a PGState property "inherited by every member"). Pure-price ~21d
-- trailing move of the pond; display-only modifier on the price-linked §5 cards (B/C1/D).
--
-- ADDITIVE + NULLABLE: existing snapshots go NULL = no-mask (the safe default the read layer
-- already treats as "pond not hot"); the daily price-driven rescore self-heals real values onto
-- new snapshot versions (same self-heal pattern as the C/D feed activation). No table rewrite
-- (nullable, no default) — a fast metadata-only change, safe to apply alongside the live worker.
--   mask_heat:            "hot" | "warm" | "calm" | NULL (not established — no member quorum)
--   pg_trailing_move_pct: signed pond median ~21d trailing return %, e.g. +12.4 / -17.5

-- AlterTable
ALTER TABLE "score_snapshots" ADD COLUMN     "mask_heat" TEXT,
ADD COLUMN     "pg_trailing_move_pct" DECIMAL(8,4);
