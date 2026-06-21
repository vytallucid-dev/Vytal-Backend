-- §5 findings engine — ScorePattern tri-state + magnitude (File 1 §5E).
-- score_patterns is a 0-row table, so both adds are clean.
--   display_state: "active" | "pending_data_integration" | "dampened" (default active)
--   magnitude:     effective score impact applied (Decimal — survives dampening-halving)

-- AlterTable
ALTER TABLE "score_patterns" ADD COLUMN     "display_state" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "magnitude" DECIMAL(6,2);
