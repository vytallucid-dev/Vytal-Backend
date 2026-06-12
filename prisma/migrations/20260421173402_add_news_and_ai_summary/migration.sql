-- CreateTable
CREATE TABLE "stock_news" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "content_text" TEXT,
    "content_source" TEXT,
    "content_tokens" INTEGER,
    "pdf_url" TEXT,
    "external_url" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "sentiment" TEXT,
    "is_high_impact" BOOLEAN NOT NULL DEFAULT false,
    "extraction_status" TEXT NOT NULL DEFAULT 'not_applicable',
    "extraction_attempts" INTEGER NOT NULL DEFAULT 0,
    "extraction_error" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extracted_at" TIMESTAMP(3),

    CONSTRAINT "stock_news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_summaries" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "summary_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "headline" TEXT,
    "key_points" JSONB,
    "model_version" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "cached_tokens" INTEGER,
    "is_approved" BOOLEAN NOT NULL DEFAULT true,
    "feedback_score" INTEGER,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_fetch_logs" (
    "id" TEXT NOT NULL,
    "fetch_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stocks_processed" INTEGER NOT NULL DEFAULT 0,
    "items_inserted" INTEGER NOT NULL DEFAULT 0,
    "items_skipped" INTEGER NOT NULL DEFAULT 0,
    "items_extracted" INTEGER NOT NULL DEFAULT 0,
    "extraction_failed" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AiSummaryToStockNews" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AiSummaryToStockNews_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "stock_news_stock_id_idx" ON "stock_news"("stock_id");

-- CreateIndex
CREATE INDEX "stock_news_published_at_idx" ON "stock_news"("published_at" DESC);

-- CreateIndex
CREATE INDEX "stock_news_stock_id_published_at_idx" ON "stock_news"("stock_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "stock_news_source_type_idx" ON "stock_news"("source_type");

-- CreateIndex
CREATE INDEX "stock_news_is_high_impact_idx" ON "stock_news"("is_high_impact");

-- CreateIndex
CREATE INDEX "stock_news_extraction_status_idx" ON "stock_news"("extraction_status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_news_stock_id_source_id_key" ON "stock_news"("stock_id", "source_id");

-- CreateIndex
CREATE INDEX "ai_summaries_stock_id_idx" ON "ai_summaries"("stock_id");

-- CreateIndex
CREATE INDEX "ai_summaries_summary_type_idx" ON "ai_summaries"("summary_type");

-- CreateIndex
CREATE INDEX "ai_summaries_generated_at_idx" ON "ai_summaries"("generated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_summaries_stock_id_summary_type_idx" ON "ai_summaries"("stock_id", "summary_type");

-- CreateIndex
CREATE INDEX "news_fetch_logs_created_at_idx" ON "news_fetch_logs"("created_at");

-- CreateIndex
CREATE INDEX "_AiSummaryToStockNews_B_index" ON "_AiSummaryToStockNews"("B");

-- AddForeignKey
ALTER TABLE "stock_news" ADD CONSTRAINT "stock_news_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AiSummaryToStockNews" ADD CONSTRAINT "_AiSummaryToStockNews_A_fkey" FOREIGN KEY ("A") REFERENCES "ai_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AiSummaryToStockNews" ADD CONSTRAINT "_AiSummaryToStockNews_B_fkey" FOREIGN KEY ("B") REFERENCES "stock_news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
