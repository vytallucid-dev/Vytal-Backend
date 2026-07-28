-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- STAGE 5 · THE CHAT READER PROFILE — the distilled, bounded "how to explain to this reader" record.
--
-- ONE ROW PER USER. Deliberately NOT per-(user, stock): that is behavior_rollup's key, and merging the
-- two would mean either a profile duplicated across every stock row or a rollup row with a null stock —
-- the "one fact, two homes" shape the ODL rules against. They are siblings that converge only at the
-- READING layer (compose.ts's orientation block), never in storage.
--
-- NOT in `user_register` either: that holds what the reader TOLD us, and aiLevel's sovereignty in
-- ai/tone.ts depends on "stated" and "inferred" staying crisply separate rows.
--
-- ★★★ THERE IS NO FREE-TEXT `notes` COLUMN, AND THAT IS THE EXCLUSION MECHANISM. ★★★
-- Every field below is an enum, a small int, a bounded array over a fixed allowlist, or a short name the
-- reader stated outright. A free-prose column would grow forever, could not be validated, could not be
-- rendered safely in a Settings viewer, and is precisely where a financial product would begin recording
-- personal circumstance (income, employment, family, health, goals). The schema cannot represent what it
-- must never store, so the boundary is structural rather than a rule someone has to remember.
--
-- The scope of the whole table is "how to explain to this reader". Nothing about their book lives here:
-- holdings, weights, sector exposure and since-added deltas are computed LIVE and injected already
-- (chat/compose.ts), so a stored copy would be a stale copy of a live financial number.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE "chat_reader_profile" (
    "id"      TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,

    -- ── The three injectable signals ────────────────────────────────────────────────────────────────
    -- The language/script the reader writes in. CHECK-constrained, not free text.
    "preferred_register" TEXT,
    -- A phrasing nudge fed into ai/tone.ts's EXISTING axes, exactly as financeDepth/termComfort are, and
    -- clamped by aiLevel's bounds there. -1 simpler / 0 neutral / +1 denser. Never overrides aiLevel.
    "depth_nudge" INTEGER NOT NULL DEFAULT 0,
    -- Vytal-vocabulary terms this reader has shown they do not know yet. Bounded by a FIXED allowlist in
    -- code (max 8) — bounded BECAUSE Vytal's vocabulary is closed, so it cannot grow without limit.
    "glossary_gaps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- ONLY if the reader explicitly asked to be called something. NEVER inferred from anything.
    "stated_name" TEXT,

    -- ── Provenance per signal. Without stamps there is no decay (a gap that stopped recurring can never
    --    be dropped) and no way to answer "why does it think that". ────────────────────────────────────
    "register_first_seen_at" TIMESTAMP(3),
    "register_last_seen_at"  TIMESTAMP(3),
    "register_session_count" INTEGER NOT NULL DEFAULT 0,
    "depth_first_seen_at"    TIMESTAMP(3),
    "depth_last_seen_at"     TIMESTAMP(3),
    "depth_session_count"    INTEGER NOT NULL DEFAULT 0,
    -- Per-gap stamps as JSON: { "<vocabKey>": { firstSeenAt, lastSeenAt, sessionCount } }. JSON here and
    -- nowhere else, because the KEYS are allowlisted in code — this is a stamp sidecar for a bounded
    -- array, not a free-form document, and it cannot hold prose.
    "gap_stamps" JSONB,
    "name_stated_at" TIMESTAMP(3),

    -- ── Bookkeeping ────────────────────────────────────────────────────────────────────────────────
    -- How many sessions have ever been distilled into this profile. Drives the decay windows.
    "sessions_distilled" INTEGER NOT NULL DEFAULT 0,
    -- ★ Set when the reader clears their activity data. The distiller reads ONLY sessions whose
    --   lastMessageAt is AFTER this instant, so a cleared profile cannot silently re-form from the
    --   surviving transcripts within a week. Without it, the Settings control would be a lie.
    "profile_cleared_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reader_profile_pkey" PRIMARY KEY ("id")
);

-- THE read key: one row per user, and the distiller's single indexed point lookup.
CREATE UNIQUE INDEX "chat_reader_profile_user_id_key" ON "chat_reader_profile"("user_id");

ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enum-in-SQL rather than trust-the-app: the column cannot hold a register the code does not handle.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_register_check"
  CHECK ("preferred_register" IS NULL
         OR "preferred_register" IN ('en', 'hi-latin', 'devanagari', 'mixed'));

-- The nudge is an ordinal with three legal values, enforced where it is stored.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_depth_nudge_check"
  CHECK ("depth_nudge" BETWEEN -1 AND 1);

-- ★ THE CEILING IS A CONSTRAINT, NOT A CONVENTION. The recon's answer to "what happens at the ceiling?"
-- was "nothing, because it cannot be exceeded" — that is only true if the database says so.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_gaps_bounded_check"
  CHECK (array_length("glossary_gaps", 1) IS NULL OR array_length("glossary_gaps", 1) <= 8);

-- A stated name is a short label, never a place to put prose.
ALTER TABLE "chat_reader_profile"
  ADD CONSTRAINT "chat_reader_profile_stated_name_len_check"
  CHECK ("stated_name" IS NULL OR char_length("stated_name") <= 40);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- THE HIGH-WATER MARK on the session.
--
-- A distilled session can receive MORE messages afterwards (the reader comes back the next morning), so
-- this must be a WATERMARK, not a done-flag: the distiller re-reads only the turns newer than it. That is
-- what makes the job idempotent (a re-run over unchanged sessions writes nothing and spends nothing) and
-- what stops a returning conversation from being silently ignored forever.
-- NULL ⇔ never distilled.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "chat_sessions" ADD COLUMN "distilled_up_to_message_at" TIMESTAMP(3);

-- The distiller's claim query: quiet sessions that have unseen turns. Partial on the two states that can
-- possibly qualify, so it stays small as promoted history grows.
CREATE INDEX "chat_sessions_distill_pending_idx"
  ON "chat_sessions"("last_message_at")
  WHERE "distilled_up_to_message_at" IS NULL OR "distilled_up_to_message_at" < "last_message_at";
