-- Dual-basis storage: add `result_type` to the unique key of every result table
-- so a stock-period can hold BOTH a standalone AND a consolidated row.
--
-- SAFETY: this is a constraint change, NOT a data change. Existing rows are
-- preserved. Each period currently holds at most one row (the old unique key was
-- (stock_id[, quarter], fiscal_year)), and every row already carries a
-- non-null `result_type`, so (stock_id[, quarter], fiscal_year, result_type) is
-- guaranteed unique across the existing data — the CREATE UNIQUE INDEX cannot
-- collide. No rows are dropped or rewritten.
--
-- Mechanism: Prisma cannot widen a unique index in place, so each old unique
-- index is dropped and a new composite one (with result_type appended) is
-- created. Reads/writes that referenced the old compound key are updated in code
-- to the new `..._result_type` key.

-- DropIndex
DROP INDEX "fundamentals_stock_id_fiscal_year_key";

-- DropIndex
DROP INDEX "quarterly_results_stock_id_quarter_fiscal_year_key";

-- DropIndex
DROP INDEX "banking_fundamentals_stock_id_fiscal_year_key";

-- DropIndex
DROP INDEX "banking_quarterly_results_stock_id_quarter_fiscal_year_key";

-- DropIndex
DROP INDEX "nbfc_fundamentals_stock_id_fiscal_year_key";

-- DropIndex
DROP INDEX "nbfc_quarterly_results_stock_id_quarter_fiscal_year_key";

-- DropIndex
DROP INDEX "life_insurance_fundamentals_stock_id_fiscal_year_key";

-- DropIndex
DROP INDEX "life_insurance_quarterly_results_stock_id_quarter_fiscal_ye_key";

-- DropIndex
DROP INDEX "general_insurance_fundamentals_stock_id_fiscal_year_key";

-- DropIndex
DROP INDEX "general_insurance_quarterly_results_stock_id_quarter_fiscal_key";

-- CreateIndex
CREATE UNIQUE INDEX "fundamentals_stock_id_fiscal_year_result_type_key" ON "fundamentals"("stock_id", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "quarterly_results_stock_id_quarter_fiscal_year_result_type_key" ON "quarterly_results"("stock_id", "quarter", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "banking_fundamentals_stock_id_fiscal_year_result_type_key" ON "banking_fundamentals"("stock_id", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "banking_quarterly_results_stock_id_quarter_fiscal_year_resu_key" ON "banking_quarterly_results"("stock_id", "quarter", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "nbfc_fundamentals_stock_id_fiscal_year_result_type_key" ON "nbfc_fundamentals"("stock_id", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "nbfc_quarterly_results_stock_id_quarter_fiscal_year_result__key" ON "nbfc_quarterly_results"("stock_id", "quarter", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "life_insurance_fundamentals_stock_id_fiscal_year_result_typ_key" ON "life_insurance_fundamentals"("stock_id", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "life_insurance_quarterly_results_stock_id_quarter_fiscal_ye_key" ON "life_insurance_quarterly_results"("stock_id", "quarter", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "general_insurance_fundamentals_stock_id_fiscal_year_result__key" ON "general_insurance_fundamentals"("stock_id", "fiscal_year", "result_type");

-- CreateIndex
CREATE UNIQUE INDEX "general_insurance_quarterly_results_stock_id_quarter_fiscal_key" ON "general_insurance_quarterly_results"("stock_id", "quarter", "fiscal_year", "result_type");
