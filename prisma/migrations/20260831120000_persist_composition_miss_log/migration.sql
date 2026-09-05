-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- T-0 · PERSIST THE MISS-LOG — the table §6.4 has been describing for four stages.
--
-- ── ★ WHAT WAS ACTUALLY THERE ─────────────────────────────────────────────────────────────────────
-- `src/composition/miss-log.ts` was `const ROWS: MissLogRow[] = []`. In-process, unbounded, dying on
-- every restart. §6.4 says that log "is what writes composition #199 — with evidence attached, not
-- guesswork", and the architecture's own §6.5 says "the miss-log cannot tell a missing family from a
-- coin flip" — both sentences describe a store that has never held a row past a deploy.
--
-- Measured while writing this migration, and worse than the deferral note implied: `missLog()`,
-- `missLogSummary()` and `clearMissLog()` had ZERO call sites anywhere in src/. The log was not only
-- unpersisted, it was unread. Nothing that has ever been decided "from the miss-log" was.
--
-- ── ★ WHY THE SLOTS ARE STORED TWICE ──────────────────────────────────────────────────────────────
-- The flattened columns are what the report GROUPs BY. `source` is the one that matters most: §6.5
-- rules that a LEXICAL `unresolved` is a statement about our budget and a MODEL `unresolved` is a
-- statement about the question, and that counting them undivided is the reading that gets someone to
-- build a family nobody needed. A jsonb-only table makes that split a scan; a column makes it an
-- index. `slots` keeps the whole RouterOutput anyway, so a slot added to the contract later is not
-- lost from rows written before its column existed.
--
-- ── ★ `user_id` IS NULLABLE AND SET NULL — DELIBERATELY, AND IT CONTRADICTS §6.5 RULE 2 ON PURPOSE ─
-- §6.5 rule 2 forbids the CLASSIFICATION CACHE from keying on a user: classification is a pure
-- function of the sentence, so a user in the key would fragment the cache and leak turn state into a
-- shared store. That is a correctness rule about a cache. This is an evidence table and the opposite
-- rule applies, for two reasons:
--
--   1. ACCOUNTABILITY. These rows are free text a person typed. A store of reader questions with no
--      user reference cannot honour a deletion request and cannot be cleaned up when an account goes
--      away. An UNDELETABLE pile of reader text is the worse privacy posture, not the better one.
--   2. DEMAND IS NOT VOLUME. "Fifty rows" is evidence of a missing family only if it is fifty
--      readers. Fifty rows from one person is one person. Without the column the log cannot tell
--      those apart, and the first is a reason to build while the second is not.
--
-- ON DELETE SET NULL, never CASCADE: de-linking answers the deletion request; deleting the row would
-- destroy the question shape, and the tail of question shapes is the entire point of the log.
--
-- ⚠ WHAT IS NOT STORED: session id, IP, user agent, turn history. And the raw question is kept
--   VERBATIM — a paraphrase is not evidence — which is exactly why the retention row below exists.
--
-- ── ★ RETENTION: REGISTERED, SHIPPED UNARMED ──────────────────────────────────────────────────────
-- The `attention_events` / `market_cap_tier_snapshot` idiom (20260814120000):
--   enabled=true  → the row IS loaded and COUNTED every pass, so its projection shows in
--                   /admin/retention. A disabled row is skipped entirely, hiding the very number this
--                   registration exists to surface.
--   armed=false   → COUNTED, NEVER DELETED, even in a live run. Nothing here can delete until an
--                   admin reviews the dry-run and arms it deliberately.
-- This is the honest answer to the two-sided risk: unbounded growth is a problem, and a retention
-- rule that discards the tail is a worse one. Unarmed, neither happens today, and the projection is
-- visible for whoever makes the call later.
--
-- floor 180 is IRREVOCABLE through the audited admin route (that route may write keep|days|
-- supersededDays|armed|enabled and nothing else — only another migration can lower a floor). It is
-- set at the consumer requirement: T-22 re-orders the family plan from this log BEFORE EACH PHASE,
-- and a phase spans weeks, so no admin may ever tune the window below two quarters of evidence.
-- days 365 is the ceiling above it, leaving the policy tunable downward to 180 forever.
--
-- ── ★ ADDITIVE AND DRIFT-SAFE ─────────────────────────────────────────────────────────────────────
-- One CREATE TABLE, four CREATE INDEX, one FK, one INSERT into retention_policy. NOTHING is altered,
-- renamed or dropped; no existing table is touched except `retention_policy`, which gains one row.
-- Every statement is IF NOT EXISTS / ON CONFLICT guarded, so a re-run is a no-op.
--
-- Apply: `tsx src/scripts/apply-migration-direct.ts 20260831120000_persist_composition_miss_log`
-- (BEGIN/COMMIT over DIRECT_URL — DDL and pgbouncer do not mix), then
-- `prisma migrate resolve --applied 20260831120000_persist_composition_miss_log`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · The table ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "composition_misses" (
  "id"               TEXT NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "branch"           TEXT NOT NULL,
  "raw"              TEXT NOT NULL,
  "question_key"     TEXT NOT NULL,
  "user_id"          TEXT,

  "scope"            TEXT NOT NULL,
  "operation"        TEXT NOT NULL,
  "lens"             TEXT,
  "perspective"      TEXT NOT NULL,
  "action"           TEXT,
  "confidence"       TEXT NOT NULL,
  "source"           TEXT NOT NULL,
  "degraded_reason"  TEXT,
  "timeframe_kind"   TEXT,
  "timeframe_n"      INTEGER,
  "subject_mentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  "resolved_symbols" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sections_chosen"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "missing_data"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  "slots"            JSONB NOT NULL,

  CONSTRAINT "composition_misses_pkey" PRIMARY KEY ("id"),

  -- The two closed vocabularies. A third branch or a third classifier source is an architecture
  -- change (§6.4's extensibility test) and must fail at the database rather than arrive as a string
  -- nobody notices in a GROUP BY.
  CONSTRAINT "composition_misses_branch_ck" CHECK ("branch" IN ('generic', 'clarify_operation')),
  CONSTRAINT "composition_misses_source_ck" CHECK ("source" IN ('model', 'lexical'))
);

-- ── 2 · Indexes — one per read the report actually performs ─────────────────────────────────────────
-- Recency: "what has been missed lately".
CREATE INDEX IF NOT EXISTS "composition_misses_created_at_idx"
  ON "composition_misses" ("created_at" DESC);
-- Frequency: "how often has THIS question been asked" — the number T-22 re-orders on.
CREATE INDEX IF NOT EXISTS "composition_misses_question_key_created_at_idx"
  ON "composition_misses" ("question_key", "created_at" DESC);
-- ★ The §6.5 split. The report's headline read; it must stay an index, not a scan.
CREATE INDEX IF NOT EXISTS "composition_misses_branch_source_created_at_idx"
  ON "composition_misses" ("branch", "source", "created_at" DESC);
-- Shape clustering: which (operation, lens) pairs keep landing here.
CREATE INDEX IF NOT EXISTS "composition_misses_operation_lens_idx"
  ON "composition_misses" ("operation", "lens");

-- ── 3 · The FK. SET NULL, not CASCADE — see the header. ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'composition_misses_user_id_fkey'
  ) THEN
    ALTER TABLE "composition_misses"
      ADD CONSTRAINT "composition_misses_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN "composition_misses"."source" IS
  'model | lexical. THE split this table exists for (§6.5): a lexical unresolved is a statement about our quota, a model unresolved is a statement about the question. Counting them together is the reading that gets someone to build a family nobody needed.';
COMMENT ON COLUMN "composition_misses"."missing_data" IS
  'Named data the question wanted that we do not hold. EMPTY IS MEANINGFUL: it says the miss was a MISSING FAMILY rather than missing data — the cheaper of the two to fix.';
COMMENT ON COLUMN "composition_misses"."user_id" IS
  'Nullable, ON DELETE SET NULL. Present so a deletion request can be honoured and so demand can be told from one loud reader; de-linked rather than deleted so the question shape survives as evidence.';

-- ── 4 · Retention registration. DATA-ONLY. enabled=true, armed=false. ───────────────────────────────
INSERT INTO "retention_policy"
  ("id","table_name","mode","key_cols","order_col","days","ts_column","floor","floor_reason","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text,'composition_misses','time',ARRAY[]::TEXT[],NULL,365,'created_at',180,
   'T-22 re-orders the family coverage plan from this log BEFORE EACH PHASE, and a phase spans weeks — so the window may never be tuned below two quarters of accumulated evidence. The log''s value is cumulative and its TAIL is the signal (a question shape asked three times in six months is exactly the kind of miss a purpose-built family should answer), so a short window would delete the thing the table was created to collect. days 365 is the ceiling; floor 180 keeps it tunable downward without ever reaching a window that discards a planning cycle. Read sites: src/scripts/miss-log-report.ts and controllers/admin/miss-log-controller.ts, both unbounded by default and both windowed only by an explicit --days/?days argument.',
   true,false,CURRENT_TIMESTAMP)
ON CONFLICT ("table_name") DO NOTHING;
