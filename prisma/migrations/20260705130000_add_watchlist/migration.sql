-- ═══════════════════════════════════════════════════════════════
-- Watchlist — per-user pinned research surface. One row per (user, stock).
-- pinned_* = a pin-time baseline captured ONCE at insert (never updated).
-- ADDITIVE ONLY: no existing table touched beyond FKs to users(id)/stocks(id).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "watchlist" (
    "id"            TEXT          NOT NULL,
    "user_id"       TEXT          NOT NULL,
    "stock_id"      TEXT          NOT NULL,
    "added_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinned_health" INTEGER,
    "pinned_band"   TEXT,
    "pinned_price"  DECIMAL(12,2),

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_user_id_stock_id_key" ON "watchlist"("user_id", "stock_id");

-- CreateIndex
CREATE INDEX "watchlist_user_id_added_at_idx" ON "watchlist"("user_id", "added_at" DESC);

-- AddForeignKey
ALTER TABLE "watchlist"
    ADD CONSTRAINT "watchlist_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist"
    ADD CONSTRAINT "watchlist_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
