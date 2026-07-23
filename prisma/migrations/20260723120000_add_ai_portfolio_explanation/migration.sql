-- CreateTable
CREATE TABLE "ai_portfolio_explanations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "facts_key" TEXT NOT NULL,
    "tone_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "headline" TEXT,
    "headline_slot" TEXT,
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
    "snapshot_id" TEXT,
    "as_of" TEXT,
    "constant_version" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_portfolio_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_portfolio_explanations_user_id_idx" ON "ai_portfolio_explanations"("user_id");

-- CreateIndex
CREATE INDEX "ai_portfolio_explanations_generated_at_idx" ON "ai_portfolio_explanations"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_portfolio_explanations_user_id_facts_key_tone_key_key" ON "ai_portfolio_explanations"("user_id", "facts_key", "tone_key");

-- AddForeignKey
ALTER TABLE "ai_portfolio_explanations" ADD CONSTRAINT "ai_portfolio_explanations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
