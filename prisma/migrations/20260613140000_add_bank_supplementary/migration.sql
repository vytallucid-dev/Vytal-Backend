-- BankSupplementary: append-only, metric-keyed store for manually-entered
-- banking figures NOT in the Reg-33 XBRL (CASA ratio; pre-FY23 Tier-1 capital).
-- Additive only: one new enum type + one new table + indexes + FKs. No existing
-- table is touched, so this is safe to apply to a populated database.
--
-- NOTE on the cell-uniqueness key: Postgres treats NULL as DISTINCT in unique
-- indexes, so for ANNUAL rows (quarter IS NULL) the unique index below does NOT
-- enforce one-row-per-(cell,version). The ingest route's read-before-write
-- supersede check (inside a transaction) is the authoritative guard for those.

-- CreateEnum
CREATE TYPE "BankSupplementaryMetric" AS ENUM ('casa_pct', 'tier1_pct');

-- CreateTable
CREATE TABLE "bank_supplementary" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "metric" "BankSupplementaryMetric" NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "quarter" TEXT,
    "value" DECIMAL(8,4) NOT NULL,
    "source_citation" TEXT NOT NULL,
    "source_date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" TEXT,
    "entered_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_supplementary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_supplementary_stock_id_metric_fiscal_year_quarter_vers_idx" ON "bank_supplementary"("stock_id", "metric", "fiscal_year", "quarter", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bank_supplementary_stock_id_metric_fiscal_year_quarter_vers_key" ON "bank_supplementary"("stock_id", "metric", "fiscal_year", "quarter", "version");

-- CreateIndex
CREATE UNIQUE INDEX "bank_supplementary_supersedes_id_key" ON "bank_supplementary"("supersedes_id");

-- AddForeignKey
ALTER TABLE "bank_supplementary" ADD CONSTRAINT "bank_supplementary_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_supplementary" ADD CONSTRAINT "bank_supplementary_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "bank_supplementary"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
