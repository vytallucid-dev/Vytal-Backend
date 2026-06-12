/*
  Warnings:

  - A unique constraint covering the columns `[stock_id,quarter,fiscal_year]` on the table `result_fetch_logs` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "result_fetch_logs_stock_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "result_fetch_logs_stock_id_quarter_fiscal_year_key" ON "result_fetch_logs"("stock_id", "quarter", "fiscal_year");
