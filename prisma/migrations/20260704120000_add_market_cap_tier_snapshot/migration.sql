-- ═══════════════════════════════════════════════════════════════
-- Market-cap tier snapshot — monthly FROZEN large/mid/small tier per stock,
-- ranked on derived market cap (latest total_shares × latest daily close, via
-- the existing computeMarketCap). Append-only: each freeze appends a full set
-- under a new as_of_date; prior sets are never mutated. ADDITIVE ONLY — no
-- existing table is touched beyond the FK to stocks(id).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "MarketCapTier" AS ENUM ('large', 'mid', 'small', 'unknown');

-- CreateTable
CREATE TABLE "market_cap_tier_snapshot" (
    "id"             TEXT            NOT NULL,
    "stock_id"       TEXT            NOT NULL,
    "tier"           "MarketCapTier" NOT NULL,
    "rank"           INTEGER,
    "market_cap"     DECIMAL(20,2),
    "unknown_reason" TEXT,
    "as_of_date"     DATE            NOT NULL,
    "created_at"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_cap_tier_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotency + natural key: one row per stock per freeze date)
CREATE UNIQUE INDEX "market_cap_tier_snapshot_stock_id_as_of_date_key"
    ON "market_cap_tier_snapshot"("stock_id", "as_of_date");

-- CreateIndex
CREATE INDEX "market_cap_tier_snapshot_as_of_date_idx"
    ON "market_cap_tier_snapshot"("as_of_date");

-- AddForeignKey
ALTER TABLE "market_cap_tier_snapshot"
    ADD CONSTRAINT "market_cap_tier_snapshot_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
