-- CreateTable
CREATE TABLE "shareholding_patterns" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "as_on_date" DATE NOT NULL,
    "promoter_pct" DECIMAL(8,4) NOT NULL,
    "public_pct" DECIMAL(8,4) NOT NULL,
    "employee_trust_pct" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "fii_pct" DECIMAL(8,4),
    "dii_pct" DECIMAL(8,4),
    "retail_pct" DECIMAL(8,4),
    "others_pct" DECIMAL(8,4),
    "mutual_fund_pct" DECIMAL(8,4),
    "insurance_pct" DECIMAL(8,4),
    "banks_fis_pct" DECIMAL(8,4),
    "promoter_pledged_pct" DECIMAL(8,4),
    "promoter_pledged_shares_pct" DECIMAL(8,4),
    "total_shares" BIGINT,
    "promoter_shares" BIGINT,
    "pledged_shares" BIGINT,
    "xbrl_url" TEXT,
    "source_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholding_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholding_fetch_logs" (
    "id" TEXT NOT NULL,
    "stock_symbol" TEXT NOT NULL,
    "stock_id" TEXT,
    "fetch_type" TEXT NOT NULL,
    "quarters_found" INTEGER NOT NULL DEFAULT 0,
    "quarters_inserted" INTEGER NOT NULL DEFAULT 0,
    "quarters_skipped" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholding_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shareholding_patterns_stock_id_idx" ON "shareholding_patterns"("stock_id");

-- CreateIndex
CREATE INDEX "shareholding_patterns_as_on_date_idx" ON "shareholding_patterns"("as_on_date");

-- CreateIndex
CREATE INDEX "shareholding_patterns_stock_id_as_on_date_idx" ON "shareholding_patterns"("stock_id", "as_on_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shareholding_patterns_stock_id_as_on_date_key" ON "shareholding_patterns"("stock_id", "as_on_date");

-- CreateIndex
CREATE INDEX "shareholding_fetch_logs_stock_symbol_idx" ON "shareholding_fetch_logs"("stock_symbol");

-- CreateIndex
CREATE INDEX "shareholding_fetch_logs_created_at_idx" ON "shareholding_fetch_logs"("created_at");

-- AddForeignKey
ALTER TABLE "shareholding_patterns" ADD CONSTRAINT "shareholding_patterns_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
