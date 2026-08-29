-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- score_snapshots_findings_evaluated_ck — scope it to the post-cutover era, and make it VALID.
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────────
-- The constraint was added as:
--     CHECK (findings_evaluated_at IS NOT NULL AND findings_fired_count IS NOT NULL
--            AND not_covered_count IS NOT NULL) NOT VALID
--
-- NOT VALID exempts EXISTING rows from validation — but it still enforces on every INSERT *and every
-- UPDATE*. So the 4,174 rows written before findings evaluation became mandatory are simultaneously
--   (a) not guaranteed to satisfy it, and
--   (b) IMMUTABLE — any UPDATE to them re-checks the new row version and is rejected with 23514.
--
-- MEASURED CONSEQUENCE: the armed `supersede_chain` retention policy has failed on EVERY run since it
-- was armed. Its first step nulls the chain pointer —
--     UPDATE score_snapshots SET supersedes_id = NULL WHERE supersedes_id IN (<targets>)
-- — which touches legacy rows and therefore throws. The failure was recorded as
-- `{"table":"score_snapshots","status":"error"}` inside the job result and nowhere else, so
-- 703 superseded rows sat unpruned past their 60-day window while the job reported "succeeded".
--
-- ── WHY A DATE SCOPE IS THE HONEST FIX ─────────────────────────────────────────────────────────────
-- The three columns cannot be backfilled truthfully: those snapshots genuinely never had findings
-- evaluated, and there is no non-NULL value for "this did not happen". The boundary is exact and was
-- measured, not guessed:
--     legacy (all three NULL) : 4,174 rows, created 2026-06-18 21:00:42 .. 2026-08-05 13:30:39
--     conforming              : 1,595 rows, created 2026-08-06 04:49:18 .. now
--     rows conforming BEFORE the last legacy row: 0   (the ranges do not overlap at all)
--     rows where the three columns disagree     : 0   (they are NULL together or set together)
--
-- The replacement is strictly STRONGER than what it replaces: VALID, so it actually guarantees the
-- invariant for every row written since the cutover, where NOT VALID guaranteed nothing for anyone.
-- And it stops punishing legacy rows for a rule that did not exist when they were written.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "score_snapshots" DROP CONSTRAINT IF EXISTS "score_snapshots_findings_evaluated_ck";

ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_findings_evaluated_ck"
  CHECK (
    "created_at" < TIMESTAMP '2026-08-06 00:00:00'
    OR (
      "findings_evaluated_at" IS NOT NULL
      AND "findings_fired_count" IS NOT NULL
      AND "not_covered_count" IS NOT NULL
    )
  );
