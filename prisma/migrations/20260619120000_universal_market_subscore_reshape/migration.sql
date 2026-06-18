-- Migration: 20260619120000_universal_market_subscore_reshape
-- Reshape the Market sub-component persistence for the UNIVERSAL Market mechanism.
--
-- The Phase-4 Market scored 4 per-PG sub-components (range_52w/vs_200dma/
-- volatility_vs_sector/trend_4q) against per-PG percentile band sets
-- (score_market_band_sets) and landed on a percentile bucket (MarketBand p0_p15…).
-- The universal Market (CN-1) scores 7 sub-components (A1/A2/B1/B2/B3/C1/D1) via an
-- IN-CODE cuts table (no per-PG band rows) and lands on the Lens-1 quality band
-- (MetricBand excellent..distress). CN-6: every sub-component is stored — an excluded
-- one carries available=false + reason with null raw/score/band.
--
-- SAFETY: score_market_subs and score_market_band_sets BOTH have ZERO rows (Market
-- never committed — the first 4-pillar snapshot is this very milestone). So both
-- tables are dropped + (score_market_subs) recreated with the universal shape; no
-- data is migrated or lost. STAGED, NOT YET APPLIED — apply with `prisma migrate
-- deploy` as the Stage-3 proof's structural prerequisite.

-- 1. Drop the (empty) Phase-4 sub-score table FIRST — this removes its
--    market_band_set_id FK, which otherwise blocks dropping the band-set table.
--    Recreated below with the universal shape.
DROP TABLE IF EXISTS "score_market_subs";

-- 2. Now retire the Phase-4 per-PG band sets (no dependents remain; its own
--    spec-version FK is dropped with the table).
DROP TABLE IF EXISTS "score_market_band_sets";

-- 3. Old Market enums → universal. MarketBand (percentile) is retired; MarketSubComponent
--    is redefined to the 7 universal keys; MarketCategory (A/B/C/D) is added. No table
--    references these types now (both dropped above), so the type swaps are clean.
DROP TYPE "MarketBand";
ALTER TYPE "MarketSubComponent" RENAME TO "MarketSubComponent_old";
CREATE TYPE "MarketSubComponent" AS ENUM ('A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'D1');
DROP TYPE "MarketSubComponent_old";
CREATE TYPE "MarketCategory" AS ENUM ('A', 'B', 'C', 'D');

-- 4. Recreate score_market_subs (universal shape). raw/score/band nullable (excluded
--    sub-components); available + reason record the exclusion (CN-6); saturated/capped
--    are the Lens-1 saturation / B2-cap facts.
CREATE TABLE "score_market_subs" (
    "id" TEXT NOT NULL,
    "pillar_score_id" TEXT NOT NULL,
    "sub_component" "MarketSubComponent" NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "available" BOOLEAN NOT NULL,
    "reason" TEXT,
    "raw_value" DECIMAL(18,4),
    "score" DECIMAL(8,4),
    "band" "MetricBand",
    "saturated" BOOLEAN NOT NULL DEFAULT false,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_market_subs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "score_market_subs_pillar_score_id_idx" ON "score_market_subs"("pillar_score_id");
CREATE UNIQUE INDEX "score_market_subs_pillar_score_id_sub_component_key" ON "score_market_subs"("pillar_score_id", "sub_component");

ALTER TABLE "score_market_subs" ADD CONSTRAINT "score_market_subs_pillar_score_id_fkey" FOREIGN KEY ("pillar_score_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
