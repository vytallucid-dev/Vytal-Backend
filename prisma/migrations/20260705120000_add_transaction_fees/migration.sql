-- ═══════════════════════════════════════════════════════════════
-- Transaction fees — per-transaction ₹ charges (brokerage + STT + …),
-- manually entered. ADDITIVE ONLY: one nullable column, DEFAULT 0 so every
-- already-seeded fee-less transaction reads as 0 (honest, no fee). The FIFO
-- replay engine folds a buy fee into cost basis and a sell fee out of proceeds,
-- so realized P&L + invested become fee-aware; null/absent = 0 (back-compat).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "transactions"
    ADD COLUMN IF NOT EXISTS "fees" DECIMAL(18,6) DEFAULT 0;
