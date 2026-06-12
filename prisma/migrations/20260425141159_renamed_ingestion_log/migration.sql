/*
  Warnings:

  - You are about to drop the `ingestion_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ingestion_logs" DROP CONSTRAINT "ingestion_logs_stock_id_fkey";

-- DropTable
DROP TABLE "ingestion_logs";

-- CreateTable
CREATE TABLE "fundamental_logs" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT,
    "stock_symbol" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows_inserted" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundamental_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fundamental_logs_stock_symbol_idx" ON "fundamental_logs"("stock_symbol");

-- CreateIndex
CREATE INDEX "fundamental_logs_uploaded_at_idx" ON "fundamental_logs"("uploaded_at");

-- AddForeignKey
ALTER TABLE "fundamental_logs" ADD CONSTRAINT "fundamental_logs_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
