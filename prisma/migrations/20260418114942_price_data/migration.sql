-- AlterTable
ALTER TABLE "stock_prices" ADD COLUMN     "day_change_pct" DECIMAL(8,4),
ADD COLUMN     "high" DECIMAL(12,2),
ADD COLUMN     "low" DECIMAL(12,2),
ADD COLUMN     "open" DECIMAL(12,2),
ADD COLUMN     "prev_close" DECIMAL(12,2),
ADD COLUMN     "price_date" DATE,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'nse-bhavcopy-csv',
ADD COLUMN     "return_1m" DECIMAL(8,4),
ADD COLUMN     "return_1y" DECIMAL(8,4),
ADD COLUMN     "return_3m" DECIMAL(8,4),
ADD COLUMN     "return_6m" DECIMAL(8,4),
ADD COLUMN     "sparkline" JSONB,
ADD COLUMN     "volume" BIGINT,
ADD COLUMN     "week_52_high" DECIMAL(12,2),
ADD COLUMN     "week_52_low" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "daily_prices" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "isin" TEXT,
    "date" DATE NOT NULL,
    "open" DECIMAL(12,2) NOT NULL,
    "high" DECIMAL(12,2) NOT NULL,
    "low" DECIMAL(12,2) NOT NULL,
    "close" DECIMAL(12,2) NOT NULL,
    "prev_close" DECIMAL(12,2),
    "volume" BIGINT NOT NULL,
    "traded_value" DECIMAL(16,4),
    "provider" TEXT NOT NULL DEFAULT 'nse-bhavcopy-csv',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_fetch_logs" (
    "id" TEXT NOT NULL,
    "price_date" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_fetched" INTEGER NOT NULL DEFAULT 0,
    "total_inserted" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_prices_stock_id_idx" ON "daily_prices"("stock_id");

-- CreateIndex
CREATE INDEX "daily_prices_date_idx" ON "daily_prices"("date");

-- CreateIndex
CREATE INDEX "daily_prices_stock_id_date_idx" ON "daily_prices"("stock_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_prices_stock_id_date_key" ON "daily_prices"("stock_id", "date");

-- CreateIndex
CREATE INDEX "price_fetch_logs_price_date_idx" ON "price_fetch_logs"("price_date");

-- CreateIndex
CREATE UNIQUE INDEX "price_fetch_logs_price_date_provider_key" ON "price_fetch_logs"("price_date", "provider");

-- AddForeignKey
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
