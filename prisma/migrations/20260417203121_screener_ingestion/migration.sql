-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "stock_count" INTEGER NOT NULL DEFAULT 0,
    "health_score_weightages" JSONB,
    "thresholds" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector_id" TEXT,
    "exchange" TEXT NOT NULL DEFAULT 'NSE',
    "market_cap_category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "face_value" DECIMAL(10,2),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundamentals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "revenue" DECIMAL(18,2),
    "employee_cost" DECIMAL(18,2),
    "other_mfr_exp" DECIMAL(18,2),
    "selling_admin" DECIMAL(18,2),
    "other_expenses" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "depreciation" DECIMAL(18,2),
    "interest" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "dividend_amount" DECIMAL(18,2),
    "ebitda" DECIMAL(18,2),
    "net_margin" DECIMAL(8,4),
    "operating_margin" DECIMAL(8,4),
    "revenue_growth_yoy" DECIMAL(8,4),
    "profit_growth_yoy" DECIMAL(8,4),
    "eps_growth_yoy" DECIMAL(8,4),
    "dividend_payout" DECIMAL(8,4),
    "equity_share_capital" DECIMAL(18,2),
    "reserves" DECIMAL(18,2),
    "borrowings" DECIMAL(18,2),
    "other_liabilities" DECIMAL(18,2),
    "net_block" DECIMAL(18,2),
    "capital_wip" DECIMAL(18,2),
    "investments" DECIMAL(18,2),
    "other_assets" DECIMAL(18,2),
    "receivables" DECIMAL(18,2),
    "inventory" DECIMAL(18,2),
    "cash_and_bank" DECIMAL(18,2),
    "total_assets" DECIMAL(18,2),
    "total_debt" DECIMAL(18,2),
    "net_worth" DECIMAL(18,2),
    "no_of_shares" BIGINT,
    "adjusted_shares_cr" DECIMAL(12,4),
    "debt_to_equity" DECIMAL(8,4),
    "eps" DECIMAL(10,4),
    "book_value_per_share" DECIMAL(10,4),
    "receivables_days" DECIMAL(8,2),
    "inventory_turnover" DECIMAL(8,4),
    "asset_turnover" DECIMAL(8,4),
    "operating_cash_flow" DECIMAL(18,2),
    "investing_cash_flow" DECIMAL(18,2),
    "financing_cash_flow" DECIMAL(18,2),
    "net_cash_flow" DECIMAL(18,2),
    "fcf" DECIMAL(18,2),
    "pe_ratio" DECIMAL(10,4),
    "pb_ratio" DECIMAL(10,4),
    "ev_ebitda" DECIMAL(10,4),
    "dividend_yield" DECIMAL(8,4),
    "market_cap" DECIMAL(18,2),
    "price_eoy" DECIMAL(10,2),
    "roe" DECIMAL(8,4),
    "roce" DECIMAL(8,4),
    "interest_coverage" DECIMAL(8,4),
    "source" TEXT NOT NULL DEFAULT 'screener_csv',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quarterly_results" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "revenue" DECIMAL(18,2),
    "expenses" DECIMAL(18,2),
    "operating_profit" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "depreciation" DECIMAL(18,2),
    "interest" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "operating_margin" DECIMAL(8,4),
    "net_margin" DECIMAL(8,4),
    "revenue_qoq" DECIMAL(8,4),
    "revenue_yoy" DECIMAL(8,4),
    "profit_qoq" DECIMAL(8,4),
    "profit_yoy" DECIMAL(8,4),
    "source" TEXT NOT NULL DEFAULT 'screener_csv',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quarterly_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_prices" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "market_cap" DECIMAL(18,2),
    "face_value" DECIMAL(10,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_logs" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT,
    "stock_symbol" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows_inserted" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_name_key" ON "sectors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_symbol_key" ON "stocks"("symbol");

-- CreateIndex
CREATE INDEX "fundamentals_stock_id_idx" ON "fundamentals"("stock_id");

-- CreateIndex
CREATE INDEX "fundamentals_fiscal_year_idx" ON "fundamentals"("fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "fundamentals_stock_id_fiscal_year_key" ON "fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "quarterly_results_stock_id_idx" ON "quarterly_results"("stock_id");

-- CreateIndex
CREATE UNIQUE INDEX "quarterly_results_stock_id_quarter_fiscal_year_key" ON "quarterly_results"("stock_id", "quarter", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "stock_prices_stock_id_key" ON "stock_prices"("stock_id");

-- CreateIndex
CREATE INDEX "ingestion_logs_stock_symbol_idx" ON "ingestion_logs"("stock_symbol");

-- CreateIndex
CREATE INDEX "ingestion_logs_uploaded_at_idx" ON "ingestion_logs"("uploaded_at");

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundamentals" ADD CONSTRAINT "fundamentals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarterly_results" ADD CONSTRAINT "quarterly_results_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_prices" ADD CONSTRAINT "stock_prices_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
