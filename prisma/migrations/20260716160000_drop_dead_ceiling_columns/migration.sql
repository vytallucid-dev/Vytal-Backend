-- ═══════════════════════════════════════════════════════════════
-- Construction v2 Stage 7 (§12) — RETIRE THE DEAD v1.2 CEILING COLUMNS.
--
-- The coverage ceiling was retired in portfolio-spec 1.2 (constants.ts): Health shows TRUE, uncapped, so
-- there is no pre-ceiling value and no cap to record. These three columns have been written null/false
-- ever since (persist.ts) and are read by nothing that matters.
--
-- PROVED SAFE BEFORE PROPOSING (Gate 0 recon, recon-cv2-stage7-gate0.ts §5):
--     rows = 31 · phs_raw NON-NULL = 0 · ceiling_applied TRUE = 0 · ceiling_value NON-NULL = 0
-- No history is destroyed — the table is append-only, and not one row in it ever carried a ceiling. Had
-- ANY row carried one, "retire" would have meant "stop writing", never "drop": you cannot un-drop history.
--
-- ORDERING (operator-ruled, non-negotiable): the 5 dangling readers are fixed FIRST — recon-transfer.ts,
-- seed-portfolio-overview.ts, verify-phs-persist.ts (×2), and the writes in persist.ts — then schema.prisma
-- drops the fields, then this DDL runs, then `prisma generate`. Dropping ahead of the readers breaks them.
--
-- IF EXISTS: idempotent, so a re-run after a partial apply is a no-op rather than an error.
-- APPLIED via the drift-safe db-execute + migrate-resolve path ([[invest-iq-migration-drift]]) — never
-- `migrate dev`, which would diff the whole schema and try to "fix" unrelated drift.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "portfolio_health_snapshot" DROP COLUMN IF EXISTS "phs_raw";
ALTER TABLE "portfolio_health_snapshot" DROP COLUMN IF EXISTS "ceiling_applied";
ALTER TABLE "portfolio_health_snapshot" DROP COLUMN IF EXISTS "ceiling_value";
