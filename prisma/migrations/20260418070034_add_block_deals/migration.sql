-- CreateTable
CREATE TABLE "block_deals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "deal_date" DATE NOT NULL,
    "deal_type" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "value_cr" DECIMAL(14,4),
    "remarks" TEXT,
    "source" TEXT NOT NULL DEFAULT 'nse',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_fetch_logs" (
    "id" TEXT NOT NULL,
    "fetch_date" DATE NOT NULL,
    "fetch_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_fetched" INTEGER NOT NULL DEFAULT 0,
    "total_inserted" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "block_deals_stock_id_idx" ON "block_deals"("stock_id");

-- CreateIndex
CREATE INDEX "block_deals_deal_date_idx" ON "block_deals"("deal_date");

-- CreateIndex
CREATE INDEX "block_deals_stock_id_deal_date_idx" ON "block_deals"("stock_id", "deal_date");

-- CreateIndex
CREATE UNIQUE INDEX "block_deals_stock_id_deal_date_client_name_transaction_type_key" ON "block_deals"("stock_id", "deal_date", "client_name", "transaction_type", "quantity");

-- CreateIndex
CREATE INDEX "deal_fetch_logs_fetch_date_idx" ON "deal_fetch_logs"("fetch_date");

-- CreateIndex
CREATE UNIQUE INDEX "deal_fetch_logs_fetch_date_fetch_type_key" ON "deal_fetch_logs"("fetch_date", "fetch_type");

-- AddForeignKey
ALTER TABLE "block_deals" ADD CONSTRAINT "block_deals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
