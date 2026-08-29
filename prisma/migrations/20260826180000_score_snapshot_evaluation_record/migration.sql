-- Record that a rescore LOOKED at a (stock, period), separately from whether it changed anything.
--
-- The skip-identical guard makes the daily rescore cheap and must stay. Its cost was that a run
-- which legitimately changes nothing leaves no trace it ran: finalizeRun stores only the count of
-- snapshots CREATED, so a fully-unchanged pass records 0 and, after the fact, "evaluated and
-- unchanged" is indistinguishable from "never looked at". That ambiguity is what made it impossible
-- to answer whether the 2026-08-26 workbook load had reached the scores.
--
-- Nullable on purpose. The 6,116 rows that predate this column have genuinely never been evaluated
-- under the new bookkeeping, and NULL says exactly that — backfilling a timestamp would assert an
-- evaluation that never happened.
ALTER TABLE "score_snapshots"
  ADD COLUMN IF NOT EXISTS "last_evaluated_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_evaluated_run_id" TEXT;

CREATE INDEX IF NOT EXISTS "score_snapshots_last_evaluated_at_idx"
  ON "score_snapshots" ("last_evaluated_at");
