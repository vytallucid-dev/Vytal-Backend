-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- USER-DIRECTED MEMORY — stated memories on the EXISTING reader profile, not a parallel store.
--
-- ★ ONE TABLE, TWO PROVENANCES. `chat_reader_profile` already holds what the distiller INFERRED
-- (register, depth nudge, glossary gaps). This adds what the reader STATED outright. Keeping both on one
-- row is what makes "tell me what you remember" answerable in one read, and what lets deletion work
-- uniformly across the two — a reader who says "forget that I prefer Hinglish" is talking about an
-- inferred field, and one who says "forget the one about explanations" is talking about a stated one.
-- They must resolve through the same list or the feature is a lie by omission.
--
-- WHY JSONB AND NOT A CHILD TABLE. The list is hard-capped at 20 short strings — 4KB at absolute worst.
-- A child table would buy per-row indexing that nothing needs (there is exactly one consumer: read all
-- of them for one user) at the cost of a second place for "a reader's memory" to live. The `source`
-- field inside each item is what carries the provenance, so nothing is lost.
--
-- SHAPE of each item: { id, text, source: "stated", createdAt }
-- `source` is stored per-item even though every item in THIS column is "stated", because the read model
-- unifies these with the inferred fields into one list — and at that point every entry must be able to
-- say which it is, without the reader having to know which column it came from.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "chat_reader_profile"
  ADD COLUMN "stated_memories" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ★ THE CAP IS A CONSTRAINT, NOT A CONVENTION — same posture as the 8-gap ceiling beside it. At the cap
-- the tool asks the reader to remove one; it NEVER silently drops the oldest, because a memory the reader
-- explicitly asked for disappearing on its own is worse than being told the list is full.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_stated_memories_bounded_check"
  CHECK (jsonb_typeof("stated_memories") = 'array' AND jsonb_array_length("stated_memories") <= 20);
