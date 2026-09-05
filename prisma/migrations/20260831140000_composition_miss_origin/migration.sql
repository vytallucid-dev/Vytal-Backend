-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- T-0b · `origin` — make a harness row SAY it is a harness row.
--
-- ── ★ WHY, WHEN TWO GUARDS ALREADY WORK ───────────────────────────────────────────────────────────
-- T-0's first live day put 7 rows in this table, and 4 of them were `verify:harness` driving the
-- matrix through the lexical classifier — the same question ("TCS") the model path had recorded once.
-- Read naively, "TCS" looked like it had been asked five times.
--
-- Two guards already prevented that misreading: the report's `modelOnly` default excludes lexical
-- rows (§6.5), and the question ranking sorts on DISTINCT READERS, which counts an anonymous harness
-- row as zero. Both held. But both work by ACCIDENT OF THE RANKING rather than by the row saying what
-- it is: a harness run that happened to route through the MODEL classifier, or to run authenticated,
-- would pass straight through both and land in the evidence as demand.
--
-- ⚠ AND THE ALTERNATIVE WAS REJECTED ON THIS TABLE'S OWN TERMS. The cheap fix is to skip the write
--   when NODE_ENV says test. A log that behaves differently under test is a log that lies — it would
--   make the table silently incomplete in exactly the environment where someone is checking whether
--   it works. An explicit column keeps every row and lets the READ decide.
--
-- ── ★ NOT NULL, NO DEFAULT — DELIBERATE ───────────────────────────────────────────────────────────
-- A DEFAULT would let a future write path acquire `origin = 'reader'` by saying nothing, which is the
-- failure this column exists to prevent. With no default, a writer that does not state an origin
-- fails at the database. `recordMiss` resolves it from one place (see miss-log.ts) so no call site
-- has to know.
--
-- ── ★ THE BACKFILL IS A RECORDED FACT, NOT AN INFERENCE ───────────────────────────────────────────
-- ⚠ THIS IS THE ONE THING TO CHECK BEFORE TRUSTING THIS MIGRATION. Stamping pre-existing rows would
--   normally be exactly the defect the T-0 recon found in the pledge parser — `pledged_shares = 0`
--   written where the filing said NOTHING, absence coerced to a value. That is not what this is.
--
--   `composition_misses` was CREATED BY THE PREVIOUS MIGRATION, hours before this one
--   (20260831120000, finished 2026-08-31T15:30:06Z). Every row it holds was written between 15:46
--   and 15:52 the same day, by two identified processes and no others:
--     · 3 rows · tmp/t0/10-write-turns.ts   — the T-0 verification script (source = model)
--     · 4 rows · npm run verify:harness     — the matrix, lexical classifier (source = lexical)
--   No reader has ever reached this table; the endpoint and the log were built today. Measured
--   immediately before writing this migration: 7 rows, all inside that window. So "every row that
--   predates this column is harness" is a COMPLETE and CHECKABLE statement about this database, not
--   a guess about what the absent column would have said.
--
--   On any database where that is not true, the table is empty and the UPDATE touches zero rows.
--
-- ── ★ ADDITIVE AND DRIFT-SAFE ─────────────────────────────────────────────────────────────────────
-- One ADD COLUMN, one UPDATE of rows this migration's predecessor created, one SET NOT NULL, one
-- CHECK, one INDEX. No table is renamed or dropped; no other table is touched at all. Every statement
-- is IF NOT EXISTS / idempotent-by-predicate, so a re-run is a no-op.
--
-- Apply: `tsx src/scripts/apply-migration-direct.ts 20260831140000_composition_miss_origin`
-- (BEGIN/COMMIT over DIRECT_URL), then `prisma migrate resolve --applied 20260831140000_composition_miss_origin`,
-- then `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · The column, nullable for the length of this transaction only ───────────────────────────────
ALTER TABLE "composition_misses" ADD COLUMN IF NOT EXISTS "origin" TEXT;

-- ── 2 · Back-stamp the pre-column rows. See the header for why this is a fact, not an inference. ───
UPDATE "composition_misses" SET "origin" = 'harness' WHERE "origin" IS NULL;

-- ── 3 · Close it. No DEFAULT: a writer that does not state an origin must fail, not inherit one. ──
ALTER TABLE "composition_misses" ALTER COLUMN "origin" SET NOT NULL;

-- ── 4 · The closed vocabulary, like `branch` and `source` before it ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'composition_misses_origin_ck') THEN
    ALTER TABLE "composition_misses"
      ADD CONSTRAINT "composition_misses_origin_ck" CHECK ("origin" IN ('reader', 'harness'));
  END IF;
END $$;

-- ── 5 · The read this column exists to make cheap: reader rows, newest first ───────────────────────
CREATE INDEX IF NOT EXISTS "composition_misses_origin_created_at_idx"
  ON "composition_misses" ("origin", "created_at" DESC);

COMMENT ON COLUMN "composition_misses"."origin" IS
  'reader | harness. Resolved by recordMiss from MISS_LOG_ORIGIN / setMissLogOrigin(), never passed by a composition. Harness rows are KEPT, not skipped — a log that behaves differently under test is a log that lies — and excluded at READ time by default. ⚠ KNOWN GAP: a browser harness driving the running server over HTTP is indistinguishable from a reader at the server and records ''reader''; this column covers in-process harness runs, which is where every observed contamination came from.';
