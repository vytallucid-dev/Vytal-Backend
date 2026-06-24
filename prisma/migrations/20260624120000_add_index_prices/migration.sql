-- CreateTable
CREATE TABLE "index_prices" (
    "id" TEXT NOT NULL,
    "index_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(14,4),
    "high" DECIMAL(14,4),
    "low" DECIMAL(14,4),
    "close" DECIMAL(14,4) NOT NULL,
    "points_change" DECIMAL(14,4),
    "change_pct" DECIMAL(10,4),
    "volume" BIGINT,
    "turnover" DECIMAL(18,4),
    "pe" DECIMAL(12,4),
    "pb" DECIMAL(12,4),
    "div_yield" DECIMAL(10,4),
    "provider" TEXT NOT NULL DEFAULT 'nse-index-csv',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "index_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_fetch_logs" (
    "id" TEXT NOT NULL,
    "index_date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'nse-index-csv',
    "status" TEXT NOT NULL,
    "total_fetched" INTEGER NOT NULL DEFAULT 0,
    "total_inserted" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_prices_index_name_idx" ON "index_prices"("index_name");

-- CreateIndex
CREATE INDEX "index_prices_date_idx" ON "index_prices"("date");

-- CreateIndex
CREATE INDEX "index_prices_index_name_date_idx" ON "index_prices"("index_name", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "index_prices_index_name_date_key" ON "index_prices"("index_name", "date");

-- CreateIndex
CREATE INDEX "index_fetch_logs_index_date_idx" ON "index_fetch_logs"("index_date");

-- CreateIndex
CREATE UNIQUE INDEX "index_fetch_logs_index_date_source_key" ON "index_fetch_logs"("index_date", "source");
