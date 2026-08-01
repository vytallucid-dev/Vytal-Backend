-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DECOUPLE THE GUARDRAIL AUDIT TRAIL FROM SCORE MOVEMENT.
--
-- THE BUG THIS CLOSES. score_guardrail_events.snapshot_id was NOT NULL, so an event could only be
-- written once a ScoreSnapshot existed. But persistMember returns early on `skipped_identical`
-- (score unchanged ⇒ no snapshot written) BEFORE reaching the event write. Detection therefore
-- survived only when something UNRELATED moved the score. First live run: 106 detections, 27
-- persisted. The two most consequential were among the 79 lost — B-1 (exceptional gain, HINDPETRO)
-- and A-2 (missing critical fields, NESTLEIND) — along with B-5 and 7 of 10 C-1 firings.
--
-- The failure mode is exactly backwards: a company inflating profit every quarter while its score
-- stays stable would never be logged once, because stability is precisely what suppressed the write.
--
-- THE SHAPE. Identity moves from (snapshot_id, signature_key) to (stock_id, snapshot_key,
-- signature_key). This is not a new invention — score_suppressions already does exactly this, for
-- exactly this reason (see gate.ts §ORDERING: the row must be able to exist before/without a
-- snapshot, so it is keyed by a period STRING, not an FK).
--
--   snapshot_key — the PERIOD ("FY27Q1"). Always known at gate time. Explicit, never inferred from
--                  "current": the universe legitimately spans two periods at once (FY27Q1 and
--                  FY26Q4 were both live on 2026-07-30), so "current" is ambiguous and unusable.
--   snapshot_id  — now PROVENANCE ONLY, nullable. Set only when THIS run created that snapshot.
--
-- WHAT snapshot_id IS DELIBERATELY NOT. It is never pointed at a PRE-EXISTING snapshot to satisfy
-- the old FK. That snapshot was not screened by this run, and pointing at it would imply it was —
-- corrupting guardrail_screened, which is the only reliable answer to "was this snapshot screened?".
-- NULL here means "no snapshot was written this run", which is a normal state, not a defect.
--
-- FK BEHAVIOUR CHANGES: ON DELETE CASCADE → ON DELETE SET NULL. An audit record must OUTLIVE the
-- snapshot it happened to accompany. Under CASCADE, retention pruning a superseded snapshot silently
-- destroyed the detection history attached to it — reintroducing the very coupling this migration
-- removes. Guardrail events are now reaped by their OWN age policy (seeded below, UNARMED).
--
-- BACKFILL POLICY — read carefully, the two halves are different:
--   · The 27 EXISTING rows get snapshot_key derived EXACTLY from their own snapshot's period_key via
--     the FK. This is not inference; it is reading the value the row already transitively had. The
--     guard below ABORTS the whole migration if even one row cannot be derived.
--   · The 79 LOST detections are NOT recreated. They were never observed at write time, and
--     fabricating them would be writing history we did not witness. They will be recorded naturally
--     on the next run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. snapshot_key: add nullable, derive exactly, then enforce NOT NULL ──
ALTER TABLE "score_guardrail_events" ADD COLUMN "snapshot_key" TEXT;

UPDATE "score_guardrail_events" e
   SET "snapshot_key" = s."period_key"
  FROM "score_snapshots" s
 WHERE s."id" = e."snapshot_id";

-- HARD GUARD: if any row's period could not be derived exactly, abort. Never guess a period —
-- a wrong period silently merges two quarters' detections under one identity.
DO $$
DECLARE undecided INT;
BEGIN
  SELECT COUNT(*) INTO undecided FROM "score_guardrail_events" WHERE "snapshot_key" IS NULL;
  IF undecided > 0 THEN
    RAISE EXCEPTION 'ABORT: % guardrail event(s) have no derivable period_key. Refusing to guess — investigate before re-running.', undecided;
  END IF;
END $$;

ALTER TABLE "score_guardrail_events" ALTER COLUMN "snapshot_key" SET NOT NULL;

-- ── 2. snapshot_id becomes nullable provenance ──
ALTER TABLE "score_guardrail_events" ALTER COLUMN "snapshot_id" DROP NOT NULL;

ALTER TABLE "score_guardrail_events" DROP CONSTRAINT "score_guardrail_events_snapshot_id_fkey";
ALTER TABLE "score_guardrail_events"
  ADD CONSTRAINT "score_guardrail_events_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "score_snapshots"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

-- ── 3. identity: (stock_id, snapshot_key, signature_key) ──
-- Mirrors score_suppressions' @@unique(stock_id, snapshot_key, metric_key). The write path is
-- get-or-create on this key, so re-running a pass never duplicates. That matters disproportionately
-- here: A-3 alone fires on 91 of 95 stocks, so a duplicate-per-run bug would bury the real signal.
DROP INDEX "score_guardrail_events_snapshot_id_signature_key_key";

CREATE UNIQUE INDEX "score_guardrail_events_stock_id_snapshot_key_signature_key_key"
  ON "score_guardrail_events" ("stock_id", "snapshot_key", "signature_key");

CREATE INDEX "score_guardrail_events_snapshot_key_signature_key_idx"
  ON "score_guardrail_events" ("snapshot_key", "signature_key");

COMMENT ON COLUMN "score_guardrail_events"."snapshot_key" IS
  'The PERIOD this detection belongs to (e.g. FY27Q1). Identity column, always set. Independent of whether any ScoreSnapshot was written — a detection is recorded whether or not the score moved.';
COMMENT ON COLUMN "score_guardrail_events"."snapshot_id" IS
  'Provenance only, nullable. Set ONLY when this run created that snapshot. NULL = no snapshot written this run (score unchanged / unavailable) — a normal state, NOT "unscreened". Never repointed at a pre-existing snapshot: that would imply it was screened when it was not.';

-- ── 4. RETENTION — reap by AGE, independent of snapshot lifetime ──
-- Seeded ARMED=false: counted in every dry-run projection, deletes nothing until deliberately armed.
-- (Note: 35 of the 36 existing policies are armed=true, so unarmed is a deliberate exception here,
--  not the house default — it exists so the projections can be reviewed first.)
--
-- WINDOW: 730 days, floor 365. Reasoning:
--   · The value of this trail is LONGITUDINAL. The motivating case — "is this company inflating
--     profit every quarter?" — needs several years of quarters to answer. A 30/90-day log window
--     would defeat the purpose of the fix.
--   · Volume is negligible and BOUNDED BY PERIOD, not by run: the new unique makes a rescore
--     get-or-create, so a stable universe yields ~106 rows per PERIOD (~424/yr), not per run.
--     730 days ≈ 850 rows.
--   · 730d matches relationship_events (the longest-lived non-price series); floor 365 guarantees a
--     full four quarters survive even if the window is later lowered.
INSERT INTO "retention_policy"
  ("id", "table_name", "mode", "key_cols", "order_col", "keep", "days", "superseded_days",
   "floor", "floor_reason", "except_where", "ts_column", "enabled", "armed", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'score_guardrail_events', 'time', '{}', NULL, NULL, 730, NULL,
   365, 'Guardrail detections are longitudinal evidence — a repeating quarterly distortion needs multiple years of quarters to be visible. Never fall below four quarters.',
   NULL, 'created_at', true, false, now(), now())
ON CONFLICT ("table_name") DO NOTHING;
