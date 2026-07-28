-- ═══════════════════════════════════════════════════════════════
-- CHAT UNDELIVERED — persist the message a quota denial refused.
--
-- THE PROBLEM. When the spend gate denies, the controller returned an honest in-band `unavailable` and
-- PERSISTED NOTHING. So the reader's own typed question lived only in browser memory: refresh, and the
-- question, the "not sent" mark and the explanation all vanished, leaving a conversation that looks empty
-- and a session row titled "New conversation". One cause, three symptoms.
--
-- THE FIX. A denied user message is written like any other user message, plus four columns that say it
-- never went anywhere:
--   undelivered      — true ⇔ this row was refused before any model call. THE flag: the client renders
--                      the "not sent" mark from it, and loadHistoryForModel EXCLUDES these rows, so the
--                      model's history is byte-identical to what it was before this migration. The model
--                      never saw the message, and must not later believe it did.
--   denied_reason    — the gate's reason code (observability; e.g. user_daily_limit_reached).
--   denied_scope     — 'user' | 'global' | NULL: WHICH ceiling refused (personal vs system). Drives the
--                      wording, which is composed at READ time, never stored.
--   denied_reset_at  — the instant that ceiling clears.
--
-- ★ WHY A TIMESTAMP AND NOT THE SENTENCE. "Resets around 12:30 PM" is true for a few hours and wrong
--   forever after. Storing the instant lets every read decide for itself: still in the future → the
--   reader gets the time; already past → the denial renders in the past tense with no time at all. A
--   stored sentence could not do that, and a stored sentence attached to an ASSISTANT row would have been
--   worse still — it would have entered the model's own history as something it said.
--
-- The role CHECK is unchanged; a new CHECK pins the invariant that only a USER row can be undelivered
-- (an assistant row is by definition something that was generated and delivered).
--
-- PURELY ADDITIVE. One NOT NULL column with a false default and three nullable ones — every existing row
-- reads as delivered, which is what every existing row is. Reversible by dropping the four columns.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260728120000_add_chat_undelivered`. NEVER `migrate dev`. Dev only.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "chat_messages"
  ADD COLUMN "undelivered"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "denied_reason"   TEXT,
  ADD COLUMN "denied_scope"    TEXT,
  ADD COLUMN "denied_reset_at" TIMESTAMPTZ;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_undelivered_check"
  CHECK ("undelivered" = false OR "role" = 'user');

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_denied_scope_check"
  CHECK ("denied_scope" IS NULL OR "denied_scope" IN ('user', 'global'));
