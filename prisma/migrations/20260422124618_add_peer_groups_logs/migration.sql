-- CreateTable
CREATE TABLE "peer_group_computation_logs" (
    "id" TEXT NOT NULL,
    "run_type" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "peer_group_id" TEXT,
    "sector_id" TEXT,
    "fiscal_year" TEXT,
    "groups_computed" INTEGER NOT NULL DEFAULT 0,
    "groups_skipped" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "duration_ms" INTEGER,
    "computed_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_group_computation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "peer_group_computation_logs_created_at_idx" ON "peer_group_computation_logs"("created_at");

-- CreateIndex
CREATE INDEX "peer_group_computation_logs_run_type_idx" ON "peer_group_computation_logs"("run_type");

-- CreateIndex
CREATE INDEX "peer_group_computation_logs_peer_group_id_idx" ON "peer_group_computation_logs"("peer_group_id");
