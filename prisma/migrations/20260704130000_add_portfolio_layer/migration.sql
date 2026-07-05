-- ═══════════════════════════════════════════════════════════════
-- Portfolio layer — transactions (source of truth, append-only) → FIFO
-- lot-register replay → materialized holdings + holding_lots. ADDITIVE ONLY:
-- no existing table is touched beyond FKs to users(id) and stocks(id).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('buy', 'sell', 'split', 'bonus', 'dividend');

-- CreateTable
CREATE TABLE "transactions" (
    "id"         TEXT              NOT NULL,
    "user_id"    TEXT              NOT NULL,
    "stock_id"   TEXT              NOT NULL,
    "type"       "TransactionType" NOT NULL,
    "quantity"   DECIMAL(18,4),
    "price"      DECIMAL(18,6),
    "trade_date" DATE              NOT NULL,
    "ratio"      TEXT,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holdings" (
    "id"               TEXT         NOT NULL,
    "user_id"          TEXT         NOT NULL,
    "stock_id"         TEXT         NOT NULL,
    "quantity"         DECIMAL(18,4) NOT NULL,
    "avg_cost"         DECIMAL(18,6) NOT NULL,
    "invested_value"   DECIMAL(20,2) NOT NULL,
    "realized_pnl"     DECIMAL(20,2) NOT NULL,
    "last_computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holding_lots" (
    "id"             TEXT          NOT NULL,
    "holding_id"     TEXT          NOT NULL,
    "quantity"       DECIMAL(18,4) NOT NULL,
    "cost_per_share" DECIMAL(18,6) NOT NULL,
    "buy_date"       DATE          NOT NULL,
    "source_txn_id"  TEXT          NOT NULL,

    CONSTRAINT "holding_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_user_id_stock_id_trade_date_created_at_idx"
    ON "transactions"("user_id", "stock_id", "trade_date", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "holdings_user_id_stock_id_key" ON "holdings"("user_id", "stock_id");

-- CreateIndex
CREATE INDEX "holdings_user_id_idx" ON "holdings"("user_id");

-- CreateIndex
CREATE INDEX "holding_lots_holding_id_buy_date_idx" ON "holding_lots"("holding_id", "buy_date");

-- AddForeignKey
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings"
    ADD CONSTRAINT "holdings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings"
    ADD CONSTRAINT "holdings_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holding_lots"
    ADD CONSTRAINT "holding_lots_holding_id_fkey"
    FOREIGN KEY ("holding_id") REFERENCES "holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
