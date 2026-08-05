-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- QUARTER IN BRIEF — create quarter_briefs, and DROP ai_summaries.
--
-- ── ★ WHY THIS REVERSES A PRIOR DELIBERATE DECISION ────────────────────────────────────────────────
-- 20260725120000_drop_ai_card_tables dropped four dead AI tables and explicitly SPARED this one:
--     "⚠ DELIBERATELY UNTOUCHED: ai_usage_counters (the quota gate — KEEP) and ai_summaries
--      (pre-existing news-shaped scaffolding with a live m2m to stock_news; never ours to drop)."
-- That was correct then and is being reversed on evidence, not preference. The constraint behind it
-- was authorship — news scaffolding was not that change's to touch. It is this one's. And the stated
-- reason no longer holds on the facts: ai_summaries is EMPTY (0 rows) and so is its m2m join table
-- (_AiSummaryToStockNews, 0 rows), measured immediately before this migration was written. It has
-- never been written to in its entire existence: created 2026-04-21, zero write call-sites anywhere in
-- src/, and its one read path carries the comment "0 rows today → always stub".
--
-- It is not merely unused, it is SHAPED WRONG for what replaces it. ai_summaries has no period column
-- and NO unique constraint, while its `summary_type` multiplexes four unrelated content kinds onto one
-- table. The key this feature needs — (stock, quarter, fiscal year, basis) — is meaningful for exactly
-- one of those four, so it could only ever have been enforced by a partial index behind a free-string
-- discriminator. A future reader should find a decision here, not an inconsistency.
--
-- ── ⚠ ORDER IS LOAD-BEARING: THE RETENTION ROW COMES FIRST ─────────────────────────────────────────
-- A LIVE retention_policies row for stock_news carries except_where = 'ai_summary_referenced', whose
-- SQL fragment is `AND "id" NOT IN (SELECT "B" FROM "_AiSummaryToStockNews")`. Drop the tables first
-- and stock_news pruning breaks against a missing relation — a silent failure in a job nobody watches
-- until news stops being pruned. So the exemption is cleared BEFORE the drop, in the same transaction.
-- The exemption is also removed from the EXEMPTIONS registry in src/retention/policy.ts; a named
-- exemption that no policy references is a stale allowance, which that module treats as a lie.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · Release the retention dependency FIRST ──────────────────────────────────────────────────────
UPDATE "retention_policy"
   SET "except_where" = NULL
 WHERE "table_name" = 'stock_news'
   AND "except_where" = 'ai_summary_referenced';

-- ── 2 · The new table ──────────────────────────────────────────────────────────────────────────────
CREATE TYPE "QuarterBriefStatus" AS ENUM ('live', 'stale');

CREATE TABLE "quarter_briefs" (
  "id"                TEXT NOT NULL,
  "stock_id"          TEXT NOT NULL,
  "quarter"           TEXT NOT NULL,
  "fiscal_year"       TEXT NOT NULL,
  "result_type"       TEXT NOT NULL,
  "content"           TEXT NOT NULL,
  "verdict_key"       TEXT NOT NULL,
  "verdict_label"     TEXT NOT NULL,
  "scored_as_of"      DATE,
  "status"            "QuarterBriefStatus" NOT NULL DEFAULT 'live',
  "stale_reason"      TEXT,
  "stale_at"          TIMESTAMP(3),
  "facts_fingerprint" TEXT NOT NULL,
  "model"             TEXT NOT NULL,
  "prompt_tokens"     INTEGER,
  "output_tokens"     INTEGER,
  "generated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quarter_briefs_pkey" PRIMARY KEY ("id")
);

-- ONE ROW PER QUARTER — not per stock. This is the constraint the whole storage decision rests on.
CREATE UNIQUE INDEX "quarter_briefs_stock_id_quarter_fiscal_year_result_type_key"
  ON "quarter_briefs" ("stock_id", "quarter", "fiscal_year", "result_type");
CREATE INDEX "quarter_briefs_stock_id_status_idx" ON "quarter_briefs" ("stock_id", "status");
CREATE INDEX "quarter_briefs_status_idx" ON "quarter_briefs" ("status");

ALTER TABLE "quarter_briefs"
  ADD CONSTRAINT "quarter_briefs_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "quarter_briefs"."status" IS
  'live = generated, guard-clean, inputs unchanged. stale = an input changed; HIDDEN on read until regenerated. Absence is the safe state — the read path serves only live.';
COMMENT ON COLUMN "quarter_briefs"."scored_as_of" IS
  'As-of date of the ScoreSnapshot the health section was pinned to, or NULL when the stock was unscored at generation time. The score moves on ordinary trading days; the section is dated, not chased.';

-- ── 3 · Drop the dead table (join table goes with it via CASCADE) ──────────────────────────────────
DROP TABLE IF EXISTS "_AiSummaryToStockNews" CASCADE;
DROP TABLE IF EXISTS "ai_summaries" CASCADE;
