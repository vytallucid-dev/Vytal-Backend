-- AlterTable
ALTER TABLE "quarterly_results" ADD COLUMN     "filing_date" TIMESTAMP(3),
ADD COLUMN     "result_type" TEXT NOT NULL DEFAULT 'consolidated',
ADD COLUMN     "xbrl_url" TEXT,
ALTER COLUMN "source" SET DEFAULT 'nse_xbrl';

-- CreateTable
CREATE TABLE "result_fetch_logs" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quarter" TEXT,
    "fiscal_year" TEXT,
    "result_type" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "xbrl_url" TEXT,
    "filing_date" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "result_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "result_fetch_logs_stock_id_fetched_at_idx" ON "result_fetch_logs"("stock_id", "fetched_at");

-- CreateIndex
CREATE INDEX "result_fetch_logs_status_fetched_at_idx" ON "result_fetch_logs"("status", "fetched_at");

-- CreateIndex
CREATE INDEX "result_fetch_logs_symbol_quarter_fiscal_year_idx" ON "result_fetch_logs"("symbol", "quarter", "fiscal_year");

-- AddForeignKey
ALTER TABLE "result_fetch_logs" ADD CONSTRAINT "result_fetch_logs_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
