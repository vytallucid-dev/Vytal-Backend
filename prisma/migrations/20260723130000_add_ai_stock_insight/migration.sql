-- CreateTable
CREATE TABLE "ai_stock_insights" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "facts_key" TEXT NOT NULL,
    "tone_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "hard_hits" JSONB,
    "soft_hits" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_tokens" INTEGER,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "as_of_date" TEXT,
    "period_key" TEXT,
    "snapshot_type" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_stock_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_stock_insights_stock_id_idx" ON "ai_stock_insights"("stock_id");

-- CreateIndex
CREATE INDEX "ai_stock_insights_generated_at_idx" ON "ai_stock_insights"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_stock_insights_stock_id_facts_key_tone_key_key" ON "ai_stock_insights"("stock_id", "facts_key", "tone_key");

-- AddForeignKey
ALTER TABLE "ai_stock_insights" ADD CONSTRAINT "ai_stock_insights_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
