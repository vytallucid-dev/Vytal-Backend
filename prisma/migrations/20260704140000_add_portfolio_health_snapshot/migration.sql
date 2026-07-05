-- ═══════════════════════════════════════════════════════════════
-- Portfolio Health Score snapshot (PHS Part A) — compute-once, append-only.
-- One row per (user=portfolio, compute-event); the single source every surface
-- reads. ADDITIVE ONLY — no existing table touched beyond the FK to users(id).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "portfolio_health_snapshot" (
    "id"                        TEXT          NOT NULL,
    "user_id"                   TEXT          NOT NULL,
    "phs"                       INTEGER,
    "phs_raw"                   DECIMAL(8,4),
    "band"                      TEXT,
    "provisional"               BOOLEAN       NOT NULL DEFAULT false,
    "evaluable"                 BOOLEAN       NOT NULL DEFAULT true,
    "ceiling_applied"           BOOLEAN       NOT NULL,
    "ceiling_value"             INTEGER,
    "quality"                   DECIMAL(8,4),
    "structure"                 DECIMAL(8,4)  NOT NULL,
    "signals"                   DECIMAL(8,4)  NOT NULL,
    "coverage"                  DECIMAL(6,4)  NOT NULL,
    "total_value"              DECIMAL(20,2)  NOT NULL,
    "scored_value"             DECIMAL(20,2)  NOT NULL,
    "recognized_unscored_value" DECIMAL(20,2) NOT NULL,
    "small_unscored_value"     DECIMAL(20,2)  NOT NULL,
    "structure_ledger"          JSONB         NOT NULL,
    "signals_ledger"            JSONB         NOT NULL,
    "fired_findings"            JSONB,
    "constant_version"          TEXT          NOT NULL,
    "fingerprint"               TEXT          NOT NULL,
    "created_at"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_health_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (latest-snapshot-per-user read path)
CREATE INDEX "portfolio_health_snapshot_user_id_created_at_idx"
    ON "portfolio_health_snapshot"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portfolio_health_snapshot_fingerprint_idx"
    ON "portfolio_health_snapshot"("fingerprint");

-- AddForeignKey
ALTER TABLE "portfolio_health_snapshot"
    ADD CONSTRAINT "portfolio_health_snapshot_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
