-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WIDEN THE STATED-MEMORY CAP: 20 → 30, to match `MEMORY_MAX` in code.
--
-- ⚠ THIS FIXES A SILENT DRIFT, NOT A CAPACITY PROBLEM. `MEMORY_MAX` (src/chat/memory.ts) was raised to
-- 30 deliberately; this CHECK stayed at 20 from 20260727140000_add_stated_memories. The code cap is the
-- one that produces the FRIENDLY refusal ("I'm already holding the maximum of 30 … tell me which to
-- forget"), and it can only fire if it is the LOWER of the two. At 20 vs 30 the database won the race,
-- so a reader's 21st memory came back as a raw 23514 constraint violation — a 500 where the whole point
-- of the cap was a sentence to a person. Measured: it is what broke verify-memory-live-chat LIVE 7.
--
-- ★ THE INVARIANT, STATED SO THE NEXT EDIT CANNOT MISS IT:
--
--        jsonb_array_length(stated_memories) <= N   HERE   ===   MEMORY_MAX = N   in src/chat/memory.ts
--
-- The DB constraint is the BACKSTOP (it must never be the first to fire); `MEMORY_MAX` is the POLICY.
-- They must be equal — not merely compatible — because a DB cap ABOVE the code cap is dead weight that
-- silently stops being enforced, and a DB cap BELOW it is this bug. Changing either one alone is a bug
-- both times, which is why `verifyMemoryCapMatchesDatabase()` (src/chat/memory.ts) reads this very
-- constraint back out of pg_constraint and asserts the two numbers agree.
--
-- SAFE BY INSPECTION AT WRITE TIME: checked before authoring — 1 profile row, longest list 0 items,
-- nothing over 30, every value a JSON array. WIDENING a CHECK can never reject a row the narrower one
-- accepted, so the recreate cannot fail on existing data; the pre-check is belt for the assumption that
-- the OLD constraint was actually in force.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- Drop and recreate rather than ALTER: Postgres has no "alter the predicate of a CHECK". Both statements
-- run inside the applier's single transaction, so there is no window in which the column is unconstrained.
ALTER TABLE "chat_reader_profile"
  DROP CONSTRAINT IF EXISTS "chat_reader_profile_stated_memories_bounded_check";

-- ★ SAME NAME, DELIBERATELY. `verifyMemoryCapMatchesDatabase()` looks the constraint up BY NAME, and a
-- rename would turn the drift guard into a "constraint not found" failure instead of a cap comparison.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_stated_memories_bounded_check"
  CHECK (jsonb_typeof("stated_memories") = 'array' AND jsonb_array_length("stated_memories") <= 30);
