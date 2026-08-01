-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WAS THIS SNAPSHOT GATE-SCREENED? — record whether Layer 1 (the guardrail gate) ran.
--
-- The guardrail gate is now wired into the scoring pass, but it deliberately does NOT run for every
-- snapshot: historical periods stay unscreened (one clean boundary, no screened/unscreened patchwork
-- across a trajectory), and the whole layer is behind an opt-in flag. That makes "was this particular
-- snapshot screened?" a real question with three possible answers — and it must be ANSWERABLE FROM
-- STATE, never inferred.
--
-- WHY INFERENCE DOES NOT WORK: the obvious proxy is "does this snapshot have score_guardrail_events
-- rows?". That is ambiguous in exactly the case that matters — ZERO events means either
--   · the gate ran and nothing fired (a clean stock, genuinely screened), or
--   · the gate never ran at all (not screened).
-- Those are opposite facts with identical evidence. A silent skip that reads as "all clear" is the
-- failure mode this column exists to make impossible.
--
-- THE THREE STATES ARE LOAD-BEARING AND MUST NOT BE NORMALISED:
--   · NULL  — this snapshot predates the column, or was written by a path that did not record the
--             fact. It means "we do not know whether this was screened", NOT "it wasn't".
--   · false — the gate was deliberately NOT run for this snapshot (opt-in flag off, or a historical
--             / point-in-time rescore, which is blocked from screening by design).
--   · true  — the gate RAN against this snapshot. Combined with zero guardrail events this reads as
--             "screened, nothing fired" — which is precisely the distinction NULL/false cannot make.
-- A read surface that collapses NULL into false would claim we know a snapshot was unscreened when we
-- do not. Keep them apart.
--
-- STRICTLY ADDITIVE — nullable, no DEFAULT, no backfill. Every one of the ~3.4k existing snapshot rows
-- keeps NULL ("we don't know"), which is the honest reading for rows written before the gate existed.
-- No existing row is UPDATEd (the append-only discipline on score_snapshots is preserved), and no
-- existing read path changes behaviour.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "score_snapshots"
  ADD COLUMN "guardrail_screened" BOOLEAN;

COMMENT ON COLUMN "score_snapshots"."guardrail_screened" IS
  'Did Layer-1 (the guardrail gate) run for this snapshot? NULL = unknown (predates the column or a path that did not record it); false = deliberately not screened (flag off, or a historical/PIT rescore); true = screened (zero guardrail events then means "nothing fired", not "never ran"). Never normalise NULL to false.';
