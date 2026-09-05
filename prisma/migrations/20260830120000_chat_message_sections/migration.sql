-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CHAT MESSAGE SECTIONS — the rendered answer, persisted. Stage 8b.
--
-- ★ ADDITIVE ONLY. Two nullable columns and two CHECKs. No column is dropped, no column is rewritten,
--   no row is touched. Every existing row stays exactly as it is with both columns NULL, which the
--   read path already treats as "render `content`" — the behaviour before this migration.
--
-- ★ WHY A VERSION COLUMN AND NOT JUST A KEY INSIDE THE JSON. The version lives in the envelope too,
--   but a later migration will need to ask "how many rows are still at v1" and act on the answer.
--   That question against a jsonb key is a full scan; against a smallint column it is an index.
--
-- ⚠ THE TWO CHECKS ARE THE POINT, NOT DECORATION.
--   1. sections and sections_version travel together. A payload with no version is unreadable by any
--      future renderer — it cannot know which assumptions to apply — and a version with no payload is
--      a row claiming a structure it does not have.
--   2. only an assistant row may carry sections. A user turn has no rendered answer; a tool turn is
--      internal. Allowing either would let a transcript replay a reader's own words as a component.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "chat_messages"
  ADD COLUMN "sections"         jsonb,
  ADD COLUMN "sections_version" integer;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sections_versioned_check"
  CHECK (("sections" IS NULL) = ("sections_version" IS NULL));

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sections_assistant_only_check"
  CHECK ("sections" IS NULL OR "role" = 'assistant');

-- Partial index: only rows that HAVE sections are worth indexing, and they are the minority.
CREATE INDEX "chat_messages_sections_version_idx"
  ON "chat_messages" ("sections_version")
  WHERE "sections_version" IS NOT NULL;
