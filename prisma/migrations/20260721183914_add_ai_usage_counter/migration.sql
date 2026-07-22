-- CreateTable
CREATE TABLE "ai_usage_counters" (
    "scope" TEXT NOT NULL DEFAULT 'global',
    "window_key" TEXT NOT NULL,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "token_count" BIGINT NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_counters_pkey" PRIMARY KEY ("scope","window_key")
);
