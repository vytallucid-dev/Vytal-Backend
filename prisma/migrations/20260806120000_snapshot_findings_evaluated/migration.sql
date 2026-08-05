-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- THE SNAPSHOT-HAS-FINDINGS INVARIANT — a positive witness that the findings pass ran against THIS
-- ScoreSnapshot version, enforced at the storage layer for every new row.
--
-- ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────────
-- score_patterns / score_red_flags FK a snapshot ID, so a fired set belongs to ONE version. A rescore
-- that supersedes v(n) → v(n+1) must therefore re-evaluate and re-attach: the prior set stays on the
-- now-superseded row, and the new head serves whatever this run wrote to it — nothing, if it wrote
-- nothing. GLENMARK went blank exactly this way: a price moved, a new head was written, its patterns
-- stayed behind on v(n). The daily Market pass writes ~93 new versions a trading day, so any path
-- that can skip the evaluation reproduces this for whichever stocks moved, every day.
--
-- ── WHY COUNTING score_patterns CANNOT SUBSTITUTE FOR THIS ────────────────────────────────────────
-- Absence of rows is ambiguous in precisely the case that matters. Zero rows means either
--   · the rules RAN against this version and nothing fired  — a true reading, worth stating; or
--   · the rules NEVER RAN against this version              — a blank card that silently asserts
--     the first, which is a false statement to a user.
-- Three of the 95 current in-force heads have zero pattern rows. Without a witness there is no query
-- that can tell those two populations apart — not after the fact, and not at write time.
--
-- ── THE COLUMNS ───────────────────────────────────────────────────────────────────────────────────
--   findings_evaluated_at  when the §2/§5 rule set + not-covered match engine ran, for the member
--                          whose composite this row stamps. Set in the SAME INSERT as the snapshot.
--   findings_fired_count   how many FiredFindings that evaluation produced (post-dampening). 0 is a
--                          positive, meaningful value: evaluated, nothing fired.
--   not_covered_count      how many tested-not-shipped configurations matched. Same discipline.
--
-- ── WHY `NOT VALID` ───────────────────────────────────────────────────────────────────────────────
-- 4,174 existing score_snapshots rows predate the witness. Backfilling a timestamp onto them would
-- assert something we cannot know — most were written by paths that genuinely did not evaluate
-- (2,809 post_ingest + 495 manual_api rows carry a NULL not_evaluable, the incidental witness this
-- column replaces). NOT VALID grandfathers them as honest NULLs while enforcing the constraint on
-- every INSERT and UPDATE from here on. Do NOT run VALIDATE CONSTRAINT — it would fail, correctly.
--
-- This is the guard of last resort, underneath the type-level one (persistMember accepts only an
-- EvaluatedMember) and the runtime one (it re-checks the stamp against this version's fingerprint).
-- Its job is the write path nobody has written yet.
--
-- SCORE-NEUTRAL: no score, band, magnitude, pillar or fired finding changes. Existing rows untouched.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "score_snapshots"
  ADD COLUMN "findings_evaluated_at" TIMESTAMP(3),
  ADD COLUMN "findings_fired_count"  INTEGER,
  ADD COLUMN "not_covered_count"     INTEGER;

ALTER TABLE "score_snapshots"
  ADD CONSTRAINT "score_snapshots_findings_evaluated_ck"
  CHECK (
    "findings_evaluated_at" IS NOT NULL
    AND "findings_fired_count" IS NOT NULL
    AND "not_covered_count" IS NOT NULL
  ) NOT VALID;

-- The invariant query. Every in-force head must be evaluated; anything this returns is a head that
-- serves an unknown findings state. Legacy (pre-column) rows are expected here until they supersede.
COMMENT ON CONSTRAINT "score_snapshots_findings_evaluated_ck" ON "score_snapshots" IS
  'A ScoreSnapshot version may not be committed without its findings + not-covered pass having run against it. NOT VALID: pre-2026-08-06 rows are grandfathered as honest NULLs.';
