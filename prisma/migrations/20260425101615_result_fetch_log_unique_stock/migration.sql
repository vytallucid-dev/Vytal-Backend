/*
  Warnings:

  - A unique constraint covering the columns `[stock_id]` on the table `result_fetch_logs` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "result_fetch_logs_stock_id_key" ON "result_fetch_logs"("stock_id");
