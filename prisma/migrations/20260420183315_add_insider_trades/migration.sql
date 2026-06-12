-- CreateTable
CREATE TABLE "insider_trades" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "intimation_date" DATE NOT NULL,
    "person_name" TEXT NOT NULL,
    "person_category" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "security_type" TEXT NOT NULL,
    "trade_date" DATE,
    "securities_pre" DECIMAL(18,0),
    "securities_traded" DECIMAL(18,0),
    "securities_post" DECIMAL(18,0),
    "holding_pct_pre" DECIMAL(8,4),
    "holding_pct_post" DECIMAL(8,4),
    "holding_pct_delta" DECIMAL(8,4),
    "trade_price" DECIMAL(12,2),
    "trade_value_cr" DECIMAL(16,4),
    "acquisition_mode" TEXT,
    "remarks" TEXT,
    "exchange_ref" TEXT,
    "source" TEXT NOT NULL DEFAULT 'nse_pit',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insider_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insider_trade_fetch_logs" (
    "id" TEXT NOT NULL,
    "fetch_date" DATE NOT NULL,
    "fetch_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_fetched" INTEGER NOT NULL DEFAULT 0,
    "total_inserted" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "total_filtered" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insider_trade_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insider_trades_stock_id_idx" ON "insider_trades"("stock_id");

-- CreateIndex
CREATE INDEX "insider_trades_trade_date_idx" ON "insider_trades"("trade_date");

-- CreateIndex
CREATE INDEX "insider_trades_intimation_date_idx" ON "insider_trades"("intimation_date");

-- CreateIndex
CREATE INDEX "insider_trades_person_category_idx" ON "insider_trades"("person_category");

-- CreateIndex
CREATE INDEX "insider_trades_transaction_type_idx" ON "insider_trades"("transaction_type");

-- CreateIndex
CREATE INDEX "insider_trades_stock_id_trade_date_idx" ON "insider_trades"("stock_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "insider_trades_stock_id_person_category_idx" ON "insider_trades"("stock_id", "person_category");

-- CreateIndex
CREATE INDEX "insider_trades_intimation_date_transaction_type_idx" ON "insider_trades"("intimation_date", "transaction_type");

-- CreateIndex
CREATE UNIQUE INDEX "insider_trades_stock_id_person_name_transaction_type_trade__key" ON "insider_trades"("stock_id", "person_name", "transaction_type", "trade_date", "securities_traded");

-- CreateIndex
CREATE INDEX "insider_trade_fetch_logs_fetch_date_idx" ON "insider_trade_fetch_logs"("fetch_date");

-- CreateIndex
CREATE INDEX "insider_trade_fetch_logs_created_at_idx" ON "insider_trade_fetch_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "insider_trade_fetch_logs_fetch_date_fetch_type_key" ON "insider_trade_fetch_logs"("fetch_date", "fetch_type");

-- AddForeignKey
ALTER TABLE "insider_trades" ADD CONSTRAINT "insider_trades_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
