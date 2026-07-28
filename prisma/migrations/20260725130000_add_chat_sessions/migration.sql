-- ═══════════════════════════════════════════════════════════════
-- CHAT (Stage 2) — the conversation engine's two tables + one retention_policy row.
--
-- PURELY ADDITIVE: two new tables + one policy row. ALTERs nothing, touches no existing row.
--
-- chat_sessions  — one row per conversation. `origin` drives the one-way visibility (a discuss
--                  session only becomes chat-page history once `promoted`). `subject_*` are
--                  DENORMALIZED (no FK to stocks): a session is bound to a symbol string for list
--                  display + re-grounding, and survives a stock rename/removal as honest history.
-- chat_messages  — one row per turn, cascade-deleted with the session (so pruning a session removes
--                  its messages; chat_messages needs no policy row of its own).
--
-- ── RETENTION: mode=time, ts_column=last_message_at, days=1, except_where='unpromoted_only' ────────
-- Prunes ONLY unpromoted, abandoned discuss openings (the user saw the opening exchange and never
-- followed up), older than 1 day by last_message_at. The `unpromoted_only` exemption (added to
-- src/retention/policy.ts EXEMPTIONS in the same change) appends `AND "promoted" = false`, so a
-- promoted session — permanent chat-page history — is structurally exempt. Ships enabled=true BUT
-- armed=false: the nightly pruner COUNTS it (projection visible in /admin/retention) but NEVER
-- deletes until an admin reviews the dry-run and arms it, exactly like the behaviour tables.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260725130000_add_chat_sessions`. NEVER `migrate dev`. Dev only.
-- ═══════════════════════════════════════════════════════════════

-- ── chat_sessions ──────────────────────────────────────────────────────────
CREATE TABLE "chat_sessions" (
    "id"              TEXT         NOT NULL,
    "user_id"         TEXT         NOT NULL,
    "origin"          TEXT         NOT NULL,
    "surface"         TEXT,
    "subject_kind"    TEXT,
    "subject_symbol"  TEXT,
    "subject_name"    TEXT,
    "title"           TEXT         NOT NULL,
    "title_source"    TEXT         NOT NULL DEFAULT 'derived',
    "promoted"        BOOLEAN      NOT NULL DEFAULT false,
    "as_of_snapshot"  TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_sessions_origin_check"       CHECK ("origin" IN ('discuss', 'chat_page')),
    CONSTRAINT "chat_sessions_title_source_check" CHECK ("title_source" IN ('derived', 'model', 'user')),
    CONSTRAINT "chat_sessions_subject_kind_check"
        CHECK ("subject_kind" IS NULL OR "subject_kind" IN ('stock', 'portfolio', 'comparison', 'finding'))
);
-- The chat-page list + the sidebar resume probe (a user's sessions, newest activity first).
CREATE INDEX "chat_sessions_user_id_last_message_at_idx" ON "chat_sessions"("user_id", "last_message_at" DESC);
-- Backs the retention pruner (WHERE last_message_at < cutoff AND promoted = false).
CREATE INDEX "chat_sessions_last_message_at_idx" ON "chat_sessions"("last_message_at");
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── chat_messages ──────────────────────────────────────────────────────────
CREATE TABLE "chat_messages" (
    "id"                TEXT         NOT NULL,
    "session_id"        TEXT         NOT NULL,
    "role"              TEXT         NOT NULL,
    "content"           TEXT         NOT NULL,
    "is_opening"        BOOLEAN      NOT NULL DEFAULT false,
    "prompt_tokens"     INTEGER,
    "output_tokens"     INTEGER,
    "cached_tokens"     INTEGER,
    "model_version"     TEXT,
    "guardrail_blocked" BOOLEAN      NOT NULL DEFAULT false,
    "regenerated"       BOOLEAN      NOT NULL DEFAULT false,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);
-- The per-session transcript read, in order.
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RETENTION REGISTRATION — enabled=true, armed=false (counted, never deleted until armed) ────────
INSERT INTO "retention_policy"
  ("id","table_name","mode","days","floor","floor_reason","ts_column","except_where","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text,'chat_sessions','time',1,1,
   'Unpromoted discuss sessions are abandoned openings (opening exchange seen, never followed up); promoted sessions are permanent chat-page history, spared by the unpromoted_only exemption. Floor 1d = the sidebar''s own 24h resumability window.',
   'last_message_at','unpromoted_only',true,false,CURRENT_TIMESTAMP);
