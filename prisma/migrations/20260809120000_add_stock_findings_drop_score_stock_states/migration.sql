-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- FILING PASS · STEP 1 — the foundation.
--   1. CREATE stock_findings — stock-grain filed-data findings. No snapshot FK, no peer group.
--   2. DROP score_stock_states — 0 rows, 0 lifetime writes, no writer anywhere in the codebase.
-- Applied with: npx tsx src/scripts/apply-migration-direct.ts 20260809120000_add_stock_findings_drop_score_stock_states
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · stock_findings ─────────────────────────────────────────────────────────────────────────
CREATE TYPE "FindingEvaluationState" AS ENUM ('fired', 'not_fired', 'not_evaluable');
CREATE TYPE "FindingStandingState" AS ENUM ('newly_standing', 'continuing', 'resolved', 'not_standing');
CREATE TYPE "StockFindingKind" AS ENUM ('red_flag', 'pattern');

CREATE TABLE "stock_findings" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "rule_ref" TEXT NOT NULL,
    -- "<grain>:<period>" — A:FY26 (fiscal year) | Q:FY26Q3 (results quarter) | S:FY26Q3
    -- (shareholding quarter). The prefix keeps a results quarter and a shareholding quarter
    -- distinguishable: same calendar span, different filings, arriving weeks apart.
    "period_key" TEXT NOT NULL,
    -- Last calendar day of period_key. THE ordering key — a prefixed period_key does not sort
    -- chronologically across grains.
    "period_end" DATE NOT NULL,
    "evaluation_state" "FindingEvaluationState" NOT NULL,
    "standing_state" "FindingStandingState",
    "not_evaluable_reason" TEXT,
    "kind" "StockFindingKind" NOT NULL,
    "severity" TEXT,
    "direction" TEXT,
    "magnitude" DECIMAL(6,2),
    "display_state" TEXT NOT NULL DEFAULT 'active',
    "evidence" JSONB,
    "metric_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_findings_pkey" PRIMARY KEY ("id")
);

-- One row per (stock, rule, filing period). A restated filing UPDATES it; it never stacks.
CREATE UNIQUE INDEX "stock_findings_stock_id_rule_key_period_key_key" ON "stock_findings"("stock_id", "rule_key", "period_key");
-- THE DOMINANT READ: every finding for one stock, latest period first.
CREATE INDEX "stock_findings_stock_id_period_end_idx" ON "stock_findings"("stock_id", "period_end" DESC);
-- Universe scans — "every stock where R2 fired this quarter".
CREATE INDEX "stock_findings_rule_key_period_key_evaluation_state_idx" ON "stock_findings"("rule_key", "period_key", "evaluation_state");

ALTER TABLE "stock_findings" ADD CONSTRAINT "stock_findings_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2 · DROP score_stock_states ────────────────────────────────────────────────────────────────
-- Verified before dropping, independently:
--   · SELECT count(*) FROM score_stock_states           → 0
--   · pg_stat_user_tables (lifetime)                    → 0 inserts, 0 updates, 0 deletes
--   · grep for .stockScoringState / score_stock_states  → one reader (resolveCoverage), no writer:
--     no create / update / upsert / job / seed / migration populates it
--   · pg_constraint confrelid                           → no FK references it
--   · pg_views / pg_matviews                            → no view mentions it
--   · pg_attribute over enum "CoverageState"            → used by this table only
-- Coverage is derived live instead (src/relational/coverage.ts), which is left untouched.
ALTER TABLE "score_stock_states" DROP CONSTRAINT "score_stock_states_stock_id_fkey";
DROP TABLE "score_stock_states";
DROP TYPE "CoverageState";
