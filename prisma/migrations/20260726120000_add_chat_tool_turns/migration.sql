-- ═══════════════════════════════════════════════════════════════
-- CHAT TOOL TURNS (Stage 0, Phase B) — teach chat_messages to carry internal tool turns.
--
-- PURELY ADDITIVE: two nullable/defaulted columns on chat_messages. No existing row changes —
-- every current row is a normal turn, so `kind` back-fills to 'text' and `tool_payload` to NULL.
--
--   kind          — discriminates the turn:
--                     'text'        a normal user/assistant message (what exists today)
--                     'tool_call'   an ASSISTANT turn where the model requested tool calls
--                     'tool_result' a USER-role turn carrying ONE tool's output back to the model
--                   Tool turns are HIDDEN from the client transcript (serializeVisibleMessages) but
--                   REPLAYED into the model's history (loadHistoryForModel), exactly like the
--                   isOpening grounded scaffolding — the same hidden-but-real precedent.
--   tool_payload  — jsonb: the AiToolCall[] for a tool_call, the AiToolResult for a tool_result,
--                   NULL for a text turn.
--
-- The role CHECK is UNCHANGED (still user|assistant): a tool_call is role assistant, a tool_result
-- is role user — there is no "tool" role, matching the neutral AiMessage model.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260726120000_add_chat_tool_turns`. NEVER `migrate dev`. Dev only.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "chat_messages"
  ADD COLUMN "kind"         TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN "tool_payload" JSONB;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_kind_check" CHECK ("kind" IN ('text', 'tool_call', 'tool_result'));
