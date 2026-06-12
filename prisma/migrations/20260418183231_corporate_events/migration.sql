-- CreateTable
CREATE TABLE "corporate_events" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "ex_date" DATE,
    "record_date" DATE,
    "description" TEXT,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "impact_level" TEXT NOT NULL DEFAULT 'medium',
    "dividend_amount" DECIMAL(10,2),
    "dividend_type" TEXT,
    "bonus_ratio" TEXT,
    "split_ratio" TEXT,
    "purpose" TEXT,
    "source" TEXT NOT NULL DEFAULT 'nse',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_fetch_logs" (
    "id" TEXT NOT NULL,
    "fetch_type" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "total_fetched" INTEGER NOT NULL DEFAULT 0,
    "total_inserted" INTEGER NOT NULL DEFAULT 0,
    "total_updated" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "corporate_events_stock_id_idx" ON "corporate_events"("stock_id");

-- CreateIndex
CREATE INDEX "corporate_events_event_date_idx" ON "corporate_events"("event_date");

-- CreateIndex
CREATE INDEX "corporate_events_event_type_idx" ON "corporate_events"("event_type");

-- CreateIndex
CREATE INDEX "corporate_events_stock_id_event_date_idx" ON "corporate_events"("stock_id", "event_date");

-- CreateIndex
CREATE INDEX "corporate_events_event_date_event_type_idx" ON "corporate_events"("event_date", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_events_stock_id_event_type_event_date_key" ON "corporate_events"("stock_id", "event_type", "event_date");

-- CreateIndex
CREATE INDEX "event_fetch_logs_created_at_idx" ON "event_fetch_logs"("created_at");

-- AddForeignKey
ALTER TABLE "corporate_events" ADD CONSTRAINT "corporate_events_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
