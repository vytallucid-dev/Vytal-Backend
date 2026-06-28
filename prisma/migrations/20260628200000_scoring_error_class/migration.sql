-- Scoring error class: widen IngestionError to carry SCORING errors (source="scoring").
-- A scoring error is a SCORE that failed to compute/refresh properly even when the input
-- data is fine (Stage 1: a terminal-failed rescore job). Distinct from the ingestion
-- guards. ADDITIVE ONLY — new enum values + nullable columns; no existing column or row
-- is touched, so ingestion rows are byte-for-byte unaffected.

-- ── Enum widening (idempotent) ──
-- GuardType: the three scoring failure families (degraded/stale land in later stages,
-- added now so the enum migration is one-shot).
ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'scoring_job_failed';
ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'scoring_degraded';
ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'scoring_stale';
-- ResolutionPath: the rescore action (fill-then-rescore reuses admin_fill).
ALTER TYPE "ResolutionPath" ADD VALUE IF NOT EXISTS 'rescore';

-- ── Scoring-specific nullable columns (ingestion rows leave these NULL) ──
ALTER TABLE "ingestion_errors"
  ADD COLUMN IF NOT EXISTS "pg_id"              TEXT,
  ADD COLUMN IF NOT EXISTS "period_key"         TEXT,
  ADD COLUMN IF NOT EXISTS "failure_type"       TEXT,
  ADD COLUMN IF NOT EXISTS "degradation_detail" JSONB,
  ADD COLUMN IF NOT EXISTS "recompute_action"   TEXT,
  ADD COLUMN IF NOT EXISTS "triggering_job_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_id"        TEXT;
