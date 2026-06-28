-- CreateEnum
CREATE TYPE "GuardType" AS ENUM ('shape', 'count', 'null_rate', 'range', 'continuity');

-- CreateEnum
CREATE TYPE "IngestionSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ResolutionPath" AS ENUM ('source_code', 'admin_fill');

-- CreateEnum
CREATE TYPE "IngestionErrorStatus" AS ENUM ('open', 'resolved', 'ignored');

-- CreateTable
CREATE TABLE "ingestion_errors" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "guard_type" "GuardType" NOT NULL,
    "target_table" TEXT NOT NULL,
    "target_field" TEXT,
    "target_entity" TEXT,
    "severity" "IngestionSeverity" NOT NULL,
    "resolution_path" "ResolutionPath" NOT NULL,
    "expected" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "detail" TEXT,
    "run_ref" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "IngestionErrorStatus" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_citation" TEXT,
    "resolution_note" TEXT,

    CONSTRAINT "ingestion_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_errors_status_severity_idx" ON "ingestion_errors"("status", "severity");

-- CreateIndex
CREATE INDEX "ingestion_errors_cron_created_at_idx" ON "ingestion_errors"("cron", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_errors_status_resolution_path_idx" ON "ingestion_errors"("status", "resolution_path");

-- CreateIndex
CREATE INDEX "ingestion_errors_cron_guard_type_target_field_target_entity_idx" ON "ingestion_errors"("cron", "guard_type", "target_field", "target_entity", "status");
